import { getSearchContext, requireSearchIndex, SEARCH_VERSION } from './search-index';
import { searchSql } from './search-sql';
import { publicJobSql } from '@catwalks/db/availability';
import { Prisma, prisma } from '@catwalks/db';
import { echapperLike } from './like';
import { PREFIXE_DIRECT, directPubliableSql } from './direct-offers';
import { DIMENSIONS, type Dimension, type PlanRecherche } from './search-plan';

export type Facet = { value: string; count: number };

/**
 * La clé ordonnée d'une ligne servie (lot 7) : origine (Catwalks = 0), non
 * confirmée (0/1), pays prioritaire (0/1), score négatif, date de publication
 * négative en secondes (sans date : 1e15, donc dernière), première observation
 * négative, identifiant. Tout est croissant : une comparaison de lignes SQL
 * suffit à reprendre APRÈS une clé.
 */
export type CleRecherche = [number, number, number, number, number, number, string];
export const ARITE_CLE_RECHERCHE = 7;

export type SearchSummary = {
  ids: string[];
  /** La clé de la dernière ligne servie quand une suite existe ; `null` à la fin. */
  suivant: CleRecherche | null;
  /** Toutes les offres du périmètre qui répondent à la recherche, confirmées ou non. */
  total: number;
  /** Celles dont chaque dimension tolérante filtrée est renseignée (D-435). */
  totalConfirmes: number;
  /** Toutes les offres publiables du périmètre, deux origines, sans aucun critère. */
  totalPerimetre: number;
  facettes: Record<Dimension, Facet[]>;
};

/** Single search path for both origins. The rebuildable projection selects
 * candidates; live catalogue predicates enforce publication, market, location
 * and facets. Self-excluded facets and keyset pagination share the same base. */

const COLONNE: Record<Exclude<Dimension, 'metier' | 'secteur' | 'maison' | 'ville'>, Prisma.Sql> = {
  pays: Prisma.sql`b."countryCode"`,
  contrat: Prisma.sql`b."employmentTerm"`,
  temps: Prisma.sql`b."workTime"`,
  programme: Prisma.sql`b."programType"`,
  groupe: Prisma.sql`b.groupe`,
  langue: Prisma.sql`b.language`,
};

/** Projection de recherche : on conserve les faits RAW indépendants. Une alternance
 * en CDI peut répondre aux deux choix, sans dupliquer l'offre ni additionner ses comptes. */
const choixContrat = Prisma.sql`array_remove(ARRAY[b."employmentTerm", b."programType",
  CASE WHEN b."engagementType" IN ('FREELANCE', 'INDEPENDENT_CONTRACTOR') THEN b."engagementType" END], NULL)::text[]`;

const facetteContratUnifie = (plan: PlanRecherche) => Prisma.sql`
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT value, count(DISTINCT b.id)::int AS n FROM base b
     CROSS JOIN LATERAL unnest(${choixContrat}) value
     WHERE ${restriction(plan, 'contrat')} GROUP BY value) f)`;

/** Le prédicat SQL d'une dimension sélectionnée, sur l'alias `b` de `base`. */
function predicat(dimension: Dimension, valeurs: readonly string[], plan: PlanRecherche): Prisma.Sql {
  const liste = Prisma.join(valeurs.map((v) => Prisma.sql`${v}`));
  if (dimension === 'contrat' && plan.perimetre.marche?.contratUnifie) {
    return Prisma.sql`${choixContrat} && ARRAY[${liste}]::text[]`;
  }
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
      return dedans;
    }
  }
}

/** `WHERE` composé des dimensions sélectionnées, sauf celle qu'on exclut. */
function restriction(plan: PlanRecherche, sauf?: Dimension): Prisma.Sql {
  const conditions = DIMENSIONS.flatMap((d) => {
    const valeurs = plan.selections[d];
    return d !== sauf && valeurs?.length ? [predicat(d, valeurs, plan)] : [];
  });
  return conditions.length ? Prisma.join(conditions, ' AND ') : Prisma.sql`true`;
}

const facette = (colonne: Prisma.Sql, plan: PlanRecherche, dimension: Dimension, limit?: number) => Prisma.sql`
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT ${colonne}::text AS value, count(*)::int AS n FROM base b WHERE ${restriction(plan, dimension)}
     AND ${colonne} IS NOT NULL AND ${colonne}::text <> '' GROUP BY ${colonne}
     ORDER BY n DESC, value ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}) f)`;

