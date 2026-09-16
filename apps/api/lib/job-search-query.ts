import { publicJobSql } from '@catwalks/db/availability';
import { Prisma, prisma } from '@catwalks/db';
import { getOptionalOccupationPresentation, type OptionalOccupationPresentation } from './occupations';
import { expandCompanyTerm } from './groups';
import { echapperLike } from './like';
import { PREFIXE_DIRECT, directPubliableSql } from './direct-offers';
import { DIMENSIONS, DIMENSIONS_TOLERANTES, type Dimension, type DimensionTolerante, type PlanRecherche } from './search-plan';

export type Facet = { value: string; count: number };
export type SearchSummary = {
  ids: string[];
  /** Toutes les offres du périmètre qui répondent à la recherche, confirmées ou non. */
  total: number;
  /** Celles dont chaque dimension tolérante filtrée est renseignée (D-435). */
  totalConfirmes: number;
  /** Toutes les offres publiables du périmètre, deux origines, sans aucun critère. */
  totalPerimetre: number;
  facettes: Record<Dimension, Facet[]>;
};

/**
 * LE SEUL CHEMIN SQL DE LA RECHERCHE (lot 6).
 *
 * Avant ce lot, `whereClause` (Prisma) et cette requête disaient deux choses
 * différentes des mêmes filtres — tolérance aux inconnues d'un côté, égalité
 * stricte de l'autre — et seule cette requête servait `/api/jobs`. Il n'en
 * reste qu'une, et elle applique le plan tel quel :
 *
 *  - `base` : l'UNION des deux origines — les publications agrégées (`Job`)
 *    et les offres directes Catwalks (`DirectOffer`, D-423) — dans le
 *    PÉRIMÈTRE (les pays du marché, obligatoire), avec la recherche texte et
 *    le lieu ; tout ce qui n'est pas une facette. L'union précède les filtres,
 *    le tri et la pagination : deux pages déjà paginées ne s'additionnent
 *    jamais (passation §2.3) ;
 *  - `scoped` : `base` restreinte par TOUTES les dimensions sélectionnées, ET
 *    entre dimensions, OU entre valeurs ; une dimension tolérante conserve les
 *    offres non renseignées et les marque `confirme = false` ;
 *  - chaque facette est comptée sur `base` restreinte par les AUTRES
 *    dimensions : sa propre sélection est exclue, pour que le candidat voie ce
 *    qu'il peut encore ajouter (D-426, union dans une dimension) ;
 *  - l'ordre : les offres Catwalks d'abord (D-419 §1), puis les confirmées,
 *    puis le pays du visiteur, puis la fraîcheur. La priorité Catwalks ne sort
 *    jamais une offre du périmètre ni des filtres : elle ne classe que ce que
 *    `scoped` a retenu.
 *
 * Les valeurs utilisateur restent des paramètres liés ; seuls des fragments
 * fixes deviennent des identifiants.
 */
export { MAX_TERMES } from './search-plan';

const COLONNE: Record<Exclude<Dimension, 'metier' | 'secteur' | 'maison' | 'ville'>, Prisma.Sql> = {
  pays: Prisma.sql`b."countryCode"`,
  contrat: Prisma.sql`b."employmentTerm"`,
  temps: Prisma.sql`b."workTime"`,
  programme: Prisma.sql`b."programType"`,
  groupe: Prisma.sql`b.groupe`,
  langue: Prisma.sql`b.language`,
};

