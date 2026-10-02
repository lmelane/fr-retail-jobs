import { getSearchContext, requireSearchIndex, SEARCH_VERSION } from './search-index';
import { intituleSql, searchSql } from './search-sql';
import { metiersSansIndex, repartitionDuPerimetre } from './search-chemin';
import { publicJobSql } from '@catwalks/db/availability';
import { Prisma, prisma } from '@catwalks/db';
import { echapperLike } from './like';
import { PREFIXE_DIRECT, directPubliableSql } from './direct-offers';
import { DIMENSIONS, DIMENSIONS_A_PART, DIMENSIONS_EN_LISTE, DIMENSIONS_NON_PRECISEES, alerteForte, type Dimension, type DimensionNonPrecisee, type PlanRecherche } from './search-plan';
import { RAYON_MAX_KM, boiteSql, distanceKm, type VilleResolue } from './geo';
import { appartient, cercles, facetteDeProximite, rayonsSql } from './proximite-sql';
import { fraicheurSql } from './fraicheur';
import { COLONNES_CLASSEMENT, POINTS, ageJoursSql, composantes, instantDeReference, scoreNegatifSql } from './classement';

export type Facet = { value: string; count: number };

/**
 * La clé ordonnée d'une ligne servie au contrat 1 (lot 7) : origine (Catwalks = 0), non confirmée (0/1), pays du
 * visiteur d'abord (0/1, D-419 §2), score négatif, date de publication négative en secondes (sans date : 1e15, donc
 * dernière), première observation négative, identifiant. Tout est croissant : une comparaison de lignes SQL suffit à
 * reprendre APRÈS une clé.
 */
export type CleRecherche = [number, number, number, number, number, number, string];
export const ARITE_CLE_RECHERCHE = 7;

/**
 * D-510 — la clé du contrat 2 : origine (Catwalks = 0), offre non précisée sur un filtre d'emploi (0/1, D-513 : les
 * reconnues d'abord), fraîcheur négative en secondes (`fraicheur.ts`), identifiant. La distance, la pertinence et le pays
 * du visiteur ne trient plus. L'empreinte d'une recherche triée par fraîcheur porte le tri (`empreintePlan`) : un curseur
 * de l'autre ordre, ou de la clé à trois termes d'avant D-513, est refusé, jamais repris au milieu d'un ordre qui n'est
 * pas le sien.
 */
export type CleFraicheur = [number, number, number, string];
export const ARITE_CLE_FRAICHEUR = 4;

/**
 * R-143 §7 (D-513) — la clé du classement pertinent, au contrat 2, quand le candidat a dit ce qu'il cherche : l'instant
 * de référence du score (secondes, `classement.ts` : il fixe l'âge de chaque offre pour toutes les pages d'une même
 * lecture), puis origine (Catwalks = 0), non précisée sur un filtre d'emploi (0/1), score négatif quantifié, fraîcheur
 * négative, identifiant. Six termes : un curseur de l'ordre par fraîcheur (quatre) ou du contrat 1 (sept) est refusé par
 * son arité autant que par l'empreinte (`empreintePlan`, qui porte `tri: 'pertinence'` et les préférences).
 */
export type CleScore = [number, number, number, number, number, string];
export const ARITE_CLE_SCORE = 6;