/** Un motif `LIKE` normalisé par la base, comme les colonnes normalisées qu'il interroge. */
const motifNormalise = (motif: string) => Prisma.sql`catwalks_normaliser_texte(${motif})`;

/**
 * Le lieu compris, appliqué sur l'alias d'une origine, sans accents ni casse
 * (« zurich » trouve Zürich). Les offres directes ne portent pas de
 * subdivision : le libellé de lieu la remplace.
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
      const subdivision = alias === 'j' ? Prisma.sql`OR catwalks_normaliser_texte(j."adminArea1") LIKE ${motifNormalise(propre)}` : Prisma.empty;
      return [Prisma.sql`(catwalks_normaliser_texte(${t}.city) LIKE ${motifNormalise(propre)} OR catwalks_normaliser_texte(${t}.city) LIKE ${motifNormalise(`${propre}%`)}
        OR catwalks_normaliser_texte(${t}.location) LIKE ${motifNormalise(`%${propre}%`)} ${subdivision})`];
    }
  }
}

/** Le périmètre de l'origine directe : publiable, dans les pays du marché ; l'échéance d'une offre directe s'applique ici. */
function perimetreDirect(pays: Prisma.Sql, asOf: Date): Prisma.Sql {
  return Prisma.sql`${directPubliableSql(Prisma.sql`d`, asOf)} AND d."countryCode" IN (${pays})`;
}

/**
 * Le total publiable d'un périmètre ne dépend d'aucun critère : il est
 * mémorisé par instance, la clé étant l'ensemble des pays du périmètre — un
 * marché qui en sert deux (DE : DE + AT) n'a jamais le compte d'un autre.
 * Mesuré sur le clone : 240 ms par recherche sur le marché US sans ce mémo.
 */
export const COMPTE_PERIMETRE_TTL_MS = 60_000;
const comptesPerimetre = new Map<string, { valeur: Promise<number>; expire: number }>();