/** Le prédicat SQL d'une dimension sélectionnée, sur l'alias `b` de `base`. */
function predicat(dimension: Dimension, valeurs: readonly string[]): Prisma.Sql {
  const liste = Prisma.join(valeurs.map((v) => Prisma.sql`${v}`));
  switch (dimension) {
    case 'metier':
      return Prisma.sql`(${Prisma.join(valeurs.map((v) => v === 'unclassified'
        ? Prisma.sql`b."occupationCode" IS NULL` : Prisma.sql`b."occupationCode" = ${v}`), ' OR ')})`;
    case 'secteur':
      return Prisma.sql`(${Prisma.join(valeurs.map((v) => v === 'unclassified'
        ? Prisma.sql`cardinality(b."sectorCodes") = 0` : Prisma.sql`b."sectorCodes" @> ARRAY[${v}]::text[]`), ' OR ')})`;
    case 'ville':
      return Prisma.sql`b.ville IN (${Prisma.join(valeurs.map((v) => Prisma.sql`lower(trim(${v}))`))})`;
    case 'maison':
      return Prisma.sql`(${Prisma.join(valeurs.map((v) => Prisma.sql`(lower(b.maison) = lower(${v}) OR b."companyId" IN (
        SELECT a."companyId" FROM "CompanyAlias" a WHERE a."reviewId" IS NOT NULL AND lower(a."displayName") = lower(${v})
        UNION SELECT old."mergedIntoId" FROM "Company" old WHERE old."mergedIntoId" IS NOT NULL AND lower(old.name) = lower(${v})))`), ' OR ')})`;
    default: {
      const colonne = COLONNE[dimension];
      const dedans = Prisma.sql`${colonne} IN (${liste})`;
      return (DIMENSIONS_TOLERANTES as readonly Dimension[]).includes(dimension) ? Prisma.sql`(${dedans} OR ${colonne} IS NULL)` : dedans;
    }
  }
}

/** `WHERE` composé des dimensions sélectionnées, sauf celle qu'on exclut. */
function restriction(plan: PlanRecherche, sauf?: Dimension): Prisma.Sql {
  const conditions = DIMENSIONS.flatMap((d) => {
    const valeurs = plan.selections[d];
    return d !== sauf && valeurs?.length ? [predicat(d, valeurs)] : [];
  });
  return conditions.length ? Prisma.join(conditions, ' AND ') : Prisma.sql`true`;
}

const facette = (colonne: Prisma.Sql, plan: PlanRecherche, dimension: Dimension, limit?: number) => Prisma.sql`
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT ${colonne}::text AS value, count(*)::int AS n FROM base b WHERE ${restriction(plan, dimension)}
     AND ${colonne} IS NOT NULL AND ${colonne}::text <> '' GROUP BY ${colonne}
     ORDER BY n DESC, value ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}) f)`;

/**
 * Le lieu compris, appliqué sur l'alias d'une origine. Les offres directes ne
 * portent pas de subdivision : le libellé de lieu la remplace.
 */
function conditionLieu(plan: PlanRecherche, alias: 'j' | 'd'): Prisma.Sql[] {
  const lieu = plan.lieu;
  if (!lieu) return [];
  const t = alias === 'j' ? Prisma.sql`j` : Prisma.sql`d`;
  switch (lieu.type) {
    case 'teletravail':
      return [Prisma.sql`${t}."workplaceType" = 'REMOTE'`];
    case 'pays':
      return [Prisma.sql`${t}."countryCode" = ${lieu.country}`];
    case 'codePostal':
      return [Prisma.sql`upper(replace(${t}."postalCode", ' ', '')) LIKE ${`${echapperLike(lieu.postalCode.replace(/\s/g, ''))}%`}`];
    case 'ville': {
      const propre = echapperLike(lieu.cityLoose);
      const subdivision = alias === 'j' ? Prisma.sql`OR j."adminArea1" ILIKE ${propre}` : Prisma.empty;
      return [Prisma.sql`(${t}.city ILIKE ${propre} OR ${t}.city ILIKE ${`${propre}%`} OR ${t}.location ILIKE ${`%${propre}%`} ${subdivision})`];
    }
  }
}

/** Le périmètre de l'origine directe : publiable, dans les pays du marché ; l'échéance d'une offre directe s'applique ici. */
function perimetreDirect(pays: Prisma.Sql, asOf: Date): Prisma.Sql {
  return Prisma.sql`${directPubliableSql(Prisma.sql`d`, asOf)} AND d."countryCode" IN (${pays})`;
}

