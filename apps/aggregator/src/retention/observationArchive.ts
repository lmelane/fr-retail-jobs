/**
 * LA RÉTENTION DES OBSERVATIONS — chaud 14 jours, archive 12 mois, purge FAIL-CLOSED.
 *
 * P8 a mesuré la seule borne de capacité franche du pipeline : `SourceObservation` croît d'une ligne par
 * offre et par passage, sans aucune purge — ~441 Mo par passe complète, ~13,2 Go par mois de passes
 * quotidiennes sur une base de 3,35 Go. Le temps, la mémoire et la politesse réseau, eux, ne bornent pas.
 *
 * Politique arbitrée par le propriétaire (2026-09-13) : conservation chaude complète 14 jours, archivage
 * ensuite en stockage objet durable, archives conservées 12 mois, format compressé, partitionnement par
 * date × runId × sourceKey, manifeste immuable.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE PROTÈGE, ET POURQUOI L'ORDRE EST NON NÉGOCIABLE
 *
 * Une observation est la PREUVE qu'une offre a été vue à un instant donné. C'est elle qui permet de conclure
 * à une absence par ensemble d'identifiants (P7) — jamais un `lastSeenAt`, qui est mutable et qui a déjà
 * produit une fausse attribution de 345 écritures dans ce lot.
 *
 * Supprimer une observation dont l'archive n'est pas VÉRIFIÉE rendrait une preuve de P1 à P7 irrécupérable,
 * et de façon silencieuse : rien dans la base ne dirait qu'elle a manqué. D'où l'ordre imposé, où chaque
 * étape est un verrou et non une formalité :
 *
 *   1. créer l'archive          → les octets existent
 *   2. compter les lignes       → l'archive contient bien tout ce qu'on va supprimer
 *   3. calculer le sha256       → les octets sont identifiables
 *   4. vérifier le manifeste    → le compte, la période et l'empreinte concordent
 *   5. restaurer un échantillon → l'archive est RELISIBLE, pas seulement écrite
 *   6. enregistrer les pointeurs→ la base sait où retrouver ce qu'elle s'apprête à perdre
 *   7. supprimer, alors seulement
 *
 * Un échec à n'importe quelle étape ⇒ AUCUNE suppression. C'est la même leçon que D26 : « la sauvegarde
 * n'existe que si la restauration a été prouvée ». Une archive écrite mais jamais relue n'est pas une archive,
 * c'est une intention.
 */

/** Les 14 jours de conservation chaude, arbitrés par le propriétaire. */
export const HOT_RETENTION_DAYS = 14;
/** Les 12 mois de conservation des archives. */
export const ARCHIVE_RETENTION_MONTHS = 12;
/** Version du format d'archive, portée par le manifeste : une archive se relit avec le code de son époque. */
export const ARCHIVE_FORMAT_VERSION = 1;

/** Les étapes, dans l'ordre. Nommées pour qu'un échec se rapporte, pas seulement se compte. */
export const ARCHIVE_STEPS = [
  'CREATE_ARCHIVE',
  'COUNT_ROWS',
  'COMPUTE_SHA256',
  'VERIFY_MANIFEST',
  'RESTORE_SAMPLE',
  'RECORD_POINTERS',
  'DELETE_HOT_ROWS',
] as const;

export type ArchiveStep = (typeof ARCHIVE_STEPS)[number];

/** La partition d'archive : date × runId × sourceKey, le grain imposé par la décision. */
export type ArchivePartition = {
  readonly day: string;       // AAAA-MM-JJ, en UTC
  readonly runId: string;
  readonly sourceKey: string;
};

/** Le manifeste, IMMUABLE : ce qu'on peut affirmer d'une archive sans la relire entièrement. */
export type ArchiveManifest = {
  readonly partition: ArchivePartition;
  readonly rowCount: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly formatVersion: number;
};

export type StepFailure = { readonly step: ArchiveStep; readonly reason: string };

/**
 * Le verdict d'un cycle de rétention pour UNE partition.
 * `deletionAuthorised` est le seul champ qu'un appelant a le droit de consulter pour supprimer.
 */
export type RetentionVerdict = {
  readonly deletionAuthorised: boolean;
  readonly completedSteps: readonly ArchiveStep[];
  readonly failure: StepFailure | null;
  readonly manifest: ArchiveManifest | null;
};

/** Une observation, réduite à ce dont la rétention a besoin. */
export type ObservationRow = {
  readonly id: string;
  readonly sourceKey: string;
  readonly externalId: string;
  readonly contentHash: string;
  readonly observedAt: Date;
};

/**
 * La date de coupure : tout ce qui est STRICTEMENT antérieur est éligible à l'archivage.
 * `now` est un paramètre — une politique de rétention qui lit l'horloge en interne n'est pas testable, et
 * une rétention non testée est une suppression non testée.
 */
