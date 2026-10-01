import { getSearchContext, requireSearchIndex, SEARCH_VERSION } from './search-index';
import { searchSql } from './search-sql';
import { metiersSansIndex, repartitionDuPerimetre } from './search-chemin';
import { publicJobSql } from '@catwalks/db/availability';
import { Prisma, prisma } from '@catwalks/db';
import { echapperLike } from './like';
import { PREFIXE_DIRECT, directPubliableSql } from './direct-offers';
import { DIMENSIONS, type Dimension, type PlanRecherche } from './search-plan';
import { RAYON_MAX_KM, boiteSql, distanceKm, type VilleResolue } from './geo';
import { appartient, cercles, distanceDeTri, facetteDeProximite, rayonsSql } from './proximite-sql';

export type Facet = { value: string; count: number };

/**
 * La clé ordonnée d'une ligne servie (lot 7) : origine (Catwalks = 0), non
 * confirmée (0/1), proximité, score négatif, date de publication
 * négative en secondes (sans date : 1e15, donc dernière), première observation
 * négative, identifiant. Tout est croissant : une comparaison de lignes SQL
 * suffit à reprendre APRÈS une clé.
 *
 * La proximité (3e terme) : sans ville cherchée, le pays du visiteur d'abord (0/1, D-419 §2) ; avec une ville cherchée
 * (D-496), la distance en kilomètres entiers, qui remplace le pays du visiteur — la pertinence ne départage que les
 * offres à la même distance, au kilomètre près. La forme de la clé ne change pas ; l'empreinte d'une recherche avec une
 * ville trouvée, elle, change (`empreintePlan`) : un curseur servi avant ce lot pour une telle recherche est refusé.
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
 * and facets. Self-excluded facets and keyset pagination share the same base.
 * D-444 : a direct offer carries the taxonomy's occupation of its title and its
 * Maison's attachment to the Company registry (hence its group, read live as for
 * an aggregated offer), so the "metier", "groupe" and "maison" filters reach it.
 * An attached offer is faceted and filtered under the registry's name of its
 * Maison (« L’Occitane en Provence », « Typology »), the name its aggregated
 * offers carry: one option per Maison, never two spellings. The offer itself
 * still displays the Maison's name as the backend publishes it (D-455). */

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

