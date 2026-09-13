/**
 * L'INJECTION D'INTERRUPTION DÉTERMINISTE — exercer un arrêt brutal À UN ENDROIT PRÉCIS du pipeline.
 *
 * P8 doit prouver que le pipeline se reprend proprement après une interruption pendant le POOL DE DÉTAILS
 * (scénario B) : ni run orphelin, ni réservation pendante, ni doublon, ni identifiant divergent à la reprise.
 *
 * Pourquoi ce module existe, alors que deux tentatives ont déjà « échoué » :
 *   · `--crash-after=N` du harnais hors ligne compte des TRANSACTIONS COMMITÉES. Il exerce donc une écriture
 *     partielle plus profonde (scénario C), jamais une interruption pendant la lecture des détails ;
 *   · le harnais nominal tournait sur `damart` (Teamtailor) et `nikin` (Recruitee). Teamtailor déclare
 *     « No detail fetch needed », Recruitee lit tout en un appel : **ces sources n'ont aucun pool de détails**.
 *     Aucune injection, si fine soit-elle, n'aurait pu y produire le scénario B.
 *
 * Le pool réel est celui d'iCIMS (`icims.ts` : `pLimit` + `Promise.all` de `fetchText`), consommé
 * INTÉGRALEMENT avant toute persistance — donc l'endroit exact où B se distingue de C.
 *
 * SÛRETÉ, non négociable : ce mécanisme tue le processus. Il est **inerte par défaut** et ne s'arme que sur
 * `P8_CRASH_AT`, contre une liste **fermée** de points. Un nom inconnu lève au lieu de s'ignorer : une faute
 * de frappe qui désarme silencieusement une injection ferait passer un run nominal pour une preuve de reprise.
 */

/** Les points instrumentés. Liste FERMÉE : ajouter un point est un acte délibéré, pas une chaîne libre. */
export const CRASH_POINTS = {
  /** Dans le pool de lecture des détails, avant toute persistance — le scénario B. */
  DURING_DETAIL_POOL: 'DURING_DETAIL_POOL',
  /** Juste avant la transaction d'écriture — utile pour distinguer B de C sur une même source. */
  BEFORE_PERSIST: 'BEFORE_PERSIST',
} as const;

export type CrashPoint = (typeof CRASH_POINTS)[keyof typeof CRASH_POINTS];

let armedPoint: CrashPoint | null = null;
let threshold = 0;
/** Un compteur PAR POINT : deux points instrumentés ne doivent pas consommer le même seuil. */
const seen = new Map<string, number>();

/**
 * (Re)lit l'environnement. Appelé au démarrage et par les tests ; jamais dans une boucle chaude.
 * Lève si `P8_CRASH_AT` nomme un point inconnu.
 */
export function resetCrashInjection(): void {
  seen.clear();
  const raw = process.env.P8_CRASH_AT;
  if (!raw) { armedPoint = null; threshold = 0; return; }
  const known = Object.values(CRASH_POINTS) as string[];
  if (!known.includes(raw)) {
    throw new Error(`P8_CRASH_AT : point d'injection inconnu « ${raw} » — attendu l'un de ${known.join(', ')}`);
  }
  armedPoint = raw as CrashPoint;
  const after = Number(process.env.P8_CRASH_AFTER ?? 0);
  threshold = Number.isFinite(after) && after > 0 ? after : 0;
}

/**
 * `true` quand CE passage doit interrompre le processus. L'appelant décide comment mourir — ce module ne
 * tue pas lui-même, pour rester testable sans sacrifier le processus de test.
 *
 * Le seuil laisse passer les `threshold` premiers passages : s'arrêter au tout premier détail ne prouverait
 * pas qu'un pool PARTIELLEMENT consommé se reprend proprement, qui est précisément la question.
 */
export function crashPointReached(point: CrashPoint): boolean {
  if (armedPoint !== point) return false;
  const n = (seen.get(point) ?? 0) + 1;
  seen.set(point, n);
  return n > threshold;
}

resetCrashInjection();
