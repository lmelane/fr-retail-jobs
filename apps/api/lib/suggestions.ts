import { getSearchContext, requireSearchIndex, SEARCH_VERSION } from './search-index';
import { searchSql } from './search-sql';
import { searchWords, validateSearchQuery } from './search-intent';
import { publicJobSql } from '@catwalks/db/availability';
import type { Perimetre } from '@catwalks/db/marches';
import { prisma, Prisma } from '@catwalks/db';
import { directPubliableSql } from './direct-offers';
import { echapperLike } from './like';

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
 * LE CLOISONNEMENT DES VILLES PAR MARCHÉ (arbitrage CEO, option A).
 *
 * « Je sélectionne FR → je ne vois que des villes FR ; je sélectionne US →
 * uniquement des villes US. » Cloisonnement STRICT, comme Indeed.
 *
 * Mesuré en production le 2026-09-15 : sur 6 824 villes distinctes portant au
 * moins un pays, 370 (5,4 %) existent dans PLUSIEURS pays — PARIS (BE ES FR
 * US), NEW YORK (CA US), LONDRES (CA GB IT US), LOS ANGELES (CA CL US).
 *
 * ── LES OFFRES SANS PAYS : DÉDUCTION QUAND ELLE NE LAISSE AUCUN DOUTE ──────
 *
 * 4 811 offres publiables n'ont aucun `countryCode` (16/09/2026). Une ville
 * sans pays dont le nom n'apparaît ailleurs qu'avec UN SEUL pays prend ce
 * pays (487 villes mesurées) ; une ville ambiguë (ABERDEEN GB/SD, BEDFORD
 * CA/GB/US) ou sans occurrence ailleurs reste hors suggestions : deviner le
 * pays d'une ville, c'est envoyer un candidat vers un marché qui n'est pas le
 * sien, sans qu'il puisse s'en apercevoir.
 *
 * La déduction vit dans LA REQUÊTE : la CTE `candidates` est bornée par le
 * préfixe AVANT tout calcul, donc elle ne raisonne que sur les quelques
 * centaines de lignes que la frappe a déjà sélectionnées. Mesuré 11 passes sur
 * le catalogue de production : surcoût inférieur à ~8 ms, indiscernable du
 * bruit réseau.
 *
 * `COALESCE(c.pays, d.p) = ANY(périmètre)` : le pays de l'offre s'il existe,
 * sinon celui déduit ; une offre sans pays dont la ville est ambiguë garde
 * `NULL`, et `NULL = ANY(...)` est faux — l'abstention est portée par la
 * logique ternaire de SQL, pas par un `if` ajouté à côté.
 */
export async function suggestCities(query: string, perimetre: Perimetre): Promise<string[]> {
  if (!process.env.DATABASE_URL) return [];
  validateSearchQuery(query);
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const prefixe = `${echapperLike(q)}%`;
    const asOf = new Date();
    // Plus large que la limite : la colonne mélange les casses (« Paris » /
    // « PARIS » sont des groupes distincts) — on déduplique ensuite en JS.
    const brut = SUGGEST_LIMIT * 3;
    const rows = await prisma.$queryRaw<Ligne[]>`
      WITH candidates AS (
        SELECT "city" AS valeur, UPPER(TRIM("city")) AS cle, "countryCode" AS pays
          FROM "Job" j
         WHERE ${publicJobSql(Prisma.sql`j`, asOf)} AND catwalks_normaliser_texte("city") LIKE catwalks_normaliser_texte(${prefixe})
        UNION ALL
        SELECT d.city, UPPER(TRIM(d.city)), d."countryCode"
          FROM "DirectOffer" d
         WHERE ${directPubliable(asOf)} AND catwalks_normaliser_texte(d.city) LIKE catwalks_normaliser_texte(${prefixe})
      ),
      deduit AS (
        SELECT cle, MIN(pays) AS p
          FROM candidates
         WHERE pays IS NOT NULL
         GROUP BY cle
        HAVING COUNT(DISTINCT pays) = 1
      )
      SELECT c.valeur, COUNT(*)::int AS n
        FROM candidates c
        LEFT JOIN deduit d ON d.cle = c.cle
       WHERE COALESCE(c.pays, d.p) = ANY(${[...perimetre.pays]})
       GROUP BY c.valeur
       ORDER BY COUNT(*) DESC, c.valeur ASC
       LIMIT ${brut}
    `;
    return dedupliquer(rows.map((r) => r.valeur));
  } catch {
    return [];
  }
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

export async function suggestTitles(query: string, perimetre: Perimetre): Promise<string[]> {
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
    const queries = candidates.map((value, position) => {
      const { condition } = searchSql(model.resolver.resolve(value));
      return Prisma.sql`SELECT ${value}::text AS value, ${position}::int AS position WHERE EXISTS (
        SELECT 1 FROM "SearchDocument" s JOIN "Job" j ON j.id=s.id
        WHERE s.version=${SEARCH_VERSION} AND ${condition} AND ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays})
        UNION ALL SELECT 1 FROM "SearchDocument" s JOIN "DirectOffer" d ON s.id='cw_'||d.id
        WHERE s.version=${SEARCH_VERSION} AND ${condition} AND ${directPubliable(asOf)} AND d."countryCode" IN (${pays}))`;
    });
    const found = await prisma.$queryRaw<{ value: string }[]>(Prisma.sql`SELECT value FROM (${Prisma.join(queries, ' UNION ALL ')}) suggestions ORDER BY position LIMIT ${SUGGEST_LIMIT}`);
    return found.map(r => r.value);
  } catch {
    return [];
  }
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
