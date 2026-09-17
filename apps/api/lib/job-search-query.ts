import { publicJobSql } from '@catwalks/db/availability';
import { Prisma, prisma } from '@catwalks/db';
import { getOptionalOccupationPresentation, type OptionalOccupationPresentation } from './occupations';
import { companyAliasSql } from './company-identity';
import { expandCompanyTerm } from './groups';
import { echapperLike } from './like';
import { PREFIXE_DIRECT, directPubliableSql } from './direct-offers';
import { DIMENSIONS, DIMENSIONS_TOLERANTES, type Dimension, type DimensionTolerante, type PlanRecherche } from './search-plan';

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

/**
 * LE SEUL CHEMIN SQL DE LA RECHERCHE (lots 6 et 7).
 *
 *  - `base` : l'UNION des deux origines — les publications agrégées (`Job`)
 *    et les offres directes Catwalks (`DirectOffer`, D-423) — dans le
 *    PÉRIMÈTRE (les pays du marché, obligatoire), avec le lieu et le SCORE ;
 *    tout ce qui n'est pas une facette. L'union précède les filtres, le tri
 *    et la pagination : deux pages déjà paginées ne s'additionnent jamais.
 *  - Le TEXTE (lot 7) : chaque offre porte dans la base deux vecteurs de MOTS
 *    (migration 20260916210000) — `searchVector`, tout le texte indexé, qui
 *    filtre par l'index GIN ; `titleVector`, le titre (A) et la Maison (B),
 *    qui classe. Un mot est une suite de lettres ou de chiffres du texte
 *    normalisé (minuscules, sans accents, apostrophes unifiées) et un terme
 *    s'apparie au DÉBUT d'un mot : « école », « ecole » et « ÉCOLE » sont la
 *    même recherche, « vente » trouve « ventes », « ente » ne trouve rien.
 *    Les écritures sans espaces (chinois, japonais…) n'ont pas de mots : leurs
 *    termes s'apparient n'importe où, par `LIKE` sur le texte normalisé, et
 *    un joker y est littéral. Pour chaque terme : le vecteur le contient, OU
 *    l'offre appartient à une Maison que le terme désigne (nom, groupe, alias,
 *    Maisons du groupe du référentiel), résolue UNE fois en identifiants
 *    (`maisons_i`) ; ET entre les termes ; OU les codes métier de la taxonomie
 *    sur la requête entière. Le vecteur porte aussi l'identité de la Maison
 *    (`maison<id>`) et du métier (`metier<code>`, migration 20260916210200) :
 *    toute cette condition est UNE requête plein texte (`catwalks_requete_terme`
 *    ET `catwalks_requete_terme` OU `catwalks_requete_metiers`) servie par
 *    l'index — un OR SQL entre le vecteur et `companyId` faisait choisir un
 *    balayage de Job avec `@@` par ligne (mesuré : 635 à 828 ms sur « store
 *    manager », US ; 28 ms par l'index). Avant le lot 7, « LVMH » devenait 52
 *    clauses `ILIKE` (12 s sur le clone) et « store manager » relisait 206 Mo
 *    de descriptions (5,3 s).
 *  - `scoped` : `base` restreinte par TOUTES les dimensions sélectionnées, ET
 *    entre dimensions, OU entre valeurs ; une dimension tolérante conserve les
 *    offres non renseignées et les marque `confirme = false`.
 *  - chaque facette est comptée sur `base` restreinte par les AUTRES
 *    dimensions : sa propre sélection est exclue (D-426).
 *  - l'ordre : les offres Catwalks d'abord (D-419 §1), puis les confirmées,
 *    puis le pays du visiteur, puis le score (terme dans le titre : 2, porté
 *    par la Maison : 1, ailleurs : 0, sommé sur les termes), puis la
 *    fraîcheur, puis l'identifiant — et la page reprend APRÈS une clé
 *    (curseur), jamais à un décalage.
 *  - le total du périmètre ne dépend d'aucun critère : il est mémorisé par
 *    instance et par périmètre (`COMPTE_PERIMETRE_TTL_MS`), jamais partagé
 *    entre deux périmètres.
 *
 * Les valeurs utilisateur restent des paramètres liés ; seuls des fragments
 * fixes deviennent des identifiants.
 */

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
 * Les écritures qui ne séparent pas leurs mots par des espaces (chinois,
 * japonais, coréen, thaï, lao, khmer, birman) : un terme s'y apparie
 * n'importe où dans le texte, jamais au début d'un mot.
 */
const ECRITURE_SANS_ESPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** Un terme LEXICAL porte au moins une lettre ou un chiffre d'une écriture à mots : il s'apparie par les vecteurs. */
export function termeLexical(brut: string): boolean {
  return /[\p{L}\p{N}]/u.test(brut) && !ECRITURE_SANS_ESPACES.test(brut);
}

