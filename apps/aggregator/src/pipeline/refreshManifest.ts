/**
 * LE MANIFESTE DE REFRESH — la liste EXACTE des lignes que la mutation a le droit de toucher.
 *
 * Sans lui, la prévisualisation et l'exécution feraient deux calculs indépendants, et rien ne garantirait
 * qu'ils portent sur les mêmes lignes : l'état peut bouger entre les deux, et un recalcul silencieux pendant
 * la mutation toucherait des offres que personne n'a vues dans la revue.
 *
 * Le manifeste est donc FIGÉ (la liste), HACHÉ (l'empreinte), RELU avant mutation (l'état n'a pas changé), et
 * la mutation refuse toute ligne qui n'y figure pas.
 *
 * L'empreinte couvre le PLAN, pas son enrobage : les identifiants, leur état observé et la conséquence
 * attendue. Y mêler l'heure de génération rendrait tout manifeste unique et le contrôle inopérant.
 */
import { createHash } from 'node:crypto';

export type ManifestEntry = {
  jobSourceId: string;
  sourceKey: string;
  externalId: string;
  jobId: string;
  /** L'état observé qui justifie la désactivation — toujours `ABSENT_FROM_PROVEN_ENUMERATION`. */
  state: string;
  /** Ce que la mutation doit produire : l'offre survit, ou elle ferme. */
  consequence: 'JOB_KEPT_BY_ANOTHER_SOURCE' | 'JOB_CANDIDATE_FOR_CLOSURE';
};

export type RefreshManifest = {
  /** Les clés autorisées : aucune ligne d'une autre source ne peut entrer. */
  allowedSourceKeys: string[];
  entries: ManifestEntry[];
  planHash: string;
  createdAt: string;
};

/**
 * L'empreinte du plan : les entrées TRIÉES, réduites à ce qui décide.
 *
 * Le tri est indispensable — deux plans identiques produits dans un ordre différent doivent donner la même
 * empreinte, sinon le contrôle échouerait sur une différence qui n'en est pas une.
 */
export function manifestHash(allowedSourceKeys: readonly string[], entries: readonly ManifestEntry[]): string {
  const canonical = {
    allowed: [...allowedSourceKeys].sort(),
    entries: [...entries]
      .map((e) => [e.jobSourceId, e.sourceKey, e.externalId, e.jobId, e.state, e.consequence])
      .sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0)),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function freezeManifest(allowedSourceKeys: readonly string[], entries: readonly ManifestEntry[]): RefreshManifest {
  return {
    allowedSourceKeys: [...allowedSourceKeys].sort(),
    entries: [...entries].sort((a, b) => (a.jobSourceId < b.jobSourceId ? -1 : a.jobSourceId > b.jobSourceId ? 1 : 0)),
    planHash: manifestHash(allowedSourceKeys, entries),
    createdAt: new Date().toISOString(),
  };
}

export type ManifestCheck = { valid: boolean; problems: string[] };

/**
 * Le manifeste décrit-il TOUJOURS l'état de la base ?
 *
 * Trois refus, et chacun correspond à un incident réel possible entre la revue et la mutation :
 *  · l'empreinte ne correspond plus au contenu → le manifeste a été modifié après signature ;
 *  · une ligne du manifeste n'est plus active → une autre opération l'a déjà traitée, le plan est périmé ;
 *  · une ligne porte une source hors allowlist → le périmètre a fui.
 *
 * Refuser est le comportement voulu : on rejoue une prévisualisation, on ne « rattrape » pas en mutant.
 */
export function verifyManifest(
  manifest: RefreshManifest,
  currentlyActiveJobSourceIds: ReadonlySet<string>,
): ManifestCheck {
  const problems: string[] = [];

  const recomputed = manifestHash(manifest.allowedSourceKeys, manifest.entries);
  if (recomputed !== manifest.planHash) {
    problems.push(`empreinte du plan invalide : ${recomputed.slice(0, 12)} ≠ ${manifest.planHash.slice(0, 12)}`);
  }

  const allowed = new Set(manifest.allowedSourceKeys);
  for (const entry of manifest.entries) {
    if (!allowed.has(entry.sourceKey)) {
      problems.push(`ligne hors allowlist : ${entry.sourceKey} / ${entry.externalId}`);
    }
    if (!currentlyActiveJobSourceIds.has(entry.jobSourceId)) {
      problems.push(`ligne du manifeste déjà inactive : ${entry.jobSourceId} (${entry.sourceKey} / ${entry.externalId})`);
    }
  }

  return { valid: problems.length === 0, problems };
}

/**
 * Ce que la mutation a réellement touché correspond-il au manifeste ?
 *
 * Comparé par ENSEMBLES d'identifiants, jamais par cardinal : toucher autant de lignes que prévu mais pas les
 * mêmes serait indétectable sur un total, et c'est précisément le scénario dangereux.
 */
export function compareTouched(
  manifest: RefreshManifest,
  touchedJobSourceIds: readonly string[],
): { equal: boolean; missing: string[]; unexpected: string[] } {
  const expected = new Set(manifest.entries.map((e) => e.jobSourceId));
  const actual = new Set(touchedJobSourceIds);
  const missing = [...expected].filter((id) => !actual.has(id));
  const unexpected = [...actual].filter((id) => !expected.has(id));
  return { equal: missing.length === 0 && unexpected.length === 0, missing, unexpected };
}
