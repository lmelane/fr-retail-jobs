import { sectorSql } from './sectors';
import { getOptionalOccupationPresentation, type OptionalOccupationPresentation } from './occupations';
import { companyIdentitySql, companyAliasSql } from './company-identity';
import { Prisma, prisma } from '@catwalks/db';
import { expandCompanyTerm } from './groups';
import { rawValuesForCode } from './countries';
import type { JobFilters } from './jobs';

type Facet = { value: string; count: number };
export type SearchSummary = {
  ids: string[]; total: number; totalInDatabase: number; franceCount: number;
  sectors: Facet[]; contracts: Facet[]; workTimes: Facet[]; programs: Facet[]; engagements: Facet[]; cities: Facet[]; groups: Facet[];
  maisons: Facet[]; sources: Facet[]; rawCountries: Facet[]; occupations: Facet[]; languages: Facet[];
};

// Only these fixed SQL fragments become identifiers. User values remain bound parameters.
const facet = (column: Prisma.Sql, limit?: number) => Prisma.sql`
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT ${column}::text AS value, count(*)::int AS n FROM scoped
     WHERE ${column} IS NOT NULL AND ${column}::text <> '' GROUP BY ${column}
     ORDER BY n DESC, value ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}) f)`;

/** One materialized match set instead of re-running the text search for every facet. */
export async function searchSummary(filters: JobFilters, page: number, pageSize: number, presentation?: OptionalOccupationPresentation): Promise<SearchSummary> {
  const conditions: Prisma.Sql[] = [Prisma.sql`j."isActive"`];

  /*
   * D-426 — une dimension cochée sur plusieurs valeurs devient UNE condition
   * `(a OR b OR c)`, jointe aux autres par `AND`.
   *
   * Ce fichier est le chemin SQL RÉELLEMENT emprunté par la recherche ; il
   * double `whereClause` (Prisma) et les deux doivent dire la même chose. Une
   * dimension traitée ici en égalité simple alors qu'elle est multi-valuée
   * ailleurs ferait diverger la liste affichée et son compte, sans erreur.
   *
   * Chaque valeur reste un PARAMÈTRE LIÉ : le SQL ne reçoit jamais de texte
   * concaténé, et le plafond de 12 valeurs borne la taille de la clause.
   */
  const union = (values: string[] | undefined, terme: (v: string) => Prisma.Sql) => {
    if (!values?.length) return;
    conditions.push(Prisma.sql`(${Prisma.join(values.map(terme), ' OR ')})`);
  };

  union(filters.occupations, (o) =>
    o === 'unclassified' ? Prisma.sql`j."occupationCode" IS NULL` : Prisma.sql`j."occupationCode" = ${o}`,
  );
  if (filters.jobFunction) conditions.push(Prisma.sql`j."jobFunction" = ${filters.jobFunction}`);
  if (filters.city) conditions.push(Prisma.sql`j.city ILIKE ${filters.city}`);
  // « lieu » résolu en ville (D-418 §3) : large — égalité, préfixe, ou présence
  // dans `location`. Miroir exact de `whereClause`.
  if (filters.cityLoose) conditions.push(Prisma.sql`(j.city ILIKE ${filters.cityLoose} OR j.city ILIKE ${`${filters.cityLoose}%`} OR j.location ILIKE ${`%${filters.cityLoose}%`})`);
  if (filters.remote) conditions.push(Prisma.sql`j."workplaceType" = 'REMOTE'`);
  union(filters.languages, (v) => Prisma.sql`j.language = ${v}`);
  union(filters.employmentTerms, (v) => Prisma.sql`j."employmentTerm" = ${v}`);
  union(filters.maisons, (v) => companyIdentitySql(v));
  union(filters.groups, (v) => Prisma.sql`c."parentGroup" = ${v}`);
  union(filters.sectors, (v) => sectorSql(v));
  union(filters.workTimes, (v) => Prisma.sql`j."workTime" = ${v}`);
  union(filters.programTypes, (v) => Prisma.sql`j."programType" = ${v}`);
  union(filters.engagementTypes, (v) => Prisma.sql`j."engagementType" = ${v}`);
  if (filters.source) conditions.push(Prisma.sql`EXISTS (
    SELECT 1 FROM "JobSource" src WHERE src."jobId" = j.id AND src."isActive" AND src."sourceKey" = ${filters.source})`);
  const queryTerms = (filters.q ?? '').trim().split(/\s+/).filter(Boolean);
  const prefilters: Prisma.Sql[]=[],literalConditions: Prisma.Sql[]=[];
  let matchCte=Prisma.empty,matchJoin=Prisma.empty;
  // Resolve the small employer registry first. Putting a Company OR directly
  // beside the searchText prefilter prevents the trigram index from narrowing
  // the large Job table. Canonical names keep that prefilter a superset.
  const aliasNames = await Promise.all(queryTerms.map(term => prisma.$queryRaw<{ name: string }[]>(Prisma.sql`
    SELECT c.name FROM "Company" c WHERE ${companyAliasSql(term, 'contains')}`)));
  for (const [index, term] of queryTerms.entries()) {
    const pattern = `%${term}%`;
    // Indexed prefilter is a superset. Keep the original field-level predicate
    // below, so company aliases cannot create false matches in a job title.
    const terms = [...new Set([term, ...expandCompanyTerm(term), ...aliasNames[index].map(c => c.name)])];
    prefilters.push(Prisma.sql`(${Prisma.join(terms.map(t => Prisma.sql`j."searchText" ILIKE ${`%${t}%`}`), ' OR ')})`);
    const matches = [
      Prisma.sql`j.title ILIKE ${pattern}`, Prisma.sql`j.description ILIKE ${pattern}`,
      Prisma.sql`j.city ILIKE ${pattern}`, Prisma.sql`j.location ILIKE ${pattern}`,
      Prisma.sql`j.department ILIKE ${pattern}`, Prisma.sql`j."employmentTerm" ILIKE ${pattern}`,
      ...expandCompanyTerm(term).flatMap(name => [
        companyIdentitySql(name, 'contains'), Prisma.sql`c."parentGroup" ILIKE ${`%${name}%`}`,
      ]),
    ];
    literalConditions.push(Prisma.sql`(${Prisma.join(matches, ' OR ')})`);
  }
  if(prefilters.length){
    // Whole-query aliases only: extra employer/location/rank words keep their
    // literal meaning. Separate indexed candidates from expensive exact-field
    // checks; a mixed semantic OR otherwise forces a full scan of Job payloads.
    const {taxonomy}=presentation??await getOptionalOccupationPresentation();
    const codes=taxonomy?.queryOccupations(filters.q??'')??[];
    const semantic=codes.length?Prisma.sql`j."occupationCode" IN (${Prisma.join(codes)})`:Prisma.sql`false`;
    matchCte=Prisma.sql`
      text_candidates AS MATERIALIZED (
        SELECT j.id FROM "Job" j WHERE j."isActive" AND ${Prisma.join(prefilters,' AND ')}
          AND NOT COALESCE(${semantic},false)
      ), matched_ids AS MATERIALIZED (
        SELECT j.id FROM text_candidates t JOIN "Job" j ON j.id=t.id JOIN "Company" c ON c.id=j."companyId"
        WHERE ${Prisma.join(literalConditions,' AND ')}
        UNION ALL SELECT j.id FROM "Job" j WHERE j."isActive" AND ${semantic}
      ),`;
    matchJoin=Prisma.sql`JOIN matched_ids matches ON matches.id=j.id`;
  }
  /*
   * D-426 — plusieurs pays cochés : union de leurs conditions.
   * `FR` garde le drapeau fiable `isFrance` ; les autres codes passent par
   * leurs orthographes attestées. Un code sans orthographe connue rend `false`
   * plutôt que d'être ignoré : l'ignorer élargirait la recherche au lieu de
   * la restreindre, donc montrerait des offres que le visiteur a exclues.
   */
  let country = Prisma.sql`true`;
  if (filters.countries?.length) {
    const termes = filters.countries.map((code) => {
      if (code === 'FR') return Prisma.sql`"isFrance"`;
      const values = rawValuesForCode(code).map((value) => value.toLowerCase());
      return values.length ? Prisma.sql`lower("countryCode") IN (${Prisma.join(values)})` : Prisma.sql`false`;
    });
    country = Prisma.sql`(${Prisma.join(termes, ' OR ')})`;
  }
  // D-419 §2 : le pays du visiteur d'abord (0), le reste du monde ensuite (1),
  // puis la fraîcheur dans chaque groupe. Jamais un filtre : rien ne disparaît.
  const priorite = filters.priorityCountry
    ? Prisma.sql`(CASE WHEN "countryCode" = ${filters.priorityCountry} THEN 0 ELSE 1 END),`
    : Prisma.empty;
  const [summary] = await prisma.$queryRaw<SearchSummary[]>(Prisma.sql`
    WITH ${matchCte} base AS MATERIALIZED (
      SELECT j.id, j."occupationCode", j."countryCode", j."isFrance", j.city, j."employmentTerm", j."workTime", j."programType", j."engagementType", j."postedAt", j."firstSeenAt", j.language,
        c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" ${matchJoin}
      WHERE ${Prisma.join(conditions, ' AND ')}
    ), scoped AS MATERIALIZED (SELECT * FROM base WHERE ${country})
    SELECT
      (SELECT count(*)::int FROM scoped) AS total,
      (SELECT count(*)::int FROM "Job" WHERE "isActive") AS "totalInDatabase",
      (SELECT count(*)::int FROM base WHERE "isFrance") AS "franceCount",
      ARRAY(SELECT id FROM scoped ORDER BY ${priorite} "postedAt" DESC NULLS LAST, "firstSeenAt" DESC, id
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}) AS ids,
      ${facet(Prisma.sql`COALESCE("occupationCode", 'unclassified')`)} AS occupations,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('value',code,'count',n) ORDER BY n DESC,code),'[]'::jsonb)
        FROM (SELECT code,count(*)::int n FROM scoped CROSS JOIN LATERAL unnest(CASE WHEN cardinality("sectorCodes")=0 THEN ARRAY['unclassified'] ELSE "sectorCodes" END) code GROUP BY code) f) AS sectors,
      ${facet(Prisma.sql`"employmentTerm"`)} AS contracts,
      ${facet(Prisma.sql`language`)} AS languages,
      ${facet(Prisma.sql`"workTime"`)} AS "workTimes",
      ${facet(Prisma.sql`"programType"`)} AS programs,
      ${facet(Prisma.sql`"engagementType"`)} AS engagements,
      ${facet(Prisma.sql`lower(trim(city))`, 60)} AS cities,
      ${facet(Prisma.sql`groupe`)} AS groups,
      ${facet(Prisma.sql`maison`)} AS maisons,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('value', "sourceKey", 'count', n) ORDER BY n DESC, "sourceKey"), '[]'::jsonb)
        FROM (SELECT src."sourceKey", count(DISTINCT src."jobId")::int AS n
          FROM "JobSource" src JOIN scoped s ON s.id = src."jobId" WHERE src."isActive"
          GROUP BY src."sourceKey" ORDER BY n DESC, src."sourceKey" LIMIT 40) f) AS sources,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('value', "countryCode", 'count', n)), '[]'::jsonb)
        FROM (SELECT "countryCode", count(*)::int AS n FROM base GROUP BY "countryCode") f) AS "rawCountries"
  `);
  return summary;
}