const facetteContratUnifie = (plan: PlanRecherche) => plan.proximite
  ? facetteDeProximite(plan, 'contrat', { source: Prisma.sql`base b CROSS JOIN LATERAL unnest(${choixContrat}) value`,
    valeur: Prisma.sql`value`, filtre: restriction(plan, 'contrat'), distinct: true })
  : Prisma.sql`
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
      // D-475 point 38 : une offre appartient au métier de son code ET aux métiers lus dans son intitulé (`titleRoles`,
      // packages/db/occupation-title-roles.ts) ; sans aucun des deux, elle est « non classée ». La facette compte la même
      // appartenance (`metiersDe`).
      return Prisma.sql`(${Prisma.join(valeurs.map((v) => v === 'unclassified'
        ? Prisma.sql`(b."occupationCode" IS NULL AND cardinality(b."titleRoles") = 0)`
        : Prisma.sql`(b."occupationCode" = ${v} OR b."titleRoles" @> ARRAY[${v}]::text[])`), ' OR ')})`;
    case 'secteur':
      return Prisma.sql`(${Prisma.join(valeurs.map((v) => v === 'unclassified'
        ? Prisma.sql`cardinality(b."sectorCodes") = 0` : Prisma.sql`b."sectorCodes" @> ARRAY[${v}]::text[]`), ' OR ')})`;
    case 'ville': {
      const texte = Prisma.sql`b.ville IN (${Prisma.join(valeurs.map((v) => Prisma.sql`lower(trim(${v}))`))})`;
      const villes = plan.proximite?.villes;
      if (!villes) return texte;
      // D-496 : une ville connue de la base retient les offres de son plus grand cercle (`dv`, la distance à la plus
      // proche des villes choisies ; le cercle de chacune se choisit ensuite, proximite-sql.ts) ; une offre sans point,
      // celles qui portent son nom (`vt`) ; une valeur inconnue de la base, l'égalité de texte d'avant (`vi`).
      return Prisma.sql`(b.dv <= ${RAYON_MAX_KM}::float8 OR b.vt OR b.vi)`;
    }
    case 'maison':
      // Une offre directe rattachée au registre est facettée sous le nom du registre (`b.maison`). Le nom que le backend
      // publie, celui de sa carte, désigne la même société par ce rattachement (D-444) : un lien bâti sur lui (bloc
      // Maison, fiche fermée, suggestion) trouve toutes les offres de la Maison, directes et agrégées.
      return Prisma.sql`(${Prisma.join(valeurs.map((v) => Prisma.sql`(lower(b.maison) = lower(${v}) OR b."companyId" IN (
        SELECT a."companyId" FROM "CompanyAlias" a WHERE a."reviewId" IS NOT NULL AND lower(a."displayName") = lower(${v})
        UNION SELECT old."mergedIntoId" FROM "Company" old WHERE old."mergedIntoId" IS NOT NULL AND lower(old.name) = lower(${v})
        UNION SELECT publiee."companyId" FROM "DirectOffer" publiee WHERE publiee."companyId" IS NOT NULL AND lower(publiee.company) = lower(${v})))`), ' OR ')})`;
    default: {
      const colonne = COLONNE[dimension];
      const dedans = Prisma.sql`${colonne} IN (${liste})`;
      return dedans;
    }
  }
}

/** Les métiers d'une offre : son code et ses métiers lus, une fois chacun ; « unclassified » sans aucun. */
const metiersDe = Prisma.sql`CASE WHEN b."occupationCode" IS NULL AND cardinality(b."titleRoles") = 0 THEN ARRAY['unclassified']
  ELSE ARRAY(SELECT DISTINCT r FROM unnest(array_append(b."titleRoles", b."occupationCode")) r WHERE r IS NOT NULL) END`;

const secteursDe = Prisma.sql`CASE WHEN cardinality(b."sectorCodes") = 0 THEN ARRAY['unclassified'] ELSE b."sectorCodes" END`;

/** D-496 — les colonnes de `base` que les cercles relisent après la restriction (`scoped`). */
function colonnesProximite(cs: ReturnType<typeof cercles>): Prisma.Sql {
  return Prisma.raw(['dl', 'vt', 'vi', ...cs.filter((c) => !c.lieu).map((c) => c.colonne)].map((x) => `b.${x}`).join(', '));
}

/**
 * D-496 — LES OFFRES RETENUES d'une recherche de proximité : les rayons de chaque cercle, choisis sur la recherche
 * entière (`scoped`), puis les offres dans leurs cercles, avec leur distance de tri (`dk`, à la place du pays du
 * visiteur dans la clé du curseur). Totaux, page, facettes et curseur portent sur elles.
 */
function retenuesSql(cs: ReturnType<typeof cercles>): Prisma.Sql {
  const rayon = (i: number) => Prisma.raw(`a.r${i}`);
  return Prisma.sql`rayons AS MATERIALIZED (SELECT ${rayonsSql(cs, 's')} FROM scoped s),
    retenues AS MATERIALIZED (SELECT s.*, ${distanceDeTri(cs, rayon, 's')} AS dk FROM scoped s CROSS JOIN rayons a
      WHERE ${appartient(cs, rayon, 's')}),`;
}

/** `WHERE` composé des dimensions sélectionnées, sauf celle qu'on exclut. */
function restriction(plan: PlanRecherche, sauf?: Dimension): Prisma.Sql {
  const conditions = DIMENSIONS.flatMap((d) => {
    const valeurs = plan.selections[d];
    return d !== sauf && valeurs?.length ? [predicat(d, valeurs, plan)] : [];
  });
  return conditions.length ? Prisma.join(conditions, ' AND ') : Prisma.sql`true`;
}

const facette = (colonne: Prisma.Sql, plan: PlanRecherche, dimension: Dimension, limit?: number) => plan.proximite
  ? facetteDeProximite(plan, dimension, { source: Prisma.sql`base b`, valeur: colonne, limite: limit,
    filtre: Prisma.sql`${restriction(plan, dimension)} AND ${colonne} IS NOT NULL AND ${colonne}::text <> ''` })
  : Prisma.sql`
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
  const ville = plan.proximite?.lieu;
  if (ville) {
    // D-496 : la ville cherchée est connue de la base de villes. Une offre qui a un point est retenue dans le plus grand
    // cercle (la boîte, indexable, puis la distance exacte) ; le cercle retenu se choisit ensuite sur les offres de la
    // recherche entière. Une offre sans point n'est retenue que si sa ville porte le nom de la ville trouvée (même clé
    // de lieu) ; elle se range après les offres situées.
    const lat = Prisma.sql`${t}."geoLatitude"`, lon = Prisma.sql`${t}."geoLongitude"`;
    return [Prisma.sql`((${lat} IS NOT NULL AND ${boiteSql(ville, RAYON_MAX_KM, lat, lon)} AND ${distanceKm(ville, lat, lon)} <= ${RAYON_MAX_KM}::float8)
      OR ${memeNom(t, lat, [ville], alias)})`];
  }
  switch (lieu.type) {
    case 'teletravail':
      return [Prisma.sql`${t}."workplaceType" = 'REMOTE'`];
    case 'pays':
      return [Prisma.sql`${t}."countryCode" = ${lieu.country}`];
    case 'codePostal':
      return [Prisma.sql`upper(replace(${t}."postalCode", ' ', '')) LIKE ${`${echapperLike(lieu.postalCode.replace(/\s/g, ''))}%`}`];
    case 'ville':
      return [parTexte(lieu.cityLoose, alias)];
  }
}