export type SearchSummary = {
  ids: string[];
  /** La clé de la dernière ligne servie quand une suite existe ; `null` à la fin. */
  suivant: CleRecherche | CleFraicheur | CleScore | null;
  /** Toutes les offres du périmètre qui répondent à la recherche, confirmées ou non. */
  total: number;
  /** Celles dont chaque dimension tolérante filtrée est renseignée (D-435) ; toutes, sans `nonPrecisees`. */
  totalConfirmes: number;
  /** D-513 : pour chaque offre de la page qui ne précise pas une dimension filtrée, ces dimensions. */
  nonPrecisees: Record<string, DimensionNonPrecisee[]>;
  /** R-143 §7 : au classement pertinent, les points de chaque offre de la page (`lireClassement`). */
  classement: Record<string, (number | null)[]>;
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

/**
 * D-513, R-143 §6 — l'offre PRÉCISE-t-elle cette dimension d'emploi ? Le contrat unifié l'est dès qu'un de ses faits
 * existe (durée, dispositif, freelance) : une alternance, un stage déclarent ce qu'ils sont. Sans le contrat 2
 * (`nonPrecisees`), la question ne se pose pas : le filtre est strict, comme avant.
 */
function precise(dimension: DimensionNonPrecisee, plan: PlanRecherche): Prisma.Sql {
  switch (dimension) {
    case 'temps':
      return Prisma.sql`b."workTime" IS NOT NULL`;
    // D-515 §1 : le secteur de la Maison, la langue du texte. Une chaîne vide ne dit rien (`facette` l'écarte aussi).
    case 'secteur':
      return Prisma.sql`cardinality(b."sectorCodes") > 0`;
    case 'langue':
      return Prisma.sql`coalesce(b.language, '') <> ''`;
    // Le programme est un fait du contrat : une offre qui déclare sa durée, un dispositif ou le freelance le précise.
    case 'programme':
      return Prisma.sql`cardinality(${choixContrat}) > 0`;
    case 'contrat':
      return plan.perimetre.marche?.contratUnifie ? Prisma.sql`cardinality(${choixContrat}) > 0` : Prisma.sql`b."employmentTerm" IS NOT NULL`;
  }
}

/**
 * Une dimension filtrée, au contrat 2 seulement, dont l'inconnu peut être retenu. Le secteur « Non classé »
 * (`unclassified`) choisi demande les offres sans secteur : elles le précisent alors, la dimension n'est pas tolérante.
 */
const filtree = (plan: PlanRecherche, d: DimensionNonPrecisee) => !!plan.nonPrecisees && (plan.selections[d]?.length ?? 0) > 0
  && !(d === 'secteur' && plan.selections.secteur!.includes('unclassified'));

/**
 * Les dimensions filtrées dont une offre non précisée est retenue : celles de la liste (contrat, temps : D-513) ; avec
 * `large`, aussi celles qui forment une section à part (secteur, langue, programme : D-515 §1), pour la section elle-même
 * et pour une alerte forte (`alerteForte`). Ordre fixe, celui de `DIMENSIONS_NON_PRECISEES`.
 */
const nonPreciseesFiltrees = (plan: PlanRecherche, large = false): DimensionNonPrecisee[] =>
  DIMENSIONS_NON_PRECISEES.filter((d) => filtree(plan, d) && (large || (DIMENSIONS_EN_LISTE as readonly string[]).includes(d)));

/** D-515 §1 : l'offre précise-t-elle chaque filtre de `DIMENSIONS_A_PART` ? Vrai sans aucun de ces filtres. */
function aPartPreciseSql(plan: PlanRecherche): Prisma.Sql {
  const dims = DIMENSIONS_A_PART.filter((d) => filtree(plan, d));
  return dims.length ? Prisma.join(dims.map((d) => Prisma.sql`(${precise(d, plan)})`), ' AND ') : Prisma.sql`true`;
}

/**
 * La colonne `ap` (`aPartPreciseSql`), lue par la seule section des inconnues (`sectionSql`) ; absente ailleurs : la requête
 * de la liste reste celle d'avant, au caractère près (164 requêtes du contrat 1 comparées).
 */
const colonneAPart = (plan: PlanRecherche, large: boolean): Prisma.Sql => (large ? Prisma.sql`${aPartPreciseSql(plan)} AS ap, ` : Prisma.empty);

/** Une offre CONFIRME la recherche quand elle précise chaque dimension tolérée filtrée ; sans `nonPrecisees`, toujours. */
function confirmeSql(plan: PlanRecherche, large = false): Prisma.Sql {
  const dims = nonPreciseesFiltrees(plan, large);
  return dims.length ? Prisma.join(dims.map((d) => Prisma.sql`(${precise(d, plan)})`), ' AND ') : Prisma.sql`true`;
}

/** Les dimensions filtrées que l'offre ne précise pas, pour la signaler sur sa carte (`correspondance`). */
function nonPreciseesSql(plan: PlanRecherche, large = false): Prisma.Sql {
  const dims = nonPreciseesFiltrees(plan, large);
  if (!dims.length) return Prisma.sql`ARRAY[]::text[]`;
  return Prisma.sql`array_remove(ARRAY[${Prisma.join(dims.map((d) => Prisma.sql`CASE WHEN ${precise(d, plan)} THEN NULL ELSE ${d} END`))}]::text[], NULL)`;
}

/** Le prédicat SQL d'une dimension sélectionnée, sur l'alias `b` de `base`. */
function predicat(dimension: Dimension, valeurs: readonly string[], plan: PlanRecherche, large = false): Prisma.Sql {
  const liste = Prisma.join(valeurs.map((v) => Prisma.sql`${v}`));
  // D-513, D-515 §1 : au contrat 2, une offre qui ne précise pas la dimension reste retenue ; une offre qui déclare autre
  // chose, non. Seules les dimensions tolérées de CETTE lecture (`nonPreciseesFiltrees`) s'élargissent.
  const ouNonPrecisee = (strict: Prisma.Sql) => (nonPreciseesFiltrees(plan, large) as readonly Dimension[]).includes(dimension)
    ? Prisma.sql`(${strict} OR NOT (${precise(dimension as DimensionNonPrecisee, plan)}))` : strict;
  if (dimension === 'contrat' && plan.perimetre.marche?.contratUnifie) {
    return ouNonPrecisee(Prisma.sql`${choixContrat} && ARRAY[${liste}]::text[]`);
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
      return ouNonPrecisee(Prisma.sql`(${Prisma.join(valeurs.map((v) => v === 'unclassified'
        ? Prisma.sql`cardinality(b."sectorCodes") = 0` : Prisma.sql`b."sectorCodes" @> ARRAY[${v}]::text[]`), ' OR ')})`);
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
      return ouNonPrecisee(dedans);
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
 * entière (`scoped`), puis les offres dans leurs cercles. Totaux, page, facettes et curseur portent sur elles.
 * D-510 : la distance ne trie plus ; elle ne sert qu'à retenir les offres dans leurs cercles.
 * D-513 : les rayons se choisissent sur les offres CONFIRMÉES seules. Les offres qui ne précisent pas le contrat ou le
 * temps de travail filtré s'ajoutent dans ce même cercle, après : elles ne rétrécissent jamais le cercle d'une recherche
 * « CDI » (vingt offres sans contrat à côté ne cachent pas un CDI à 40 km) ; la section certaine d'une alerte garde
 * exactement le cercle et les offres de la recherche stricte d'avant, sa section incomplète (D-515 §2) ce même cercle.
 */
function retenuesSql(cs: ReturnType<typeof cercles>): Prisma.Sql {
  const rayon = (i: number) => Prisma.raw(`a.r${i}`);
  return Prisma.sql`rayons AS MATERIALIZED (SELECT ${rayonsSql(cs, 's')} FROM scoped s WHERE s.confirme),
    retenues AS MATERIALIZED (SELECT s.* FROM scoped s CROSS JOIN rayons a WHERE ${appartient(cs, rayon, 's')}),`;
}

/** D-510 — la fraîcheur négative d'une ligne (secondes) : croissante comme le reste de la clé, la plus fraîche d'abord. */
const fraicheurNegative = Prisma.sql`(-extract(epoch FROM ${fraicheurSql()}))::float8`;

/** R-143 §7 — les points de chaque critère d'une ligne de `base` (`classement.ts`), colonnes `pi` … `ps` de `scoped`. */
function colonnesClassement(plan: PlanRecherche): Prisma.Sql {
  if (!plan.pertinence) return Prisma.empty;
  const c = composantes(plan);
  return Prisma.sql`, ${c.intitule} AS pi, ${c.lieu} AS pl, ${c.contrat} AS pc, ${c.teletravail} AS pt, ${c.salaire} AS ps`;
}

/**
 * `WHERE` composé des dimensions sélectionnées, sauf celle qu'on exclut. `large` (D-515 §1) : les inconnues des
 * dimensions à part sont retenues aussi (section des inconnues, alerte forte) ; sans lui, la liste des confirmées.
 */
function restriction(plan: PlanRecherche, sauf?: Dimension, large = false): Prisma.Sql {
  const conditions = DIMENSIONS.flatMap((d) => {
    const valeurs = plan.selections[d];
    return d !== sauf && valeurs?.length ? [predicat(d, valeurs, plan, large)] : [];
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
  // D-500 : au client du contrat 2, la requête comprise (Q1).
  const intention = plan.q ? (await getSearchContext()).model.intention(plan.q, plan.perimetre.marche, { comprendre: plan.comprendre }) : null;
  const repartition = intention?.clauses.some((c) => c.kind === 'role') ? await repartitionDuPerimetre(plan.perimetre.pays) : null;
  const search = intention ? searchSql(intention, { metiersSansIndex: !!repartition && metiersSansIndex(intention, repartition) }) : null;
  // D-510 : triée par fraîcheur, la recherche ne calcule pas la pertinence ; la correspondance (`condition`) reste.
  const score = search && !plan.fraicheur ? search.score : Prisma.sql`0`;
  // R-143 §7 : au classement pertinent, les points de l'intitulé (`ri`) et les colonnes que les critères relisent. Absents
  // sinon : la requête de D-510 et celle du contrat 1 restent celles d'avant, aux espaces près (152 requêtes comparées).
  const ri = (t: Prisma.Sql) => (plan.pertinence && intention ? intituleSql(intention, POINTS.intitule, t) : null) ?? Prisma.sql`NULL::int`;
  const classementJ = plan.pertinence ? Prisma.sql`, ${ri(Prisma.sql`j."occupationCode"`)} AS ri ${COLONNES_CLASSEMENT.agregee}` : Prisma.empty;
  const classementD = plan.pertinence ? Prisma.sql`, ${ri(Prisma.sql`d."occupationCode"`)} ${COLONNES_CLASSEMENT.directe}` : Prisma.empty;
  if (search) { conditions.push(search.condition); conditionsDirect.push(search.condition); }
  const aggregateIndex = search ? Prisma.sql`JOIN "SearchDocument" s ON s.id=j.id AND s.version=${SEARCH_VERSION} AND s.country IN (${pays})` : Prisma.empty;
  const directIndex = search ? Prisma.sql`JOIN "SearchDocument" s ON s.id='cw_'||d.id AND s.version=${SEARCH_VERSION} AND s.country IN (${pays})` : Prisma.empty;
  return Prisma.sql`
      SELECT j.id, 1 AS origine, j."occupationCode", j."titleRoles", j."countryCode", lower(trim(j.city)) AS ville, j."employmentTerm", j."workTime",
        j."programType", j."engagementType", j."postedAt", j."firstSeenAt", j.language, c.id AS "companyId", c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe,
        ${score} AS score ${colonnesDistance(plan, 'j')} ${classementJ}
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" ${aggregateIndex}
      WHERE ${Prisma.join(conditions, ' AND ')}
      UNION ALL
      SELECT ${PREFIXE_DIRECT} || d.id, 0 AS origine, d."occupationCode", d."titleRoles", d."countryCode", lower(trim(d.city)), d."employmentTerm", d."workTime",
        d."programType", d."engagementType", d."postedAt", d."receivedAt", d.language, d."companyId", COALESCE(dc.name, d.company), d."sectorCodes", dc."parentGroup",
        ${score} ${colonnesDistance(plan, 'd')} ${classementD}
      FROM "DirectOffer" d LEFT JOIN "Company" dc ON dc.id = d."companyId" ${directIndex}
      WHERE ${Prisma.join(conditionsDirect, ' AND ')}`;
}

export type ExamenNouveautes = {
  /** Toutes les offres que la recherche retient, comme le total de `/emplois`. */
  total: number;
  /** Celles entrées au catalogue après `entreeApres` ET publiées après `publieeApres` ou sans date (R-130 §3). */
  nouvelles: number;
  /**
   * Les premières nouvelles, dans l'ordre de `/emplois` (R-126) : Catwalks d'abord, score, publication, entrée ; au
   * contrat 2 (D-510), Catwalks d'abord puis la plus fraîche ; au contrat 2 avec une requête ou un métier (R-143 §7),
   * Catwalks d'abord puis le score décru par l'âge (`classement.ts`).
   */
  ids: string[];
  /**
   * D-515 §2 — pour une alerte forte (`alerteForte` : métier ou lieu posés), les nouvelles qui respectent avec certitude
   * tous les autres critères (métier, lieu, cercle, Maison…) mais ne précisent pas le contrat, le temps de travail, le
   * secteur, la langue ou le programme filtrés : envoyées APRÈS les certaines, séparées et signalées. Toujours 0 sinon.
   * Une offre qui déclare une autre valeur n'en fait jamais partie (`predicat`). Vides sans `nonPrecisees` (contrat 1).
   */
  incompletes: number;
  /** Les premières incomplètes dans l'ordre de la page, chacune avec les dimensions qu'elle ne précise pas. */
  idsIncompletes: Array<{ id: string; dimensions: DimensionNonPrecisee[] }>;
};

/**
 * R-130 §3 (D-464 §1) — L'EXAMEN D'UNE ALERTE : la recherche de la page, plus deux bornes de date sur les seules
 * nouvelles. Pas de facettes ni de curseur : un compte, un compte filtré, une page. Les colonnes sont des `timestamp`
 * sans fuseau écrits en UTC : les bornes sont converties comme dans `publicJobSql`, jamais selon le fuseau de session.
 */
export async function examenNouveautes(
  planDemande: PlanRecherche,
  entreeApres: Date,
  publieeApres: Date,
  limite: number,
): Promise<ExamenNouveautes> {
  // D-515 §2 (« correspond fortement au reste des préférences ») : sans métier ni lieu posés (`alerteForte`), une alerte n'a
  // AUCUNE section des incomplètes, quelle que soit la dimension inconnue, contrat et temps de travail compris : ses filtres
  // y sont stricts, comme au contrat 1. Une alerte « CDI » seule n'envoie que des CDI confirmés ; ses certaines ne changent
  // pas (une offre confirmée précise le contrat, le filtre strict retient exactement celles-là).
  const plan: PlanRecherche = planDemande.nonPrecisees && !alerteForte(planDemande) ? { ...planDemande, nonPrecisees: undefined } : planDemande;
  const asOf = new Date();
  const base = await sqlBase(plan, asOf);
  // D-496 : l'alerte rejoue le cercle de la recherche ENTIÈRE (anneau retenu sur ses offres reconnues, D-513), puis ses nouvelles
  // dans ce cercle. D-510 : au contrat 2, dans l'ordre de la page, Catwalks d'abord puis la plus fraîche ; au contrat 1,
  // l'ordre d'avant (la proximité n'y existe pas).
  const cs = cercles(plan);
  const prox = cs.length > 0;
  const retenues = prox ? Prisma.sql`retenues` : Prisma.sql`scoped`;
  // D-515 §1, §2 : les inconnues du secteur, de la langue ou du programme ne partent, à part, que si l'alerte correspond
  // fortement (métier ou lieu confirmés, `alerteForte`) ; celles du contrat et du temps de travail aussi (plus haut).
  const large = !!plan.nonPrecisees && alerteForte(plan);
  // R-143 §7 : une alerte qui porte une requête rend ses nouvelles dans l'ordre pertinent de la page, à l'instant de l'examen.
  const t0 = plan.pertinence ? instantDeReference() : 0;
  const ordre = plan.pertinence ? Prisma.sql`origine, ns, nf, id` : plan.fraicheur ? Prisma.sql`origine, nf, id` : Prisma.sql`origine, ns, np, nf, id`;
  const [r] = await prisma.$queryRaw<Array<{ total: number; nouvelles: number; ids: string[] | null; incompletes: number;
    "idsIncompletes": Array<{ id: string; n: DimensionNonPrecisee[] }> | null }>>(Prisma.sql`
    WITH base AS MATERIALIZED (${base}),
    -- D-513 : la recherche de la page, offres non précisées comprises. D-515 §2 : l'alerte envoie d'abord les confirmées,
    -- puis, séparées, les non précisées du même cercle (npr : les dimensions qu'elles ne précisent pas).
    scoped AS MATERIALIZED (SELECT b.id, b.origine, b."postedAt", b."firstSeenAt", b.score, ${confirmeSql(plan, large)} AS confirme,
      ${nonPreciseesSql(plan, large)} AS npr
      ${prox ? Prisma.sql`, ${colonnesProximite(cs)}` : Prisma.empty} ${colonnesClassement(plan)} FROM base b WHERE ${restriction(plan, undefined, large)}),
    ${prox ? retenuesSql(cs) : Prisma.empty}
    nouvelles AS MATERIALIZED (
      SELECT id, origine, confirme, npr, ${plan.pertinence ? Prisma.sql`${scoreNegatifSql(t0)} AS ns, ${fraicheurNegative} AS nf` : plan.fraicheur ? Prisma.sql`${fraicheurNegative} AS nf`
        : Prisma.sql`-score AS ns, coalesce(-extract(epoch FROM "postedAt"), 1e15)::float8 AS np, (-extract(epoch FROM "firstSeenAt"))::float8 AS nf`}
      FROM ${retenues} WHERE "firstSeenAt" > (${entreeApres}::timestamptz AT TIME ZONE 'UTC')
        AND ("postedAt" IS NULL OR "postedAt" >= (${publieeApres}::timestamptz AT TIME ZONE 'UTC'))
    )
    SELECT (SELECT count(*)::int FROM ${retenues} WHERE confirme) AS total,
      (SELECT count(*)::int FROM nouvelles WHERE confirme) AS nouvelles,
      (SELECT jsonb_agg(id ORDER BY ${ordre}) FROM (SELECT * FROM nouvelles WHERE confirme ORDER BY ${ordre} LIMIT ${limite}) p) AS ids,
      (SELECT count(*)::int FROM nouvelles WHERE NOT confirme) AS incompletes,
      (SELECT jsonb_agg(jsonb_build_object('id', id, 'n', npr) ORDER BY ${ordre})
         FROM (SELECT * FROM nouvelles WHERE NOT confirme ORDER BY ${ordre} LIMIT ${limite}) p) AS "idsIncompletes"`);
  return { total: r.total, nouvelles: r.nouvelles, ids: r.ids ?? [], incompletes: r.incompletes,
    idsIncompletes: (r.idsIncompletes ?? []).map((x) => ({ id: x.id, dimensions: x.n ?? [] })) };
}

/**
 * D-515 §1 — LA SECTION DES INCONNUES : la recherche lue largement (inconnues des dimensions à part retenues), dans le
 * cercle choisi sur les confirmées (`retenuesSql`), réduite aux offres qui ne précisent pas un filtre à part. Les facettes
 * restent celles de la liste des confirmées (`facettesSql`, lecture stricte).
 */
function sectionSql(large: boolean, prox: boolean): Prisma.Sql {
  return large ? Prisma.sql`servies AS MATERIALIZED (SELECT * FROM ${prox ? Prisma.sql`retenues` : Prisma.sql`scoped`} WHERE NOT ap),` : Prisma.empty;
}

/** Les facettes d'une recherche (une seule définition pour les deux ordres de la page). */
function facettesSql(plan: PlanRecherche, prox: boolean): Prisma.Sql {
  return Prisma.sql`      jsonb_build_object(
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
      )`;
}

export async function searchSummary(
  plan: PlanRecherche,
  curseur: CleRecherche | CleFraicheur | CleScore | null,
  pageSize: number,
): Promise<SearchSummary> {
  const asOf = new Date();
  const base = await sqlBase(plan, asOf);

  // Un filtre sélectionné exige une valeur attestée. Aucun élargissement aux valeurs absentes — sauf au contrat 2
  // (`nonPrecisees`, D-513) : une offre qui ne précise pas le contrat ou le temps de travail filtré reste servie, non
  // confirmée, après les confirmées (`nc` dans la clé), et la page dit lesquelles (`npr`). Celles qui ne précisent pas le
  // secteur, la langue ou le programme filtrés ne sont jamais dans la liste : elles forment sa section à part
  // (`section: 'inconnues'`, `sectionSql`, D-515 §1).
  // D-419 §2 (contrat 1) : le pays du visiteur d'abord, à l'intérieur du périmètre. Jamais un filtre.
  // D-496 : avec une ville cherchée, le cercle se choisit sur la recherche entière, offres reconnues (D-513, `retenues`), et totaux, page et
  // curseur portent sur lui. D-510 (contrat 2) : l'ordre est l'origine, la fraîcheur, l'identifiant.
  const cs = cercles(plan);
  const prox = cs.length > 0;
  const large = plan.section === 'inconnues';
  const retenues = large ? Prisma.sql`servies` : prox ? Prisma.sql`retenues` : Prisma.sql`scoped`;
  const fraicheur = !!plan.fraicheur;
  const priorite = !fraicheur && !prox && plan.prioritePays
    ? Prisma.sql`(CASE WHEN b."countryCode" = ${plan.prioritePays} THEN 0 ELSE 1 END)` : Prisma.sql`0`;
  if (plan.pertinence) return pageClassee(plan, base, curseur as CleScore | null, pageSize, asOf);
  const colonnesCle = fraicheur ? Prisma.sql`origine, nc, nf, id` : Prisma.sql`origine, nc, pri, ns, np, nf, id`;
  const apres = !curseur ? Prisma.empty : fraicheur
    ? Prisma.sql`WHERE (origine, nc, nf, id) > (${curseur[0]}::int, ${curseur[1]}::int, ${curseur[2]}::float8, ${curseur[3]}::text)`
    : Prisma.sql`WHERE (origine, nc, pri, ns, np, nf, id) > (${curseur[0]}::int, ${curseur[1]}::int, ${curseur[2]}::int, ${curseur[3]}::int, ${curseur[4]}::float8, ${curseur[5]}::float8, ${curseur[6]}::text)`;
  const cles = fraicheur
    ? Prisma.sql`SELECT id, origine, (NOT confirme)::int AS nc, ${fraicheurNegative} AS nf, confirme, npr FROM ${retenues}`
    : Prisma.sql`SELECT id, origine, (NOT confirme)::int AS nc, pri, -score AS ns,
        coalesce(-extract(epoch FROM "postedAt"), 1e15)::float8 AS np, (-extract(epoch FROM "firstSeenAt"))::float8 AS nf, confirme, npr
      FROM ${retenues}`;

  const [[summary], totalPerimetre] = await Promise.all([prisma.$queryRaw<Array<Omit<SearchSummary, 'ids' | 'suivant' | 'totalPerimetre' | 'nonPrecisees'> & { page: Array<{ id: string; k: CleRecherche | CleFraicheur; n: DimensionNonPrecisee[] }> | null }>>(Prisma.sql`
    WITH base AS MATERIALIZED (${base}), scoped AS MATERIALIZED (
      SELECT b.id, b.origine, b."countryCode", b."postedAt", b."firstSeenAt", ${confirmeSql(plan, large)} AS confirme, ${nonPreciseesSql(plan, large)} AS npr,
        ${colonneAPart(plan, large)}${priorite} AS pri, b.score
        ${prox ? Prisma.sql`, ${colonnesProximite(cs)}` : Prisma.empty}
      FROM base b WHERE ${restriction(plan, undefined, large)}
    ), ${prox ? retenuesSql(cs) : Prisma.empty}
    ${sectionSql(large, prox)}
    cles AS (${cles})
    SELECT
      (SELECT count(*)::int FROM ${retenues}) AS total,
      (SELECT count(*)::int FROM ${retenues} WHERE confirme) AS "totalConfirmes",
      (SELECT jsonb_agg(jsonb_build_object('id', id, 'k', jsonb_build_array(${colonnesCle}), 'n', npr) ORDER BY ${colonnesCle})
         FROM (SELECT * FROM cles ${apres} ORDER BY ${colonnesCle} LIMIT ${pageSize + 1}) p) AS page,
${facettesSql(plan, prox)} AS facettes
  `), compterPerimetre(plan.perimetre.pays, asOf)]);
  const page = summary.page ?? [];
  const servies = page.slice(0, pageSize);
  return {
    ids: servies.map((p) => p.id),
    suivant: page.length > pageSize ? servies[servies.length - 1].k : null,
    total: summary.total,
    totalConfirmes: summary.totalConfirmes,
    nonPrecisees: Object.fromEntries(servies.filter((p) => p.n?.length).map((p) => [p.id, p.n])),
    classement: {},
    totalPerimetre,
    facettes: summary.facettes,
  };
}

/**
 * R-143 §7 — LA PAGE CLASSÉE : la même recherche (base, filtres, cercles, totaux, facettes), dans l'ordre pertinent. Le
 * score dépend de l'âge de chaque offre ; l'instant de référence `t0` vient du curseur (pages suivantes) ou de la
 * première page, pour qu'une lecture page après page ne voie ni doublon ni trou quand le temps passe.
 */
async function pageClassee(plan: PlanRecherche, base: Prisma.Sql, curseur: CleScore | null, pageSize: number, asOf: Date): Promise<SearchSummary> {
  const cs = cercles(plan);
  const prox = cs.length > 0;
  const large = plan.section === 'inconnues';
  const retenues = large ? Prisma.sql`servies` : prox ? Prisma.sql`retenues` : Prisma.sql`scoped`;
  const t0 = curseur ? curseur[0] : instantDeReference(asOf.getTime());
  const colonnesCle = Prisma.sql`origine, nc, ns, nf, id`;
  const apres = curseur
    ? Prisma.sql`WHERE (origine, nc, ns, nf, id) > (${curseur[1]}::int, ${curseur[2]}::int, ${curseur[3]}::bigint, ${curseur[4]}::float8, ${curseur[5]}::text)`
    : Prisma.empty;
  const [[summary], totalPerimetre] = await Promise.all([prisma.$queryRaw<Array<Omit<SearchSummary, 'ids' | 'suivant' | 'totalPerimetre' | 'nonPrecisees' | 'classement'> & { page: Array<{ id: string; k: CleScore; n: DimensionNonPrecisee[]; c: (number | null)[] }> | null }>>(Prisma.sql`
    WITH base AS MATERIALIZED (${base}), scoped AS MATERIALIZED (
      SELECT b.id, b.origine, b."countryCode", b."postedAt", b."firstSeenAt", ${confirmeSql(plan, large)} AS confirme, ${nonPreciseesSql(plan, large)} AS npr
        ${large ? Prisma.sql`, ${aPartPreciseSql(plan)} AS ap` : Prisma.empty}
        ${prox ? Prisma.sql`, ${colonnesProximite(cs)}` : Prisma.empty} ${colonnesClassement(plan)}
      FROM base b WHERE ${restriction(plan, undefined, large)}
    ), ${prox ? retenuesSql(cs) : Prisma.empty}
    ${sectionSql(large, prox)}
    cles AS (SELECT id, origine, (NOT confirme)::int AS nc, ${scoreNegatifSql(t0)} AS ns, ${fraicheurNegative} AS nf, npr,
      jsonb_build_array(pi, pl, pc, pt, ps, round(${ageJoursSql(t0)}::numeric, 2)) AS c FROM ${retenues})
    SELECT
      (SELECT count(*)::int FROM ${retenues}) AS total,
      (SELECT count(*)::int FROM ${retenues} WHERE confirme) AS "totalConfirmes",
      (SELECT jsonb_agg(jsonb_build_object('id', id, 'k', jsonb_build_array(${t0}::bigint, ${colonnesCle}), 'n', npr, 'c', c) ORDER BY ${colonnesCle})
         FROM (SELECT * FROM cles ${apres} ORDER BY ${colonnesCle} LIMIT ${pageSize + 1}) p) AS page,
${facettesSql(plan, prox)} AS facettes
  `), compterPerimetre(plan.perimetre.pays, asOf)]);
  const page = summary.page ?? [];
  const servies = page.slice(0, pageSize);
  return {
    ids: servies.map((p) => p.id),
    suivant: page.length > pageSize ? servies[servies.length - 1].k : null,
    total: summary.total,
    totalConfirmes: summary.totalConfirmes,
    nonPrecisees: Object.fromEntries(servies.filter((p) => p.n?.length).map((p) => [p.id, p.n])),
    classement: Object.fromEntries(servies.map((p) => [p.id, p.c])),
    totalPerimetre,
    facettes: summary.facettes,
  };
}
