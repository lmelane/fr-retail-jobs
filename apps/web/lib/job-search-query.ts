import { getOptionalOccupationPresentation, type OptionalOccupationPresentation } from './occupations';
import { companyIdentitySql, companyAliasSql } from './company-identity';
import { Prisma, CompanySector, prisma } from '@catwalks/db';
import { expandCompanyTerm } from './groups';
import { rawValuesForCode } from './countries';
import type { JobFilters } from './jobs';

type Facet = { value: string; count: number };
export type SearchSummary = {
  ids: string[]; total: number; totalInDatabase: number; franceCount: number;
  sectors: Facet[]; contracts: Facet[]; cities: Facet[]; groups: Facet[];
  maisons: Facet[]; sources: Facet[]; rawCountries: Facet[]; occupations: Facet[];
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
  if (filters.occupation) conditions.push(filters.occupation==='unclassified'?Prisma.sql`j."occupationCode" IS NULL`:Prisma.sql`j."occupationCode" = ${filters.occupation}`);
  if (filters.jobFunction) conditions.push(Prisma.sql`j."jobFunction" = ${filters.jobFunction}`);
  if (filters.city) conditions.push(Prisma.sql`j.city ILIKE ${filters.city}`);
  if (filters.employmentTerm) conditions.push(Prisma.sql`j."employmentTerm" = ${filters.employmentTerm}`);
  if (filters.maison) conditions.push(companyIdentitySql(filters.maison));
  if (filters.group) conditions.push(Prisma.sql`c."parentGroup" = ${filters.group}`);
  if (filters.sector && (Object.values(CompanySector) as string[]).includes(filters.sector)) {
    conditions.push(Prisma.sql`c.sector = ${filters.sector}::"CompanySector"`);
  }
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
  let country = Prisma.sql`true`;
  if (filters.country === 'FR') country = Prisma.sql`"isFrance"`;
  else if (filters.country) {
    const values = rawValuesForCode(filters.country).map(value => value.toLowerCase());
    country = values.length ? Prisma.sql`lower("countryCode") IN (${Prisma.join(values)})` : Prisma.sql`false`;
  }
  const [summary] = await prisma.$queryRaw<SearchSummary[]>(Prisma.sql`
    WITH ${matchCte} base AS MATERIALIZED (
      SELECT j.id, j."occupationCode", j."countryCode", j."isFrance", j.city, j."employmentTerm", j."postedAt", j."firstSeenAt",
        c.name AS maison, c.sector, c."parentGroup" AS groupe
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" ${matchJoin}
      WHERE ${Prisma.join(conditions, ' AND ')}
    ), scoped AS MATERIALIZED (SELECT * FROM base WHERE ${country})
    SELECT
      (SELECT count(*)::int FROM scoped) AS total,
      (SELECT count(*)::int FROM "Job" WHERE "isActive") AS "totalInDatabase",
      (SELECT count(*)::int FROM base WHERE "isFrance") AS "franceCount",
      ARRAY(SELECT id FROM scoped ORDER BY "postedAt" DESC NULLS LAST, "firstSeenAt" DESC, id
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}) AS ids,
      ${facet(Prisma.sql`COALESCE("occupationCode", 'unclassified')`)} AS occupations,
      ${facet(Prisma.sql`sector`)} AS sectors,
      ${facet(Prisma.sql`"employmentTerm"`)} AS contracts,
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