/** La comparaison texte d'un lieu (avant D-496, et toujours pour un lieu que la base de villes ne connaît pas). */
function parTexte(texte: string, alias: 'j' | 'd'): Prisma.Sql {
  const t = alias === 'j' ? Prisma.sql`j` : Prisma.sql`d`;
  const propre = echapperLike(texte);
  const subdivision = alias === 'j' ? Prisma.sql`OR catwalks_normaliser_texte(j."adminArea1") LIKE ${motifNormalise(propre)}` : Prisma.empty;
  return Prisma.sql`(catwalks_normaliser_texte(${t}.city) LIKE ${motifNormalise(propre)} OR catwalks_normaliser_texte(${t}.city) LIKE ${motifNormalise(`${propre}%`)}
        OR catwalks_normaliser_texte(${t}.location) LIKE ${motifNormalise(`%${propre}%`)} ${subdivision})`;
}

/**
 * Une offre SANS point du pays d'une des villes trouvées, sans subdivision, dont la ville porte le nom de cette ville (clé
 * de lieu, évaluée sans point seulement). Une offre sans point AVEC subdivision est un homonyme que le déclencheur a
 * refusé de placer (« Austin, Ohio ») : elle n'est jamais retenue pour « Austin » (Texas).
 */
function memeNom(t: Prisma.Sql, lat: Prisma.Sql, villes: readonly VilleResolue[], alias: 'j' | 'd'): Prisma.Sql {
  const sansSubdivision = alias === 'j' ? Prisma.sql` AND ${t}."adminArea1" IS NULL` : Prisma.empty;
  return Prisma.sql`(CASE WHEN ${lat} IS NULL${sansSubdivision} THEN (${t}."countryCode", catwalks_lieu_cle(${t}.city)) IN (${Prisma.join(villes.map((v) =>
    Prisma.sql`(${v.pays}, catwalks_lieu_cle(${v.nom}))`))}) ELSE false END)`;
}

/**
 * D-496 — les colonnes de proximité de `base` : `dl`, la distance au lieu cherché ; `dv`, à la plus proche des villes du
 * filtre `ville`, et `dv0`, `dv1`… à chacune ; `vt`, une offre sans point au nom d'une de ces villes ; `vi`, une offre
 * retenue par une valeur du filtre que la base ne connaît pas. Distances nulles pour une offre sans point. Absentes sans
 * proximité : la requête reste celle d'avant.
 */