export async function searchSummary(
  plan: PlanRecherche,
  page: number,
  pageSize: number,
  presentation?: OptionalOccupationPresentation,
): Promise<SearchSummary> {
  const asOf = new Date();
  const pays = Prisma.join(plan.perimetre.pays.map((p) => Prisma.sql`${p}`));
  const perimetre = Prisma.sql`${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays})`;
  const conditions: Prisma.Sql[] = [perimetre, ...conditionLieu(plan, 'j')];
  const conditionsDirect: Prisma.Sql[] = [perimetreDirect(pays, asOf), ...conditionLieu(plan, 'd')];

  const queryTerms = plan.termes;
  const prefilters: Prisma.Sql[] = [], literalConditions: Prisma.Sql[] = [];
  let matchCte = Prisma.empty, matchJoin = Prisma.empty;
  /*
   * Resolve the small employer registry first. Putting a Company OR directly
   * beside the searchText prefilter prevents the trigram index from narrowing
   * the large Job table. Canonical names keep that prefilter a superset.
   *
   * AUDIT 14/09/2026 — `LIMIT 20` : chaque nom rendu devient une clause `ILIKE`
   * supplémentaire pour chaque terme ; au-delà de vingt, le préfiltre est déjà
   * si large qu'il n'écarte plus rien.
   */
  const aliasNames = await Promise.all(queryTerms.map((term) => prisma.$queryRaw<{ name: string }[]>(Prisma.sql`
    SELECT c.name FROM "Company" c WHERE c.id IN (
      SELECT a."companyId" FROM "CompanyAlias" a WHERE a."reviewId" IS NOT NULL AND a."displayName" ILIKE ${`%${echapperLike(term)}%`}
      UNION SELECT old."mergedIntoId" FROM "Company" old WHERE old."mergedIntoId" IS NOT NULL AND old.name ILIKE ${`%${echapperLike(term)}%`}) LIMIT 20`)));
  for (const [index, term] of queryTerms.entries()) {
    const pattern = `%${echapperLike(term)}%`;
    // Indexed prefilter is a superset. Keep the original field-level predicate
    // below, so company aliases cannot create false matches in a job title.
    const terms = [...new Set([term, ...expandCompanyTerm(term), ...aliasNames[index].map((c) => c.name)])];
    prefilters.push(Prisma.sql`(${Prisma.join(terms.map((t) => Prisma.sql`j."searchText" ILIKE ${`%${echapperLike(t)}%`}`), ' OR ')})`);
    const matches = [
      Prisma.sql`j.title ILIKE ${pattern}`, Prisma.sql`j.description ILIKE ${pattern}`,
      Prisma.sql`j.city ILIKE ${pattern}`, Prisma.sql`j.location ILIKE ${pattern}`,
      Prisma.sql`j.department ILIKE ${pattern}`, Prisma.sql`j."employmentTerm" ILIKE ${pattern}`,
      ...expandCompanyTerm(term).flatMap((name) => [
        Prisma.sql`(c.name ILIKE ${`%${echapperLike(name)}%`} OR c.id IN (
          SELECT a."companyId" FROM "CompanyAlias" a WHERE a."reviewId" IS NOT NULL AND a."displayName" ILIKE ${`%${echapperLike(name)}%`}
          UNION SELECT old."mergedIntoId" FROM "Company" old WHERE old."mergedIntoId" IS NOT NULL AND old.name ILIKE ${`%${echapperLike(name)}%`}))`,
        Prisma.sql`c."parentGroup" ILIKE ${`%${echapperLike(name)}%`}`,
      ]),
    ];
    literalConditions.push(Prisma.sql`(${Prisma.join(matches, ' OR ')})`);
    // Une offre directe porte son texte indexé complet (intitulé, Maison, métier, lieu, description) :
    // chaque terme, ou un nom de groupe qu'il désigne, doit s'y trouver.
    conditionsDirect.push(Prisma.sql`(${Prisma.join([term, ...expandCompanyTerm(term)].map((t) => Prisma.sql`d."searchText" ILIKE ${`%${echapperLike(t)}%`}`), ' OR ')})`);
  }
  if (prefilters.length) {
    // Whole-query aliases only: extra employer/location/rank words keep their
    // literal meaning. Separate indexed candidates from expensive exact-field
    // checks; a mixed semantic OR otherwise forces a full scan of Job payloads.
    const { taxonomy } = presentation ?? await getOptionalOccupationPresentation();
    const codes = taxonomy?.queryOccupations(queryTerms.join(' ')) ?? [];
    const semantic = codes.length ? Prisma.sql`j."occupationCode" IN (${Prisma.join(codes)})` : Prisma.sql`false`;
    matchCte = Prisma.sql`
      text_candidates AS MATERIALIZED (
        SELECT j.id FROM "Job" j WHERE j."isActive" AND j."countryCode" IN (${pays}) AND ${Prisma.join(prefilters, ' AND ')}
          AND NOT COALESCE(${semantic}, false)
      ), matched_ids AS MATERIALIZED (
        SELECT j.id FROM text_candidates t JOIN "Job" j ON j.id = t.id JOIN "Company" c ON c.id = j."companyId"
        WHERE ${Prisma.join(literalConditions, ' AND ')}
        UNION ALL SELECT j.id FROM "Job" j WHERE j."isActive" AND j."countryCode" IN (${pays}) AND ${semantic}
      ),`;
    matchJoin = Prisma.sql`JOIN matched_ids matches ON matches.id = j.id`;
  }

  /*
   * D-435 — une offre est CONFIRMÉE quand chaque dimension tolérante filtrée
   * est renseignée ; sans filtre tolérant, tout est confirmé.
   */
  const confirmees = DIMENSIONS_TOLERANTES.flatMap((d: DimensionTolerante) => plan.selections[d]?.length ? [Prisma.sql`${COLONNE[d]} IS NOT NULL`] : []);
  const confirme = confirmees.length ? Prisma.join(confirmees, ' AND ') : Prisma.sql`true`;
  // D-419 §2 : le pays du visiteur d'abord, à l'intérieur du périmètre ; puis
  // la fraîcheur. Jamais un filtre : rien ne disparaît.
  const priorite = plan.prioritePays
    ? Prisma.sql`(CASE WHEN "countryCode" = ${plan.prioritePays} THEN 0 ELSE 1 END),`
    : Prisma.empty;

  const [summary] = await prisma.$queryRaw<SearchSummary[]>(Prisma.sql`
    WITH ${matchCte} base AS MATERIALIZED (
      SELECT j.id, 1 AS origine, j."occupationCode", j."countryCode", lower(trim(j.city)) AS ville, j."employmentTerm", j."workTime",
        j."programType", j."postedAt", j."firstSeenAt", j.language, c.id AS "companyId", c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" ${matchJoin}
      WHERE ${Prisma.join(conditions, ' AND ')}
      UNION ALL
      SELECT ${PREFIXE_DIRECT} || d.id, 0 AS origine, NULL::text, d."countryCode", lower(trim(d.city)), d."employmentTerm", d."workTime",
        d."programType", d."postedAt", d."receivedAt", d.language, NULL::text, d.company, d."sectorCodes", NULL::text
      FROM "DirectOffer" d
      WHERE ${Prisma.join(conditionsDirect, ' AND ')}
    ), scoped AS MATERIALIZED (SELECT b.*, (${confirme}) AS confirme FROM base b WHERE ${restriction(plan)})
    SELECT
      (SELECT count(*)::int FROM scoped) AS total,
      (SELECT count(*)::int FROM scoped WHERE confirme) AS "totalConfirmes",
      ((SELECT count(*) FROM "Job" j WHERE ${perimetre}) + (SELECT count(*) FROM "DirectOffer" d WHERE ${perimetreDirect(pays, asOf)}))::int AS "totalPerimetre",
      ARRAY(SELECT id FROM scoped ORDER BY origine, confirme DESC, ${priorite} "postedAt" DESC NULLS LAST, "firstSeenAt" DESC, id
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}) AS ids,
      jsonb_build_object(
        'pays', ${facette(Prisma.sql`b."countryCode"`, plan, 'pays')},
        'metier', ${facette(Prisma.sql`COALESCE(b."occupationCode", 'unclassified')`, plan, 'metier')},
        'secteur', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN cardinality(b."sectorCodes") = 0
            THEN ARRAY['unclassified'] ELSE b."sectorCodes" END) code WHERE ${restriction(plan, 'secteur')} GROUP BY code) f),
        'contrat', ${facette(Prisma.sql`b."employmentTerm"`, plan, 'contrat')},
        'temps', ${facette(Prisma.sql`b."workTime"`, plan, 'temps')},
        'programme', ${facette(Prisma.sql`b."programType"`, plan, 'programme')},
        'ville', ${facette(Prisma.sql`b.ville`, plan, 'ville', 60)},
        'maison', ${facette(Prisma.sql`b.maison`, plan, 'maison')},
        'groupe', ${facette(Prisma.sql`b.groupe`, plan, 'groupe')},
        'langue', ${facette(Prisma.sql`b.language`, plan, 'langue')}
      ) AS facettes
  `);
  return summary;
}
