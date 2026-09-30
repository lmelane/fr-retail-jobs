import { Prisma, prisma } from '@catwalks/db';
import type { SearchIntent } from './search-intent';

/**
 * D-488 : LE CHEMIN D'UNE RECHERCHE PAR MÉTIER. Les résultats ne dépendent jamais de ce choix (`search-sql.ts`), seule la
 * durée en dépend.
 *
 * Une clause de métier est vérifiée offre par offre dans le marché, sans l'index plein texte, quand le marché compte au
 * plus `MARCHE_RELU_EN_ENTIER` offres, ou quand le métier y porte au moins `PART_METIER_LARGE` des offres : relire ces
 * offres coûte moins que parcourir dans l'index les mots très fréquents de ses expressions (« de », « sales »). Sinon (un
 * métier rare d'un grand marché), le planificateur garde l'index, qui trouve vite les quelques offres concernées.
 *
 * Mesuré en production, en lecture seule, le 30/09/2026 (137 recherches, 12 marchés, requête servie rejouée,
 * `audits/2026-10-01/d488-langues-marche/`) : laisser le planificateur choisir après la restriction aux langues le
 * trompait dans les marchés moyens (Allemagne « Verkaufsberater » 133 → 307 ms, le plan passait par l'index) ; relire le
 * marché partout pénalisait les métiers rares des grands marchés (États-Unis « Visual merchandiser » 48 → 355 ms). Avec
 * cette règle : 14,4 s → 8,5 s sur les 137 recherches, « conseiller de vente » en France 402 → 307 ms.
 */
export const MARCHE_RELU_EN_ENTIER = 5_000;
export const PART_METIER_LARGE = 0.2;
export const REPARTITION_TTL_MS = 10 * 60_000;

export type Repartition = { total: number; parMetier: ReadonlyMap<string, number> };

/** Pure : le chemin d'une intention dans un marché de cette répartition. */
export function metiersSansIndex(intent: SearchIntent, repartition: Repartition): boolean {
  const metiers = intent.clauses.filter((c) => c.kind === 'role' && !c.exclude).flatMap((c) => c.keys);
  if (!metiers.length) return false;
  if (repartition.total <= MARCHE_RELU_EN_ENTIER) return true;
  return metiers.some((m) => (repartition.parMetier.get(m) ?? 0) >= PART_METIER_LARGE * repartition.total);
}

const repartitions = new Map<string, { valeur: Promise<Repartition>; expire: number }>();

/**
 * Les offres actives d'un périmètre, par métier (code du moteur), mémorisées par instance. Un ordre de grandeur pour
 * choisir un chemin, pas un compte publié : l'état publiable exact n'y est pas vérifié. En cas d'échec, le chemin par
 * défaut (celui d'avant D-488) : `null`.
 */
export async function repartitionDuPerimetre(pays: readonly string[]): Promise<Repartition | null> {
  const cle = [...pays].sort().join(',');
  const memo = repartitions.get(cle);
  if (memo && memo.expire > Date.now()) return memo.valeur.catch(() => null);
  const valeur = prisma.$queryRaw<{ code: string | null; n: number }[]>(Prisma.sql`
    SELECT j."occupationCode" AS code, count(*)::int AS n FROM "Job" j
    WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IN (${Prisma.join(pays.map((p) => Prisma.sql`${p}`))})
    GROUP BY 1`).then((lignes) => ({
    total: lignes.reduce((s, l) => s + l.n, 0),
    parMetier: new Map(lignes.flatMap((l) => (l.code ? [[l.code, l.n] as const] : []))),
  }));
  repartitions.set(cle, { valeur, expire: Date.now() + REPARTITION_TTL_MS });
  valeur.catch(() => repartitions.delete(cle));
  return valeur.catch(() => null);
}