/** Ce qu'un terme de la requête devient en SQL : sa forme lexicale ou son motif littéral, les Maisons qu'il désigne. */
type Terme = { brut: string; lexical: boolean; motif: string; noms: string[]; maisons: Prisma.Sql };

function termes(plan: PlanRecherche): Terme[] {
  return plan.termes.map((brut, i) => ({
    brut,
    lexical: termeLexical(brut),
    motif: `%${echapperLike(brut)}%`,
    noms: expandCompanyTerm(brut).map((n) => n.toLowerCase()),
    maisons: Prisma.sql`maisons_${Prisma.raw(String(i))}`,
  }));
}

/** Les identifiants de Maison qu'un terme désigne : nom, groupe, alias revu, ancienne Maison fusionnée, Maisons du groupe du référentiel. */
function cteMaisons(t: Terme): Prisma.Sql {
  return Prisma.sql`${t.maisons} AS MATERIALIZED (
    SELECT c.id FROM "Company" c
    WHERE catwalks_normaliser_texte(c.name) LIKE ${motifNormalise(t.motif)}
       OR catwalks_normaliser_texte(coalesce(c."parentGroup", '')) LIKE ${motifNormalise(t.motif)}
       OR lower(c.name) IN (${Prisma.join(t.noms.map((n) => Prisma.sql`${n}`))})
       OR ${companyAliasSql(t.brut, 'contains')})`;
}

/** L'offre agrégée appartient à une Maison que le terme désigne (`= ANY` d'un tableau : l'index sur `companyId` reste utilisable). */
const maisonAgregee = (t: Terme) => Prisma.sql`j."companyId" = ANY (ARRAY(SELECT id FROM ${t.maisons}))`;
/** L'offre directe porte le nom d'une Maison du groupe du référentiel que le terme désigne. */
const maisonDirecte = (t: Terme) => Prisma.sql`lower(d.company) IN (${Prisma.join(t.noms.map((n) => Prisma.sql`${n}`))})`;
/** La requête plein texte d'un terme lexical, restreinte ou non à un poids du vecteur de titre (le score). */
const requete = (t: Terme, poids: '' | 'A' | 'B' = '') => Prisma.sql`catwalks_requete(${t.brut}, ${poids})`;
/** La requête d'un terme lexical sur le vecteur qui filtre : ses mots, OU l'identité d'une Maison résolue pour lui. */
const requeteTerme = (t: Terme) => Prisma.sql`catwalks_requete_terme(${t.brut}, ARRAY(SELECT id FROM ${t.maisons}))`;

/**
 * La condition de texte de l'origine agrégée : pour l'index, UNE requête plein
 * texte porte les termes lexicaux (ET entre eux, chacun avec ses Maisons) et
 * les métiers de la taxonomie (OU) ; un terme littéral (écriture sans espaces,
 * joker) reste un `LIKE` sur le texte normalisé, OU sa Maison.
 */
function conditionAgregee(liste: Terme[], codes: string[]): Prisma.Sql {
  const lexicaux = liste.filter((t) => t.lexical);
  const litteraux = liste.filter((t) => !t.lexical).map((t) => Prisma.sql`(j."searchText" LIKE ${motifNormalise(t.motif)} OR ${maisonAgregee(t)})`);
  const termes = lexicaux.length ? Prisma.join(lexicaux.map(requeteTerme), ' && ') : null;
  const metiers = codes.length ? Prisma.sql`catwalks_requete_metiers(ARRAY[${Prisma.join(codes)}]::text[])` : null;
  if (metiers && termes && !litteraux.length) return Prisma.sql`j."searchVector" @@ ((${termes}) || ${metiers})`;
  const tous = Prisma.join([...(termes ? [Prisma.sql`j."searchVector" @@ (${termes})`] : []), ...litteraux], ' AND ');
  return metiers ? Prisma.sql`((${tous}) OR j."searchVector" @@ ${metiers})` : Prisma.sql`(${tous})`;
}

function conditionDirecte(t: Terme): Prisma.Sql {
  const texte = t.lexical ? Prisma.sql`d."searchVector" @@ ${requete(t)}` : Prisma.sql`d."searchText" LIKE ${motifNormalise(t.motif)}`;
  return Prisma.sql`(${texte} OR ${maisonDirecte(t)})`;
}

/** Le score d'un terme sur une offre agrégée : dans le titre 2, porté par la Maison 1, ailleurs 0. */
function scoreAgregee(t: Terme): Prisma.Sql {
  return t.lexical
    ? Prisma.sql`(CASE WHEN j."titleVector" @@ ${requete(t, 'A')} THEN 2
        WHEN j."titleVector" @@ ${requete(t, 'B')} OR ${maisonAgregee(t)} THEN 1 ELSE 0 END)`
    : Prisma.sql`(CASE WHEN catwalks_normaliser_texte(j.title) LIKE ${motifNormalise(t.motif)} THEN 2
        WHEN catwalks_normaliser_texte(c.name) LIKE ${motifNormalise(t.motif)} OR ${maisonAgregee(t)} THEN 1 ELSE 0 END)`;
}