function colonnesDistance(plan: PlanRecherche, alias: 'j' | 'd'): Prisma.Sql {
  const p = plan.proximite;
  if (!p) return Prisma.empty;
  const t = alias === 'j' ? Prisma.sql`j` : Prisma.sql`d`;
  const lat = Prisma.sql`${t}."geoLatitude"`, lon = Prisma.sql`${t}."geoLongitude"`;
  const distance = (v: VilleResolue) => distanceKm(v, lat, lon);
  const dl = p.lieu ? distance(p.lieu) : Prisma.sql`NULL::float8`;
  const villes = p.villes?.resolues ?? [];
  const dv = villes.length ? (villes.length === 1 ? distance(villes[0]) : Prisma.sql`LEAST(${Prisma.join(villes.map(distance))})`) : Prisma.sql`NULL::float8`;
  const chacune = villes.map((v, i) => Prisma.sql`, ${distance(v)} AS ${Prisma.raw(`dv${i}`)}`);
  const vt = villes.length ? memeNom(t, lat, villes, alias) : Prisma.sql`false`;
  const texte = p.villes?.texte ?? [];
  const vi = texte.length ? Prisma.sql`lower(trim(${t}.city)) IN (${Prisma.join(texte.map((v) => Prisma.sql`lower(trim(${v}))`))})` : Prisma.sql`false`;
  return Prisma.sql`, ${dl} AS dl, ${dv} AS dv ${chacune.length ? Prisma.join(chacune, ' ') : Prisma.empty}, ${vt} AS vt, ${vi} AS vi`;
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

/**
 * LA BASE D'UNE RECHERCHE : les offres des deux origines que le périmètre, le lieu et le texte retiennent, avant les
 * filtres de dimension. Partagée par la recherche de `/emplois` (`searchSummary`) et l'examen d'une alerte
 * (`examenNouveautes`) : une alerte rejoue EXACTEMENT la recherche de la page (R-128 §2), donc le même SQL, jamais une
 * copie. La colonne `firstSeenAt` porte l'entrée au catalogue des deux origines (`receivedAt` d'une offre directe).
 */
async function sqlBase(plan: PlanRecherche, asOf: Date): Promise<Prisma.Sql> {
  const pays = Prisma.join(plan.perimetre.pays.map((p) => Prisma.sql`${p}`));
  const perimetre = Prisma.sql`${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays})`;
  const conditions: Prisma.Sql[] = [perimetre, ...conditionLieu(plan, 'j')];
  const conditionsDirect: Prisma.Sql[] = [perimetreDirect(pays, asOf), ...conditionLieu(plan, 'd')];

  if (plan.q) await requireSearchIndex();
  // D-488 : les variantes d'un métier sont celles des langues du marché (`search-langues.ts`) ; le chemin d'une clause de
  // métier (index plein texte ou relecture du marché) suit la taille du marché et la part du métier (`search-chemin.ts`).
  // D-500 : au client du contrat 2, la requête comprise (Q1) et le classement par le titre (Q4).
  const intention = plan.q ? (await getSearchContext()).model.intention(plan.q, plan.perimetre.marche, { comprendre: plan.comprendre }) : null;
  const repartition = intention?.clauses.some((c) => c.kind === 'role') ? await repartitionDuPerimetre(plan.perimetre.pays) : null;
  const search = intention ? searchSql(intention, { metiersSansIndex: !!repartition && metiersSansIndex(intention, repartition), classement: !!plan.comprendre }) : null;
  if (search) { conditions.push(search.condition); conditionsDirect.push(search.condition); }
  const aggregateIndex = search ? Prisma.sql`JOIN "SearchDocument" s ON s.id=j.id AND s.version=${SEARCH_VERSION} AND s.country IN (${pays})` : Prisma.empty;
  const directIndex = search ? Prisma.sql`JOIN "SearchDocument" s ON s.id='cw_'||d.id AND s.version=${SEARCH_VERSION} AND s.country IN (${pays})` : Prisma.empty;
  return Prisma.sql`
      SELECT j.id, 1 AS origine, j."occupationCode", j."titleRoles", j."countryCode", lower(trim(j.city)) AS ville, j."employmentTerm", j."workTime",
        j."programType", j."engagementType", j."postedAt", j."firstSeenAt", j.language, c.id AS "companyId", c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe,
        ${search?.score ?? Prisma.sql`0`} AS score ${colonnesDistance(plan, 'j')}
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" ${aggregateIndex}
      WHERE ${Prisma.join(conditions, ' AND ')}
      UNION ALL
      SELECT ${PREFIXE_DIRECT} || d.id, 0 AS origine, d."occupationCode", d."titleRoles", d."countryCode", lower(trim(d.city)), d."employmentTerm", d."workTime",
        d."programType", d."engagementType", d."postedAt", d."receivedAt", d.language, d."companyId", COALESCE(dc.name, d.company), d."sectorCodes", dc."parentGroup",
        ${search?.score ?? Prisma.sql`0`} ${colonnesDistance(plan, 'd')}
      FROM "DirectOffer" d LEFT JOIN "Company" dc ON dc.id = d."companyId" ${directIndex}
      WHERE ${Prisma.join(conditionsDirect, ' AND ')}`;
}

export type ExamenNouveautes = {
  /** Toutes les offres que la recherche retient, comme le total de `/emplois`. */
  total: number;
  /** Celles entrées au catalogue après `entreeApres` ET publiées après `publieeApres` ou sans date (R-130 §3). */
  nouvelles: number;
  /** Les premières nouvelles, dans l'ordre de `/emplois` (R-126) : Catwalks d'abord, score, publication, entrée. */
  ids: string[];
};

/**
 * R-130 §3 (D-464 §1) — L'EXAMEN D'UNE ALERTE : la recherche de la page, plus deux bornes de date sur les seules
 * nouvelles. Pas de facettes ni de curseur : un compte, un compte filtré, une page. Les colonnes sont des `timestamp`
 * sans fuseau écrits en UTC : les bornes sont converties comme dans `publicJobSql`, jamais selon le fuseau de session.
 */
export async function examenNouveautes(
  plan: PlanRecherche,
  entreeApres: Date,
  publieeApres: Date,
  limite: number,
): Promise<ExamenNouveautes> {
  const asOf = new Date();
  const base = await sqlBase(plan, asOf);
  // D-496 : l'alerte rejoue le cercle de la recherche ENTIÈRE (anneau retenu sur toutes ses offres), puis ses nouvelles
  // dans ce cercle, les plus proches d'abord, comme la page.
  const cs = cercles(plan);
  const prox = cs.length > 0;
  const retenues = prox ? Prisma.sql`retenues` : Prisma.sql`scoped`;
  const [r] = await prisma.$queryRaw<Array<{ total: number; nouvelles: number; ids: string[] | null }>>(Prisma.sql`
    WITH base AS MATERIALIZED (${base}),
    scoped AS MATERIALIZED (SELECT b.id, b.origine, b."postedAt", b."firstSeenAt", b.score,
      ${prox ? colonnesProximite(cs) : Prisma.sql`0 AS dk`} FROM base b WHERE ${restriction(plan)}),
    ${prox ? retenuesSql(cs) : Prisma.empty}
    nouvelles AS MATERIALIZED (
      SELECT id, origine, dk, -score AS ns, coalesce(-extract(epoch FROM "postedAt"), 1e15)::float8 AS np,
        (-extract(epoch FROM "firstSeenAt"))::float8 AS nf
      FROM ${retenues} WHERE "firstSeenAt" > (${entreeApres}::timestamptz AT TIME ZONE 'UTC')
        AND ("postedAt" IS NULL OR "postedAt" >= (${publieeApres}::timestamptz AT TIME ZONE 'UTC'))
    )
    SELECT (SELECT count(*)::int FROM ${retenues}) AS total,
      (SELECT count(*)::int FROM nouvelles) AS nouvelles,
      (SELECT jsonb_agg(id ORDER BY origine, dk, ns, np, nf, id) FROM (SELECT * FROM nouvelles ORDER BY origine, dk, ns, np, nf, id LIMIT ${limite}) p) AS ids`);
  return { total: r.total, nouvelles: r.nouvelles, ids: r.ids ?? [] };
}

export async function searchSummary(
  plan: PlanRecherche,
  curseur: CleRecherche | null,
  pageSize: number,
): Promise<SearchSummary> {
  const asOf = new Date();
  const base = await sqlBase(plan, asOf);

  // Un filtre sélectionné exige une valeur attestée. Aucun élargissement aux valeurs absentes.
  // D-419 §2 : le pays du visiteur d'abord, à l'intérieur du périmètre. Jamais un filtre.
  // D-496 : avec une ville cherchée, la distance (km entiers) prend cette place ; le cercle se choisit sur la recherche
  // entière (`retenues`), et totaux, page et curseur portent sur lui.
  const cs = cercles(plan);
  const prox = cs.length > 0;
  const retenues = prox ? Prisma.sql`retenues` : Prisma.sql`scoped`;
  const priorite = prox ? Prisma.sql`0`
    : plan.prioritePays ? Prisma.sql`(CASE WHEN b."countryCode" = ${plan.prioritePays} THEN 0 ELSE 1 END)` : Prisma.sql`0`;
  const apres = curseur
    ? Prisma.sql`WHERE (origine, nc, pri, ns, np, nf, id) > (${curseur[0]}::int, ${curseur[1]}::int, ${curseur[2]}::int, ${curseur[3]}::int, ${curseur[4]}::float8, ${curseur[5]}::float8, ${curseur[6]}::text)`
    : Prisma.empty;

  const [[summary], totalPerimetre] = await Promise.all([prisma.$queryRaw<Array<Omit<SearchSummary, 'ids' | 'suivant' | 'totalPerimetre'> & { page: Array<{ id: string; k: CleRecherche }> | null }>>(Prisma.sql`
    WITH base AS MATERIALIZED (${base}), scoped AS MATERIALIZED (
      SELECT b.id, b.origine, b."countryCode", b."postedAt", b."firstSeenAt", true AS confirme, ${priorite} AS pri, b.score
        ${prox ? Prisma.sql`, ${colonnesProximite(cs)}` : Prisma.empty}
      FROM base b WHERE ${restriction(plan)}
    ), ${prox ? retenuesSql(cs) : Prisma.empty}
    cles AS (
      SELECT id, origine, (NOT confirme)::int AS nc, ${prox ? Prisma.sql`dk` : Prisma.sql`pri`} AS pri, -score AS ns,
        coalesce(-extract(epoch FROM "postedAt"), 1e15)::float8 AS np, (-extract(epoch FROM "firstSeenAt"))::float8 AS nf, confirme
      FROM ${retenues}
    )
    SELECT
      (SELECT count(*)::int FROM ${retenues}) AS total,
      (SELECT count(*)::int FROM ${retenues} WHERE confirme) AS "totalConfirmes",
      (SELECT jsonb_agg(jsonb_build_object('id', id, 'k', jsonb_build_array(origine, nc, pri, ns, np, nf, id)) ORDER BY origine, nc, pri, ns, np, nf, id)
         FROM (SELECT * FROM cles ${apres} ORDER BY origine, nc, pri, ns, np, nf, id LIMIT ${pageSize + 1}) p) AS page,
      jsonb_build_object(
        'pays', ${facette(Prisma.sql`b."countryCode"`, plan, 'pays')},
        'metier', ${prox ? facetteDeProximite(plan, 'metier', { source: Prisma.sql`base b CROSS JOIN LATERAL unnest(${metiersDe}) code`,
          valeur: Prisma.sql`code`, filtre: restriction(plan, 'metier') }) : Prisma.sql`(SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(${metiersDe}) code
            WHERE ${restriction(plan, 'metier')} GROUP BY code) f)`},
        'secteur', ${prox ? facetteDeProximite(plan, 'secteur', { source: Prisma.sql`base b CROSS JOIN LATERAL unnest(${secteursDe}) code`,
          valeur: Prisma.sql`code`, filtre: restriction(plan, 'secteur') }) : Prisma.sql`(SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(${secteursDe}) code WHERE ${restriction(plan, 'secteur')} GROUP BY code) f)`},
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