export function cutoffDate(now: Date, days: number = HOT_RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Une ligne est-elle éligible ? Le prédicat est SÉPARÉ du reste pour qu'on puisse l'exercer seul : c'est lui
 * qui décide ce qui vit et ce qui part, et une erreur de borne ici supprimerait des observations récentes.
 */
export function isEligibleForArchive(row: ObservationRow, cutoff: Date): boolean {
  return row.observedAt.getTime() < cutoff.getTime();
}

/** Le partitionnement, dérivé de la ligne — jamais choisi par l'appelant. */
export function partitionOf(row: ObservationRow, runId: string): ArchivePartition {
  return { day: row.observedAt.toISOString().slice(0, 10), runId, sourceKey: row.sourceKey };
}

/** Le chemin d'archive : hiérarchique, donc listable et purgeable par date sans lire les manifestes. */
export function archiveObjectKey(p: ArchivePartition): string {
  return `source-observations/${p.day}/${p.runId}/${p.sourceKey}.jsonl.gz`;
}

/**
 * Le manifeste concorde-t-il avec ce qu'on s'apprête à supprimer ?
 *
 * On ne compare pas seulement le compte : un manifeste peut annoncer le bon nombre de lignes et couvrir une
 * autre période, ou porter l'empreinte d'une archive précédente. Les trois sont vérifiés.
 */
export function verifyManifest(
  manifest: ArchiveManifest,
  rows: readonly ObservationRow[],
  observedSha256: string,
): StepFailure | null {
  if (manifest.formatVersion !== ARCHIVE_FORMAT_VERSION) {
    return { step: 'VERIFY_MANIFEST', reason: `version de format ${manifest.formatVersion}, attendu ${ARCHIVE_FORMAT_VERSION}` };
  }
  if (manifest.rowCount !== rows.length) {
    return { step: 'VERIFY_MANIFEST', reason: `manifeste ${manifest.rowCount} lignes, à supprimer ${rows.length}` };
  }
  if (manifest.sha256 !== observedSha256) {
    return { step: 'VERIFY_MANIFEST', reason: 'sha256 du manifeste ≠ sha256 de l\'archive écrite' };
  }
  if (rows.length > 0) {
    const times = rows.map((r) => r.observedAt.getTime());
    const start = new Date(Math.min(...times)).toISOString();
    const end = new Date(Math.max(...times)).toISOString();
    if (manifest.periodStart !== start || manifest.periodEnd !== end) {
      return { step: 'VERIFY_MANIFEST', reason: `période ${manifest.periodStart}..${manifest.periodEnd}, attendu ${start}..${end}` };
    }
  }
  return null;
}

/**
 * L'échantillon restauré correspond-il aux lignes qu'on va supprimer ?
 *
 * Comparaison par ENSEMBLES d'identifiants, jamais par cardinaux : restaurer le bon NOMBRE de lignes en ayant
 * perdu les bonnes est exactement l'erreur que P7 a nommée et que ce lot a re-rencontrée.
 */
export function verifyRestoredSample(
  restored: readonly ObservationRow[],
  expected: readonly ObservationRow[],
): StepFailure | null {
  if (restored.length === 0 && expected.length > 0) {
    return { step: 'RESTORE_SAMPLE', reason: 'aucune ligne restaurée alors que l\'archive en annonce' };
  }
  const key = (r: ObservationRow) => `${r.sourceKey}|${r.externalId}|${r.contentHash}`;
  const expectedKeys = new Set(expected.map(key));
  const missing = restored.filter((r) => !expectedKeys.has(key(r)));
  if (missing.length > 0) {
    return { step: 'RESTORE_SAMPLE', reason: `${missing.length} ligne(s) restaurée(s) absente(s) du lot : ${missing.slice(0, 3).map(key).join(', ')}` };
  }
  return null;
}

/**
 * Le verdict, assemblé dans l'ORDRE. Chaque étape est un verrou : la première qui échoue arrête tout et
 * `deletionAuthorised` reste faux.
 *
 * Ce module ne supprime rien lui-même et n'écrit rien : il DÉCIDE. Séparer la décision de l'effet est ce qui
 * permet de tester la politique sans risquer une donnée, et ce qui empêche qu'un chemin d'appel oublie une
 * étape en la réimplémentant à côté.
 */
export function retentionVerdict(input: {
  rows: readonly ObservationRow[];
  manifest: ArchiveManifest | null;
  observedSha256: string | null;
  restoredSample: readonly ObservationRow[] | null;
  pointersRecorded: boolean;
  archiveCreated: boolean;
}): RetentionVerdict {
  const done: ArchiveStep[] = [];
  const fail = (step: ArchiveStep, reason: string): RetentionVerdict =>
    ({ deletionAuthorised: false, completedSteps: done, failure: { step, reason }, manifest: input.manifest });

  if (!input.archiveCreated) return fail('CREATE_ARCHIVE', 'archive non créée');
  done.push('CREATE_ARCHIVE');

  // Une partition vide n'a rien à archiver ET rien à supprimer : ce n'est pas un échec, c'est un non-événement.
  if (input.rows.length === 0) {
    return { deletionAuthorised: false, completedSteps: done, failure: null, manifest: input.manifest };
  }
  done.push('COUNT_ROWS');

  if (!input.observedSha256) return fail('COMPUTE_SHA256', 'sha256 de l\'archive non calculé');
  done.push('COMPUTE_SHA256');

  if (!input.manifest) return fail('VERIFY_MANIFEST', 'manifeste absent');
  const manifestFailure = verifyManifest(input.manifest, input.rows, input.observedSha256);
  if (manifestFailure) return fail(manifestFailure.step, manifestFailure.reason);
  done.push('VERIFY_MANIFEST');

  if (input.restoredSample === null) return fail('RESTORE_SAMPLE', 'aucune restauration tentée');
  const sampleFailure = verifyRestoredSample(input.restoredSample, input.rows);
  if (sampleFailure) return fail(sampleFailure.step, sampleFailure.reason);
  done.push('RESTORE_SAMPLE');

  if (!input.pointersRecorded) return fail('RECORD_POINTERS', 'pointeurs d\'archive non enregistrés');
  done.push('RECORD_POINTERS');

  return { deletionAuthorised: true, completedSteps: done, failure: null, manifest: input.manifest };
}