function scoreDirecte(t: Terme): Prisma.Sql {
  return t.lexical
    ? Prisma.sql`(CASE WHEN d."titleVector" @@ ${requete(t, 'A')} THEN 2
        WHEN d."titleVector" @@ ${requete(t, 'B')} OR ${maisonDirecte(t)} THEN 1 ELSE 0 END)`
    : Prisma.sql`(CASE WHEN catwalks_normaliser_texte(d.title) LIKE ${motifNormalise(t.motif)} THEN 2
        WHEN catwalks_normaliser_texte(d.company) LIKE ${motifNormalise(t.motif)} OR ${maisonDirecte(t)} THEN 1 ELSE 0 END)`;
}

/** La somme des scores des termes, ou 0 sans terme. */
const somme = (parts: Prisma.Sql[]) => (parts.length ? Prisma.sql`(${Prisma.join(parts, ' + ')})` : Prisma.sql`0`);

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
  presentation?: OptionalOccupationPresentation,
): Promise<SearchSummary> {
  const asOf = new Date();
  const pays = Prisma.join(plan.perimetre.pays.map((p) => Prisma.sql`${p}`));
  const perimetre = Prisma.sql`${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays})`;
  const conditions: Prisma.Sql[] = [perimetre, ...conditionLieu(plan, 'j')];
  const conditionsDirect: Prisma.Sql[] = [perimetreDirect(pays, asOf), ...conditionLieu(plan, 'd')];

  const liste = termes(plan);
  let ctes = Prisma.empty;
  if (liste.length) {
    ctes = Prisma.sql`${Prisma.join(liste.map(cteMaisons), ', ')},`;
    // Whole-query semantics only: extra employer/location/rank words keep their literal meaning.
    const { taxonomy } = presentation ?? await getOptionalOccupationPresentation();
    const codes = taxonomy?.queryOccupations(plan.termes.join(' ')) ?? [];
    conditions.push(conditionAgregee(liste, codes));
    conditionsDirect.push(Prisma.join(liste.map(conditionDirecte), ' AND '));
  }

  /*
   * D-435 — une offre est CONFIRMÉE quand chaque dimension tolérante filtrée
   * est renseignée ; sans filtre tolérant, tout est confirmé.
   */
  const confirmees = DIMENSIONS_TOLERANTES.flatMap((d: DimensionTolerante) => plan.selections[d]?.length ? [Prisma.sql`${COLONNE[d]} IS NOT NULL`] : []);
  const confirme = confirmees.length ? Prisma.join(confirmees, ' AND ') : Prisma.sql`true`;
  // D-419 §2 : le pays du visiteur d'abord, à l'intérieur du périmètre. Jamais un filtre.
  const priorite = plan.prioritePays ? Prisma.sql`(CASE WHEN b."countryCode" = ${plan.prioritePays} THEN 0 ELSE 1 END)` : Prisma.sql`0`;
  const apres = curseur
    ? Prisma.sql`WHERE (origine, nc, pri, ns, np, nf, id) > (${curseur[0]}::int, ${curseur[1]}::int, ${curseur[2]}::int, ${curseur[3]}::int, ${curseur[4]}::float8, ${curseur[5]}::float8, ${curseur[6]}::text)`
    : Prisma.empty;

  const [[summary], totalPerimetre] = await Promise.all([prisma.$queryRaw<Array<Omit<SearchSummary, 'ids' | 'suivant' | 'totalPerimetre'> & { page: Array<{ id: string; k: CleRecherche }> | null }>>(Prisma.sql`
    WITH ${ctes} base AS MATERIALIZED (
      SELECT j.id, 1 AS origine, j."occupationCode", j."countryCode", lower(trim(j.city)) AS ville, j."employmentTerm", j."workTime",
        j."programType", j."postedAt", j."firstSeenAt", j.language, c.id AS "companyId", c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe,
        ${somme(liste.map(scoreAgregee))} AS score
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      UNION ALL
      SELECT ${PREFIXE_DIRECT} || d.id, 0 AS origine, NULL::text, d."countryCode", lower(trim(d.city)), d."employmentTerm", d."workTime",
        d."programType", d."postedAt", d."receivedAt", d.language, NULL::text, d.company, d."sectorCodes", NULL::text,
        ${somme(liste.map(scoreDirecte))}
      FROM "DirectOffer" d
      WHERE ${Prisma.join(conditionsDirect, ' AND ')}
    ), scoped AS MATERIALIZED (
      SELECT b.id, b.origine, b."countryCode", b."postedAt", b."firstSeenAt", (${confirme}) AS confirme, ${priorite} AS pri, b.score
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
        'contrat', ${facette(Prisma.sql`b."employmentTerm"`, plan, 'contrat')},
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
