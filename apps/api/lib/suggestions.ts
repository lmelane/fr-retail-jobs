import { getSearchContext, requireSearchIndex, SEARCH_VERSION } from './search-index';
import { searchSql } from './search-sql';
import { metiersSansIndex, repartitionDuPerimetre } from './search-chemin';
import { searchWords, validateSearchQuery } from './search-intent';
import { publicJobSql } from '@catwalks/db/availability';
import type { Perimetre } from '@catwalks/db/marches';
import { prisma, Prisma } from '@catwalks/db';
import { directPubliableSql } from './direct-offers';
import { echapperLike } from './like';
import { getOptionalOccupationPresentation } from './occupations';
import { localeAffichage } from './presentation-locale';
import { langueDesLibelles } from '@catwalks/db/presentation';
import { searchConcepts } from './search-vocabulary';
import { langueDesVilles, libelleVille, lireSaisieLieu } from './geo';

/**
 * L'AUTOCOMPLÉTION DE LA BARRE, DEPUIS NOS DONNÉES ET DANS LE PÉRIMÈTRE (lot 6).
 *
 * Les suggestions sont de vraies villes, de vrais intitulés et de vraies
 * Maisons que le catalogue porte DANS LE PÉRIMÈTRE demandé, DEUX ORIGINES
 * confondues (passation §2.4 : « suggestions issues des offres réellement
 * disponibles dans le pays actif, couvrant les deux origines ») : un clic mène
 * toujours à des résultats du marché. Avant ce lot, seules les villes étaient
 * cloisonnées ; un intitulé ou une Maison suggérés depuis le monde entier
 * pouvaient rendre zéro offre sur le marché servi.
 *
 * Aucun repli mondial : sans périmètre, l'appelant refuse avant d'arriver ici.
 */
