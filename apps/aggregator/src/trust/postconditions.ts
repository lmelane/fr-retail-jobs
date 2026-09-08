/**
 * POST-CONDITIONS DE MIGRATION — la troisième étape, celle qui trouve les bugs.
 *
 * Gravé le 2026-09-08 après un cas d'école. Le dry-run de la migration
 * géographie annonçait 18 733 subdivisions, et il disait VRAI : c'est bien ce
 * que la chaîne allait écrire. La base, elle, en contenait 703 de fausses —
 * « Outlet » pour un centre commercial autrichien, « Macquarie Centre » pour un
 * site australien, Amsterdam rangée à Terre-Neuve. Toutes trouvées en RELISANT
 * la prod après écriture, jamais avant.
 *
 * La méthode qui en sort (décision Loïc) :
 *
 *   1. dry-run de DÉCISION       « qu'allons-nous écrire ? »
 *   2. simulation de l'ÉTAT      « à quoi ressemblera la base, toutes écritures combinées ? »
 *   3. INVARIANTS globaux        « cet état est-il cohérent ? »
 *
 * L'étape 1 valide une intention ; seules les étapes 2 et 3 valident un
 * résultat. Un invariant se formule comme une propriété que la base doit
 * vérifier, jamais comme un compte attendu : « aucune subdivision hors d'un pays
 * dont on a la table » survit à un changement de volume, « exactement 15 845
 * subdivisions » non.
 */

/** Une propriété que l'état final doit vérifier. */
export type Invariant<T> = {
  /** Ce que la propriété affirme, en une phrase lisible dans un rapport. */
  name: string;
  /** Vrai quand CETTE ligne viole la propriété. */
  violates: (row: T) => boolean;
  /**
   * Comment nommer une ligne fautive dans le rapport. Un invariant qui dit
   * seulement « 703 violations » envoie chercher ; un invariant qui montre
   * « AU → Outlet » a déjà expliqué le bug.
   */
  describe: (row: T) => string;
};

export type InvariantResult = {
  name: string;
  ok: boolean;
  violations: number;
  /** Bornés pour rester lisibles ; le décompte, lui, est toujours exact. */
  samples: string[];
};

const DEFAULT_MAX_SAMPLES = 10;

/**
 * Vérifie tous les invariants en une seule passe sur les lignes.
 *
 * Une seule passe parce que ces contrôles tournent sur des dizaines de milliers
 * de lignes chargées depuis la base : relire la population par invariant
 * multiplierait le coût sans rien apporter.
 */
export function checkInvariants<T>(
  rows: readonly T[],
  invariants: readonly Invariant<T>[],
  options: { maxSamples?: number } = {},
): InvariantResult[] {
  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
  const results: InvariantResult[] = invariants.map((inv) => ({
    name: inv.name,
    ok: true,
    violations: 0,
    samples: [],
  }));

  for (const row of rows) {
    for (let i = 0; i < invariants.length; i++) {
      if (!invariants[i].violates(row)) continue;
      const result = results[i];
      result.ok = false;
      result.violations++;
      if (result.samples.length < maxSamples) result.samples.push(invariants[i].describe(row));
    }
  }

  return results;
}

/** Rend un rapport lisible ; `ok` dit si la migration peut être considérée close. */
export function formatInvariants(results: readonly InvariantResult[]): { text: string; ok: boolean } {
  const lines = results.map((r) => {
    const head = `  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `  — ${r.violations} violation(s)`}`;
    const samples = r.samples.map((s) => `      · ${s}`);
    return [head, ...samples].join('\n');
  });
  return { text: lines.join('\n'), ok: results.every((r) => r.ok) };
}