function compterPerimetre(paysDuPerimetre: readonly string[], asOf: Date): Promise<number> {
  const cle = [...paysDuPerimetre].sort().join(',');
  const memo = comptesPerimetre.get(cle);
  if (memo && memo.expire > Date.now()) return memo.valeur;
  const pays = Prisma.join(paysDuPerimetre.map((p) => Prisma.sql`${p}`));
  const valeur = prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT ((SELECT count(*) FROM "Job" j WHERE ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays}))
          + (SELECT count(*) FROM "DirectOffer" d WHERE ${perimetreDirect(pays, asOf)}))::int AS n`).then(([r]) => r.n);
  comptesPerimetre.set(cle, { valeur, expire: Date.now() + COMPTE_PERIMETRE_TTL_MS });
  valeur.catch(() => comptesPerimetre.delete(cle));
  return valeur;
}

export async function searchSummary(
  plan: PlanRecherche,
  curseur: CleRecherche | null,
  pageSize: number,
): Promise<SearchSummary> {
  const asOf = new Date();
  const pays = Prisma.join(plan.perimetre.pays.map((p) => Prisma.sql`${p}`));
  const perimetre = Prisma.sql`${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays})`;
  const conditions: Prisma.Sql[] = [perimetre, ...conditionLieu(plan, 'j')];
  const conditionsDirect: Prisma.Sql[] = [perimetreDirect(pays, asOf), ...conditionLieu(plan, 'd')];

  if (plan.q) await requireSearchIndex();
  const search = plan.q ? searchSql((await getSearchContext()).model.resolver.resolve(plan.q)) : null;
  if (search) { conditions.push(search.condition); conditionsDirect.push(search.condition); }
  const aggregateIndex = search ? Prisma.sql`JOIN "SearchDocument" s ON s.id=j.id AND s.version=${SEARCH_VERSION} AND s.country IN (${pays})` : Prisma.empty;
  const directIndex = search ? Prisma.sql`JOIN "SearchDocument" s ON s.id='cw_'||d.id AND s.version=${SEARCH_VERSION} AND s.country IN (${pays})` : Prisma.empty;

  // Un filtre sélectionné exige une valeur attestée. Aucun élargissement aux valeurs absentes.
  // D-419 §2 : le pays du visiteur d'abord, à l'intérieur du périmètre. Jamais un filtre.
  const priorite = plan.prioritePays ? Prisma.sql`(CASE WHEN b."countryCode" = ${plan.prioritePays} THEN 0 ELSE 1 END)` : Prisma.sql`0`;
  const apres = curseur
    ? Prisma.sql`WHERE (origine, nc, pri, ns, np, nf, id) > (${curseur[0]}::int, ${curseur[1]}::int, ${curseur[2]}::int, ${curseur[3]}::int, ${curseur[4]}::float8, ${curseur[5]}::float8, ${curseur[6]}::text)`
    : Prisma.empty;

  const [[summary], totalPerimetre] = await Promise.all([prisma.$queryRaw<Array<Omit<SearchSummary, 'ids' | 'suivant' | 'totalPerimetre'> & { page: Array<{ id: string; k: CleRecherche }> | null }>>(Prisma.sql`
    WITH base AS MATERIALIZED (
      SELECT j.id, 1 AS origine, j."occupationCode", j."countryCode", lower(trim(j.city)) AS ville, j."employmentTerm", j."workTime",
        j."programType", j."engagementType", j."postedAt", j."firstSeenAt", j.language, c.id AS "companyId", c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe,
        ${search?.score ?? Prisma.sql`0`} AS score
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" ${aggregateIndex}
      WHERE ${Prisma.join(conditions, ' AND ')}
      UNION ALL
      SELECT ${PREFIXE_DIRECT} || d.id, 0 AS origine, NULL::text, d."countryCode", lower(trim(d.city)), d."employmentTerm", d."workTime",
        d."programType", d."engagementType", d."postedAt", d."receivedAt", d.language, NULL::text, d.company, d."sectorCodes", NULL::text,
        ${search?.score ?? Prisma.sql`0`}
      FROM "DirectOffer" d ${directIndex}
      WHERE ${Prisma.join(conditionsDirect, ' AND ')}
    ), scoped AS MATERIALIZED (
      SELECT b.id, b.origine, b."countryCode", b."postedAt", b."firstSeenAt", true AS confirme, ${priorite} AS pri, b.score
      FROM base b WHERE ${restriction(plan)}
    ), cles AS (
      SELECT id, origine, (NOT confirme)::int AS nc, pri, -score AS ns,
        coalesce(-extract(epoch FROM "postedAt"), 1e15)::float8 AS np, (-extract(epoch FROM "firstSeenAt"))::float8 AS nf, confirme
      FROM scoped
    )
    SELECT
      (SELECT count(*)::int FROM scoped) AS total,
      (SELECT count(*)::int FROM scoped WHERE confirme) AS "totalConfirmes",
      (SELECT jsonb_agg(jsonb_build_object('id', id, 'k', jsonb_build_array(origine, nc, pri, ns, np, nf, id)) ORDER BY origine, nc, pri, ns, np, nf, id)
         FROM (SELECT * FROM cles ${apres} ORDER BY origine, nc, pri, ns, np, nf, id LIMIT ${pageSize + 1}) p) AS page,
      jsonb_build_object(
        'pays', ${facette(Prisma.sql`b."countryCode"`, plan, 'pays')},
        'metier', ${facette(Prisma.sql`COALESCE(b."occupationCode", 'unclassified')`, plan, 'metier')},
        'secteur', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN cardinality(b."sectorCodes") = 0
            THEN ARRAY['unclassified'] ELSE b."sectorCodes" END) code WHERE ${restriction(plan, 'secteur')} GROUP BY code) f),
        'contrat', ${plan.perimetre.marche?.contratUnifie ? facetteContratUnifie(plan) : facette(Prisma.sql`b."employmentTerm"`, plan, 'contrat')},
        'temps', ${facette(Prisma.sql`b."workTime"`, plan, 'temps')},
        'programme', ${facette(Prisma.sql`b."programType"`, plan, 'programme')},
        'ville', ${facette(Prisma.sql`b.ville`, plan, 'ville', 60)},
        'maison', ${facette(Prisma.sql`b.maison`, plan, 'maison')},
        'groupe', ${facette(Prisma.sql`b.groupe`, plan, 'groupe')},
        'langue', ${facette(Prisma.sql`b.language`, plan, 'langue')}
      ) AS facettes
  `), compterPerimetre(plan.perimetre.pays, asOf)]);
  const page = summary.page ?? [];
  const servies = page.slice(0, pageSize);
  return {
    ids: servies.map((p) => p.id),
    suivant: page.length > pageSize ? servies[servies.length - 1].k : null,
    total: summary.total,
    totalConfirmes: summary.totalConfirmes,
    totalPerimetre,
    facettes: summary.facettes,
  };
}
