import { publicJobSql, publicJobWhere } from '@catwalks/db/availability';
import type { Perimetre } from '@catwalks/db/marches';
import { prisma, Prisma } from '@catwalks/db';
import { companyIdentityWhere } from './company-identity';
import { echapperLike } from './like';

/**
 * L'AUTOCOMPLÉTION DE LA BARRE, DEPUIS NOS DONNÉES ET DANS LE PÉRIMÈTRE (lot 6).
 *
 * Les suggestions sont de vraies villes, de vrais intitulés et de vraies
 * Maisons que le catalogue porte DANS LE PÉRIMÈTRE demandé : un clic mène
 * toujours à des résultats du marché (passation §2.4 : « suggestions issues
 * des offres réellement disponibles dans le pays actif »). Avant ce lot,
 * seules les villes étaient cloisonnées ; un intitulé ou une Maison suggérés
 * depuis le monde entier pouvaient rendre zéro offre sur le marché servi.
 *
 * Aucun repli mondial : sans périmètre, l'appelant refuse avant d'arriver ici.
 */
const SUGGEST_LIMIT = 8;

type SuggestionVilleBrute = { city: string; n: bigint | number };

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
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const prefixe = `${echapperLike(q)}%`;
    // Plus large que la limite : la colonne mélange les casses (« Paris » /
    // « PARIS » sont des groupes distincts) — on déduplique ensuite en JS.
    const brut = SUGGEST_LIMIT * 3;
    const rows = await prisma.$queryRaw<SuggestionVilleBrute[]>`
      WITH candidates AS (
        SELECT "city", UPPER(TRIM("city")) AS cle, "countryCode" AS pays
          FROM "Job" j
         WHERE ${publicJobSql(Prisma.sql`j`)} AND "city" ILIKE ${prefixe}
      ),
      deduit AS (
        SELECT cle, MIN(pays) AS p
          FROM candidates
         WHERE pays IS NOT NULL
         GROUP BY cle
        HAVING COUNT(DISTINCT pays) = 1
      )
      SELECT c."city" AS city, COUNT(*)::int AS n
        FROM candidates c
        LEFT JOIN deduit d ON d.cle = c.cle
       WHERE COALESCE(c.pays, d.p) = ANY(${[...perimetre.pays]})
       GROUP BY c."city"
       ORDER BY COUNT(*) DESC, c."city" ASC
       LIMIT ${brut}
    `;
    return dedupliquerVilles(rows.map((r) => r.city));
  } catch {
    return [];
  }
}

/**
 * Dédup insensible à la casse : on garde la graphie du groupe le plus fréquent
 * (les lignes arrivent triées par volume décroissant). Sans ça le panneau
 * montrait « Paris » ET « PARIS » — vu en production.
 */
function dedupliquerVilles(valeurs: readonly (string | null)[]): string[] {
  const vues = new Set<string>();
  const villes: string[] = [];
  for (const brut of valeurs) {
    if (!brut) continue;
    const cle = brut.toLowerCase();
    if (vues.has(cle)) continue;
    vues.add(cle);
    villes.push(brut);
    if (villes.length >= SUGGEST_LIMIT) break;
  }
  return villes;
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
    // Cut everything after the first " - " / " – " / " | " / " / " separator:
    // the role leads, the qualifiers (city, contract, hours) follow it.
    .split(/\s[-–|/]\s/)[0]
    // Drop a leading contract/reference prefix ("CDI - …", "2026-2825 - …").
    .replace(/^(CDI|CDD|STAGE|ALTERNANCE|INTERIM|VIE|FREELANCE|\d[\d-]*)\s*[-–]\s*/i, '')
    // Strip trailing H/F, F/H, (H/F), hours like "35h", and stray separators.
    .replace(/\(?\b[hf](?:\s*\/\s*[hf])?\b\)?/gi, '')
    .replace(/\b\d{2,}\s*h\b/gi, '')
    .replace(/[\s,–-]+$/g, '')
    .trim();
}

export async function suggestTitles(query: string, perimetre: Perimetre): Promise<string[]> {
  if (!process.env.DATABASE_URL) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    // Pull more raw titles than we need, reduce each to its role keyword, then
    // dedupe — several postings collapse to the same clean role.
    const rows = await prisma.job.groupBy({
      by: ['title'],
      where: {
        ...publicJobWhere(),
        countryCode: { in: [...perimetre.pays] },
        title: { contains: q, mode: 'insensitive' },
      },
      _count: { _all: true },
      orderBy: { _count: { title: 'desc' } },
      take: 40,
    });
    const seen = new Set<string>();
    const roles: string[] = [];
    for (const row of rows) {
      if (!row.title) continue;
      const role = roleKeyword(row.title);
      const key = role.toLowerCase();
      // Keep only roles that still contain what the candidate typed, so a title
      // matched on a trailing city does not surface an unrelated-looking role.
      if (role.length < 2 || seen.has(key) || !key.includes(q.toLowerCase())) continue;
      seen.add(key);
      roles.push(role);
      if (roles.length >= SUGGEST_LIMIT) break;
    }
    return roles;
  } catch {
    return [];
  }
}

/**
 * Autocomplete for the Maison field — real Maison names hiring in the
 * perimeter, most active first. A suggestion always leads to a Maison that
 * exists and is hiring there.
 */
export async function suggestCompanies(query: string, perimetre: Perimetre): Promise<string[]> {
  if (!process.env.DATABASE_URL) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const dansLePerimetre = { ...publicJobWhere(), countryCode: { in: [...perimetre.pays] } };
    const rows = await prisma.company.findMany({
      where: {
        ...companyIdentityWhere(q, 'contains'),
        jobs: { some: dansLePerimetre },
      },
      select: { name: true, _count: { select: { jobs: { where: dansLePerimetre } } } },
      take: 40,
    });
    return rows
      .sort((a, b) => b._count.jobs - a._count.jobs)
      .slice(0, SUGGEST_LIMIT)
      .map((r) => r.name);
  } catch {
    return [];
  }
}