const SUGGEST_LIMIT = 8;
/** La même normalisation que `catwalks_normaliser_texte`, côté JS, pour filtrer ce que la base a déjà rendu. */
const sansAccents = (v: string) => v.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[’‘‛`´ʼ]/g, "'").toLowerCase();

type Ligne = { valeur: string | null; n: number };

const paysSql = (perimetre: Perimetre) => Prisma.join(perimetre.pays.map((p) => Prisma.sql`${p}`));
const directPubliable = (asOf: Date) => directPubliableSql(Prisma.sql`d`, asOf);

/**
 * LES LIEUX DE LA BARRE (D-496, D-499), comme Indeed : des lieux reconnus — villes, arrondissements, communes de la base
 * mondiale (`GeoCity`, GeoNames) et codes postaux (`GeoPostalCode`) —, jamais le texte brut des offres.
 *
 * - Le cloisonnement par marché tient (arbitrage CEO, option A) : seulement les lieux des pays du périmètre (« Paris »
 *   sur le marché américain, c'est Paris, Texas).
 * - Chaque lieu s'écrit avec sa subdivision entre parenthèses quand la base en donne une : « Paris (75) », « Paris 15e
 *   (75) », « Chennevières-sur-Marne (94) », « Austin (TX) », « 94430 Chennevières-sur-Marne (94) ». Ce texte est aussi
 *   ce que la barre renvoie au moteur, qui y relit le lieu (`geo.ts`, `lireSaisieLieu`) : chaque lieu est un point.
 * - Une frappe qui porte un chiffre propose d'abord les codes postaux qui commencent par elle.
 * - L'ordre des villes : le nom affiché qui commence par la frappe, puis le nombre d'offres actives rattachées au lieu
 *   (`Job.geoCityId`, deux origines), puis la population. « paris » : Paris (75), puis ses arrondissements. Un lieu sans
 *   offre à son nom reste proposé : la recherche de proximité trouve les offres autour de lui (Chennevières-sur-Marne :
 *   1 offre à son nom, 166 à moins de 10 km). Jamais un doublon de GeoNames ni une entité administrative
 *   (`suggestible`).
 * - Le nom dans la langue de l'interface quand la base le connaît (« München » en allemand, « Munich » en français).
 * - La frappe se compare sous la clé de lieu de la base (`catwalks_lieu_cle` : sans accents, casse ni ponctuation),
 *   sur le nom principal et toutes ses variantes (« Londres » trouve London).
 */
export async function suggestCities(query: string, perimetre: Perimetre, locale?: string): Promise<string[]> {
  if (!process.env.DATABASE_URL) return [];
  validateSearchQuery(query);
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const pays = [...perimetre.pays];
    const langue = langueDesVilles(locale, perimetre);
    const asOf = new Date();
    const postaux = /\d/.test(q) ? await suggererCodesPostaux(q, pays) : [];
    const lue = lireSaisieLieu(q);
    const rows = lue.nom && !lue.code ? await prisma.$queryRaw<Array<{ name: string; label: string | null; subdivision: string | null }>>(Prisma.sql`
      WITH cle AS (SELECT catwalks_lieu_cle(${lue.nom}) AS k),
      candidates AS (
        SELECT DISTINCT n."cityId" AS id FROM "GeoCityName" n, cle
         WHERE char_length(cle.k) >= 2 AND n."countryCode" = ANY(${pays}::text[])
           AND n."nameKey" LIKE cle.k || '%' -- une clé de lieu n'a ni « % » ni « _ » (ponctuation retirée)
      ),
      villes AS (SELECT c.* FROM "GeoCity" c JOIN candidates USING ("id") WHERE c."suggestible"),
      offres AS (
        SELECT j."geoCityId" AS id, count(*) AS n FROM "Job" j
         WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."geoCityId" IN (SELECT "id" FROM villes) AND j."countryCode" = ANY(${pays}::text[])
         GROUP BY 1
        UNION ALL
        SELECT d."geoCityId", count(*) FROM "DirectOffer" d
         WHERE ${directPubliable(asOf)} AND d."geoCityId" IN (SELECT "id" FROM villes) AND d."countryCode" = ANY(${pays}::text[])
         GROUP BY 1
      )
      SELECT v."name", l."label", v."subdivision" FROM villes v
        LEFT JOIN (SELECT id, sum(n) AS n FROM offres GROUP BY id) o ON o.id = v."id"
        LEFT JOIN "GeoCityLabel" l ON l."cityId" = v."id" AND l."language" = ${langue}
       CROSS JOIN cle
       -- Le nom affiché qui commence par la frappe d'abord (« Lon » : London avant Hounslow, que nomme aussi « London
       -- Borough of Hounslow ») ; puis le nombre d'offres, puis la population.
       ORDER BY (catwalks_lieu_cle(coalesce(l."label", v."name")) LIKE cle.k || '%') DESC, coalesce(o.n, 0) DESC, v."population" DESC, v."id"
       LIMIT ${SUGGEST_LIMIT * 3}`) : [];
    return dedupliquer([...postaux, ...rows.map(libelleVille)]);
  } catch {
    return [];
  }
}

/**
 * D-499 — les codes postaux qui commencent par la frappe (« 9443 », « SW1 », « 75015 Par »), chacun avec le lieu qu'il
 * dessert et sa subdivision : « 94430 Chennevières-sur-Marne (94) ».
 */
async function suggererCodesPostaux(q: string, pays: readonly string[]): Promise<string[]> {
  const lue = lireSaisieLieu(q);
  const code = lue.code ?? (/^[0-9A-Z][0-9A-Z -]{0,9}$/i.test(q) ? q : null);
  if (!code) return [];
  const rows = await prisma.$queryRaw<Array<{ code: string; lieu: string; sub: string | null }>>(Prisma.sql`
    SELECT pc."postalCode" AS code, pc."placeName" AS lieu, pc."subdivision" AS sub FROM "GeoPostalCode" pc
     WHERE pc."countryCode" = ANY(${[...pays]}::text[]) AND char_length(catwalks_code_postal_cle(${code})) >= 2
       AND pc."postalKey" LIKE catwalks_code_postal_cle(${code}) || '%'
       AND (${lue.code ? lue.nom : null}::text IS NULL OR pc."placeKey" LIKE catwalks_lieu_cle(${lue.code ? lue.nom : null}::text) || '%')
       AND NOT EXISTS (SELECT 1 FROM "GeoPostalCode" fin WHERE fin."countryCode" = pc."countryCode"
         AND fin."postalKey" = pc."postalKey" AND fin."placeKey" LIKE pc."placeKey" || ' %')
     ORDER BY pc."postalKey", pc."placeName" LIMIT ${SUGGEST_LIMIT}`);
  return rows.map((r) => `${r.code} ${r.lieu}${r.sub ? ` (${r.sub})` : ''}`);
}

/**
 * Dédup insensible à la casse : on garde la graphie du groupe le plus fréquent
 * (les lignes arrivent triées par volume décroissant). Sans ça le panneau
 * montrait « Paris » ET « PARIS » — vu en production.
 */
function dedupliquer(valeurs: readonly (string | null)[], limit = SUGGEST_LIMIT): string[] {
  const vues = new Set<string>();
  const propres: string[] = [];
  for (const brut of valeurs) {
    if (!brut) continue;
    const cle = brut.toLowerCase();
    if (vues.has(cle)) continue;
    vues.add(cle);
    propres.push(brut);
    if (propres.length >= limit) break;
  }
  return propres;
}

/**
 * Reduces a raw offer title to a searchable role keyword. Raw titles carry the
 * whole posting — "Conseiller de vente 35h - Paris - CDI H/F" — and clicking
 * one dropped that entire string into the search box, so the next search matched
 * almost nothing. This keeps the ROLE and drops the noise a candidate would
 * never type: reference codes, the contract, hours, the city, the H/F marker.
 */
export function roleKeyword(title: string): string {
  return title
    // Cut everything after the first " - " / " – " / " — " / " | " / " / " separator:
    // the role leads, the qualifiers (city, contract, hours) follow it.
    // Drop a leading contract/reference prefix ("CDI - …", "2026-2825 - …").
    .replace(/^(CDI|CDD|STAGE|ALTERNANCE|INTERIM|VIE|FREELANCE|\d[\d-]*)\s*[-–]\s*/i, '')
    .split(/\s[-–—|/]\s/)[0]
    // Strip trailing H/F, F/H, (H/F), hours like "35h", and stray separators.
    .replace(/\(?\b[hf](?:\s*\/\s*[hf])?\b\)?/gi, '')
    .replace(/\b\d{2,}\s*h\b/gi, '')
    .replace(/[\s,–-]+$/g, '')
    .trim();
}

/**
 * LE MÉTIER RECONNU DANS UNE SUGGESTION (D-475, plan §3.5, contrat ADDITIF). Les chaînes restent, telles quelles ; un
 * champ nouveau porte, pour chacune, le métier qu'elle nomme exactement (`{ identifiant, libelle }`, libellé dans la
 * langue du marché) ou `null` : un intitulé réel sans métier reste proposé. L'écran peut dire « Métier : Conseiller de
 * vente » et chercher par l'identifiant.
 */
export type MetierSuggere = { identifiant: string; libelle: string };
export type SuggestionDetaillee = { valeur: string; metier: MetierSuggere | null };

/** Le métier qu'une chaîne nomme exactement : une seule intention, un métier, sans texte libre ni exclusion. */
function metierNomme(resolve: (q: string) => { clauses: { kind: string; keys: string[]; exclude: boolean }[] }, valeur: string): string | null {
  const { clauses } = resolve(valeur);
  const [c] = clauses;
  return clauses.length === 1 && c.kind === 'role' && !c.exclude && c.keys.length === 1 ? c.keys[0] : null;
}

export async function suggestTitles(query: string, perimetre: Perimetre): Promise<string[]> {
  return (await suggestTitlesDetaillees(query, perimetre)).map((s) => s.valeur);
}

export async function suggestTitlesDetaillees(query: string, perimetre: Perimetre, locale?: string): Promise<SuggestionDetaillee[]> {
  if (!process.env.DATABASE_URL) return [];
  validateSearchQuery(query);
  const q = query.trim();
  if (q.length < 2) return [];
  await requireSearchIndex();
  try {
    const motif = `%${echapperLike(q)}%`;
    const asOf = new Date();
    const pays = paysSql(perimetre);
    // Pull more raw titles than we need, reduce each to its role keyword, then
    // dedupe — several postings collapse to the same clean role.
    const rows = await prisma.$queryRaw<Ligne[]>`
      SELECT valeur, sum(n)::int AS n FROM (
        SELECT j.title AS valeur, count(*) AS n FROM "Job" j
         WHERE ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays}) AND catwalks_normaliser_texte(j.title) LIKE catwalks_normaliser_texte(${motif}) GROUP BY j.title
        UNION ALL
        SELECT d.title, count(*) FROM "DirectOffer" d
         WHERE ${directPubliable(asOf)} AND d."countryCode" IN (${pays}) AND catwalks_normaliser_texte(d.title) LIKE catwalks_normaliser_texte(${motif}) GROUP BY d.title
      ) t GROUP BY valeur ORDER BY n DESC, valeur ASC LIMIT 40`;
    const { model } = await getSearchContext();
    const normalized = searchWords(q).join(' ');
    const candidates = dedupliquer([...rows.map(r => r.valeur && roleKeyword(r.valeur)).filter((r): r is string => !!r && sansAccents(r).includes(sansAccents(q))),
      ...model.concepts.flatMap(c => c.aliases.filter(a => searchWords(a).join(' ').startsWith(normalized)))], 24);
    if (!candidates.length) return [];
    // Every suggestion is executed through the same interpretation and live
    // publication predicates as search. No global taxonomy label with zero jobs.
    // D-488 : la même restriction aux langues du marché que la recherche, sinon une suggestion validée par une variante
    // d'une autre langue mènerait à une recherche vide.
    const repartition = await repartitionDuPerimetre(perimetre.pays);
    const queries = candidates.map((value, position) => {
      const intention = model.intention(value, perimetre.marche);
      const { condition } = searchSql(intention, { metiersSansIndex: !!repartition && metiersSansIndex(intention, repartition) });
      return Prisma.sql`SELECT ${value}::text AS value, ${position}::int AS position WHERE EXISTS (
        SELECT 1 FROM "SearchDocument" s JOIN "Job" j ON j.id=s.id
        WHERE s.version=${SEARCH_VERSION} AND ${condition} AND ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays})
        UNION ALL SELECT 1 FROM "SearchDocument" s JOIN "DirectOffer" d ON s.id='cw_'||d.id
        WHERE s.version=${SEARCH_VERSION} AND ${condition} AND ${directPubliable(asOf)} AND d."countryCode" IN (${pays}))`;
    });
    const found = await prisma.$queryRaw<{ value: string }[]>(Prisma.sql`SELECT value FROM (${Prisma.join(queries, ' UNION ALL ')}) suggestions ORDER BY position LIMIT ${SUGGEST_LIMIT}`);
    const presentation = await getOptionalOccupationPresentation(langueDesLibelles(localeAffichage(locale, perimetre)));
    return found.map((r) => {
      const identifiant = metierNomme((v) => model.resolver.resolve(v), r.value), libelle = presentation.occupationLabel(identifiant);
      return { valeur: r.value, metier: identifiant && libelle ? { identifiant, libelle } : null };
    });
  } catch {
    return [];
  }
}

/**
 * LES MÉTIERS DE LA TAXONOMIE, par libellé ou variante (D-475, plan §3.5) : pour les préférences et l'onboarding, un
 * métier reste choisissable même sans offre vivante, donc sans dépendre de l'index de recherche. Le libellé du marché
 * d'abord, puis les variantes qui commencent par la frappe, puis celles qui la contiennent.
 */
export async function suggestOccupations(query: string, perimetre: Perimetre, locale?: string): Promise<MetierSuggere[]> {
  if (!process.env.DATABASE_URL) return [];
  validateSearchQuery(query);
  const q = searchWords(query).join(' ');
  if (q.length < 2) return [];
  const presentation = await getOptionalOccupationPresentation(langueDesLibelles(localeAffichage(locale, perimetre)));
  if (!presentation.available) return [];
  const rang = new Map<string, number>();
  for (const c of searchConcepts(presentation.taxonomy.manifest, [])) {
    if (c.kind !== 'role') continue;
    const libelle = presentation.occupationLabel(c.key);
    const cle = (v: string) => searchWords(v).join(' ');
    const r = libelle && cle(libelle).startsWith(q) ? 0 : c.aliases.some((a) => cle(a).startsWith(q)) ? 1
      : c.aliases.some((a) => ` ${cle(a)}`.includes(` ${q}`)) ? 2 : null;
    if (r !== null) rang.set(c.key, r);
  }
  return [...rang].map(([identifiant, r]) => ({ identifiant, libelle: presentation.occupationLabel(identifiant)!, r }))
    .filter((m) => m.libelle)
    .sort((a, b) => a.r - b.r || a.libelle.localeCompare(b.libelle))
    .slice(0, SUGGEST_LIMIT).map(({ identifiant, libelle }) => ({ identifiant, libelle }));
}

/**
 * Autocomplete for the Maison field — real Maison names hiring in the
 * perimeter, most active first, direct offers included. A suggestion always
 * leads to a Maison that exists and is hiring there.
 */
export async function suggestCompanies(query: string, perimetre: Perimetre): Promise<string[]> {
  if (!process.env.DATABASE_URL) return [];
  validateSearchQuery(query);
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const motif = `%${echapperLike(q)}%`;
    const asOf = new Date();
    const pays = paysSql(perimetre);
    const rows = await prisma.$queryRaw<Ligne[]>`
      SELECT valeur, sum(n)::int AS n FROM (
        SELECT c.name AS valeur, count(*) AS n FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
         WHERE ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays})
           AND (catwalks_normaliser_texte(c.name) LIKE catwalks_normaliser_texte(${motif}) OR c.id IN (
             SELECT a."companyId" FROM "CompanyAlias" a WHERE a."reviewId" IS NOT NULL AND a."displayName" ILIKE ${motif}
             UNION SELECT old."mergedIntoId" FROM "Company" old WHERE old."mergedIntoId" IS NOT NULL AND old.name ILIKE ${motif}))
         GROUP BY c.name
        UNION ALL
        SELECT d.company, count(*) FROM "DirectOffer" d
         WHERE ${directPubliable(asOf)} AND d."countryCode" IN (${pays}) AND catwalks_normaliser_texte(d.company) LIKE catwalks_normaliser_texte(${motif}) GROUP BY d.company
      ) t GROUP BY valeur ORDER BY n DESC, valeur ASC LIMIT 40`;
    return dedupliquer(rows.map((r) => r.valeur));
  } catch {
    return [];
  }
}
