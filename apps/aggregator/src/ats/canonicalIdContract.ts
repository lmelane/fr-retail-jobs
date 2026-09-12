/**
 * LE CONTRAT DES IDENTIFIANTS CANONIQUES — imposé à la source, jamais compensé par un seuil.
 *
 * Une absence ne peut être prouvée qu'en comparant l'ensemble OBSERVÉ à l'ensemble STOCKÉ. Cela n'a de sens que
 * si les deux parlent le même langage. Or ils divergeaient : mesuré le 2026-09-12, la preuve de
 * `american-vintage-dr` énumérait 31 « diffusions » (`4594925-72559621`) quand la base stocke 37 « annonces »
 * (`4459569`) — recouvrement NUL, et 37 offres vivantes déclarées absentes.
 *
 * POURQUOI PAS UN SEUIL DE RECOUVREMENT. « Un seul identifiant commun suffit » détecte le cas extrême à 0 %,
 * mais laisse passer la dérive partielle : 1 identifiant à l'ancien format et 99 au nouveau produiraient
 * 99 fausses absences en paraissant « comparables ». Et tout seuil chiffré serait arbitraire : 80 % de
 * recouvrement, c'est aussi bien « 20 % d'offres disparues » que « 20 % d'identifiants cassés ». Le ratio ne
 * distingue pas les deux ; seule la structure le fait.
 *
 * LA RÈGLE, donc, en trois inclusions — le contrat est BIDIRECTIONNEL :
 *   1. `candidateExternalIds ⊆ canonicalObservedIds` : toute offre produite a été vue ;
 *   2. `disposedIds ⊆ canonicalObservedIds` : une disposition porte sur une ligne réellement vue — sinon un
 *      adaptateur pourrait faire disparaître un trou de sa preuve en le rebaptisant « rejet » ;
 *   3. `canonicalObservedIds ⊆ candidateExternalIds ∪ disposedIds` : toute ligne vue devient une offre ou dit
 *      POURQUOI elle n'en devient pas une.
 *
 * Un manquement n'est pas un avertissement : c'est l'aveu que l'ensemble observé ne peut pas servir de
 * référence, donc que cette source ne peut prouver aucune absence (`UNVERIFIABLE`).
 */

export type AdapterEnumerationResult = {
  /**
   * Les identifiants de SORTIE D'ADAPTATEUR — les `CandidateJob.externalId` produits par ce balayage.
   *
   * Ce ne sont PAS encore des `JobSource` persistées : l'écriture peut encore refuser une ligne (identité),
   * la retenir, ou échouer. Ce contrat démontre donc « sortie de l'adaptateur ↔ preuve d'énumération ». La
   * correspondance avec ce qui existe réellement en base relève du contrat de PERSISTANCE, qui compare les
   * mêmes ensembles au niveau du cycle d'ingestion.
   */
  candidateExternalIds: readonly string[];
  /** Les identifiants canoniques que la preuve d'énumération archive. */
  canonicalObservedIds: readonly string[];
  /** Dispositions explicites d'un identifiant observé qui n'est pas publié. */
  heldIds: readonly string[];
  writeFailedIds: readonly string[];
  rejectedIds: readonly string[];
  collectionErrorIds: readonly string[];
};

export type ContractVerdict = { satisfied: boolean; violations: string[] };

/** Combien de violations sont nommées au plus : au-delà, le message resterait illisible. */
const MAX_NAMED = 200;

export function canonicalIdContract(result: AdapterEnumerationResult): ContractVerdict {
  const violations: string[] = [];
  const observed = new Set(result.canonicalObservedIds);
  const written = new Set(result.candidateExternalIds);

  /**
   * Une preuve canonique VIDE alors que l'adaptateur a produit des offres est un contrat ROMPU, pas une absence
   * de contrat : les identifiants existent d'un côté et manquent de l'autre. C'est le cas que masquait la
   * détection par `canonical.length > 0`.
   */
  if (written.size > 0 && observed.size === 0) {
    violations.push(`${written.size} offre(s) produite(s) alors que la preuve n'archive aucun identifiant canonique`);
    return { satisfied: false, violations };
  }

  // Invariant 1 — une offre écrite doit avoir été vue par le balayage qui l'atteste.
  for (const id of written) {
    if (!observed.has(id)) {
      violations.push(`offre produite « ${id} » absente des identifiants canoniques observés`);
      if (violations.length >= MAX_NAMED) return { satisfied: false, violations };
    }
  }

  /**
   * Invariant 2 — UNE DISPOSITION NE PEUT PAS ÊTRE ORPHELINE.
   *
   * Déclarer `rejectedIds = ['b']` alors que `b` ne figure pas dans l'ensemble observé, c'est excuser un
   * identifiant que le balayage n'a jamais vu. Sans ce contrôle, n'importe quel adaptateur pourrait faire
   * disparaître un trou de sa preuve en le rebaptisant « rejet ». La disposition doit donc porter sur une
   * ligne RÉELLEMENT observée, sinon le contrat tombe.
   */
  const dispositions: Array<[string, readonly string[]]> = [
    ['retenu', result.heldIds], ['refusé à l\'écriture', result.writeFailedIds],
    ['rejeté', result.rejectedIds], ['erreur de collecte', result.collectionErrorIds],
  ];
  for (const [label, ids] of dispositions) {
    for (const id of ids) {
      if (!observed.has(id)) {
        violations.push(`identifiant « ${id} » présenté comme ${label} sans figurer dans les identifiants observés`);
        if (violations.length >= MAX_NAMED) return { satisfied: false, violations };
      }
    }
  }

  // Invariant 3 — un identifiant vu mais non publié doit dire POURQUOI.
  const disposed = new Set([
    ...result.heldIds, ...result.writeFailedIds, ...result.rejectedIds, ...result.collectionErrorIds,
  ]);
  for (const id of observed) {
    if (written.has(id) || disposed.has(id)) continue;
    violations.push(`identifiant observé « ${id} » sans offre ni disposition explicite`);
    if (violations.length >= MAX_NAMED) return { satisfied: false, violations };
  }

  return { satisfied: violations.length === 0, violations };
}
