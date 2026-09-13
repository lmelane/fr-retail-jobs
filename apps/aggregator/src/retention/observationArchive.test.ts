import { describe, it, expect } from 'vitest';
import {
  retentionVerdict, verifyManifest, verifyRestoredSample, cutoffDate, isEligibleForArchive,
  partitionOf, archiveObjectKey, ARCHIVE_FORMAT_VERSION, HOT_RETENTION_DAYS,
  type ObservationRow, type ArchiveManifest,
} from './observationArchive.js';

/**
 * LA RÉTENTION — ce qui est testé ici, c'est le DROIT DE SUPPRIMER, pas la suppression.
 *
 * Une observation est la preuve qu'une offre a été vue à un instant donné : c'est elle qui permet de conclure
 * à une absence par ensemble d'identifiants (P7). En supprimer une dont l'archive n'est pas vérifiée rendrait
 * une preuve de P1 à P7 irrécupérable — et silencieusement, puisque rien en base ne dirait qu'elle a manqué.
 *
 * Chaque test ci-dessous fait échouer UNE étape et vérifie qu'aucune suppression n'est autorisée. C'est la
 * seule façon de prouver un « fail-closed » : montrer qu'il ferme, un verrou à la fois.
 */
const AT = new Date('2026-09-01T10:00:00.000Z');

const row = (externalId: string, iso = '2026-09-01T10:00:00.000Z'): ObservationRow => ({
  id: `id-${externalId}`, sourceKey: 'mecca', externalId, contentHash: `h-${externalId}`, observedAt: new Date(iso),
});

const ROWS = [row('a'), row('b', '2026-09-01T11:00:00.000Z')];
const SHA = 'a'.repeat(64);

const manifest = (over: Partial<ArchiveManifest> = {}): ArchiveManifest => ({
  partition: { day: '2026-09-01', runId: 'run-1', sourceKey: 'mecca' },
  rowCount: 2,
  periodStart: '2026-09-01T10:00:00.000Z',
  periodEnd: '2026-09-01T11:00:00.000Z',
  sizeBytes: 4096,
  sha256: SHA,
  formatVersion: ARCHIVE_FORMAT_VERSION,
  ...over,
});

const happy = {
  rows: ROWS, manifest: manifest(), observedSha256: SHA,
  restoredSample: ROWS, pointersRecorded: true, archiveCreated: true,
};

describe('rétention — le chemin nominal autorise, et seulement lui', () => {
  it('les sept étapes franchies → suppression autorisée', () => {
    const v = retentionVerdict(happy);
    expect(v.deletionAuthorised).toBe(true);
    expect(v.failure).toBeNull();
    expect(v.completedSteps).toEqual([
      'CREATE_ARCHIVE', 'COUNT_ROWS', 'COMPUTE_SHA256', 'VERIFY_MANIFEST', 'RESTORE_SAMPLE', 'RECORD_POINTERS',
    ]);
  });

  it('une partition VIDE n\'autorise rien, et n\'est pas un échec', () => {
    // Rien à archiver, donc rien à supprimer. Autoriser une suppression sur un lot vide serait inoffensif
    // aujourd'hui et dangereux le jour où le calcul du lot a un défaut.
    const v = retentionVerdict({ ...happy, rows: [], restoredSample: [] });
    expect(v.deletionAuthorised).toBe(false);
    expect(v.failure).toBeNull();
  });
});

describe('rétention — FAIL-CLOSED, une étape à la fois', () => {
  it('archive non créée → aucune suppression', () => {
    const v = retentionVerdict({ ...happy, archiveCreated: false });
    expect(v.deletionAuthorised).toBe(false);
    expect(v.failure?.step).toBe('CREATE_ARCHIVE');
  });

  it('sha256 non calculé → aucune suppression', () => {
    const v = retentionVerdict({ ...happy, observedSha256: null });
    expect(v.deletionAuthorised).toBe(false);
    expect(v.failure?.step).toBe('COMPUTE_SHA256');
  });

  it('manifeste absent → aucune suppression', () => {
    const v = retentionVerdict({ ...happy, manifest: null });
    expect(v.deletionAuthorised).toBe(false);
    expect(v.failure?.step).toBe('VERIFY_MANIFEST');
  });

  it('manifeste qui compte MOINS de lignes qu\'on n\'en supprime → aucune suppression', () => {
    // Le cas qui perdrait des preuves sans rien signaler : l'archive existe, elle est simplement incomplète.
    const v = retentionVerdict({ ...happy, manifest: manifest({ rowCount: 1 }) });
    expect(v.deletionAuthorised).toBe(false);
    expect(v.failure?.reason).toContain('1 lignes');
  });

  it('sha256 du manifeste ≠ sha256 de l\'archive écrite → aucune suppression', () => {
    const v = retentionVerdict({ ...happy, manifest: manifest({ sha256: 'b'.repeat(64) }) });
    expect(v.deletionAuthorised).toBe(false);
    expect(v.failure?.reason).toContain('sha256');
  });

  it('période du manifeste qui ne couvre pas les lignes → aucune suppression', () => {
    const v = retentionVerdict({ ...happy, manifest: manifest({ periodEnd: '2026-09-02T00:00:00.000Z' }) });
    expect(v.deletionAuthorised).toBe(false);
    expect(v.failure?.step).toBe('VERIFY_MANIFEST');
  });

  it('version de format inconnue → aucune suppression', () => {
    // Une archive qu'on ne saura pas relire avec le code de son époque n'est pas une archive.
    const v = retentionVerdict({ ...happy, manifest: manifest({ formatVersion: 99 }) });
    expect(v.deletionAuthorised).toBe(false);
    expect(v.failure?.reason).toContain('version de format');
  });

  it('aucune restauration tentée → aucune suppression', () => {
    // « La sauvegarde n'existe que si la restauration a été prouvée » (D26). Une archive écrite mais jamais
    // relue est une intention, pas une archive.
    const v = retentionVerdict({ ...happy, restoredSample: null });
    expect(v.deletionAuthorised).toBe(false);
    expect(v.failure?.step).toBe('RESTORE_SAMPLE');
  });

  it('restauration VIDE alors que l\'archive annonce des lignes → aucune suppression', () => {
    const v = retentionVerdict({ ...happy, restoredSample: [] });
    expect(v.deletionAuthorised).toBe(false);
    expect(v.failure?.step).toBe('RESTORE_SAMPLE');
  });

  it('restauration qui rend d\'AUTRES identifiants → aucune suppression', () => {
    // Le bon NOMBRE de lignes, les mauvaises : exactement l'erreur que P7 a nommée. La comparaison est par
    // ensembles d'identifiants, jamais par cardinaux.
    const v = retentionVerdict({ ...happy, restoredSample: [row('x'), row('y')] });
    expect(v.deletionAuthorised).toBe(false);
    expect(v.failure?.step).toBe('RESTORE_SAMPLE');
  });

  it('pointeurs non enregistrés → aucune suppression', () => {
    // Sans pointeur, la base ne saurait plus où retrouver ce qu'elle s'apprête à perdre.
    const v = retentionVerdict({ ...happy, pointersRecorded: false });
    expect(v.deletionAuthorised).toBe(false);
    expect(v.failure?.step).toBe('RECORD_POINTERS');
  });

  it('l\'étape qui échoue arrête la séquence : les suivantes ne sont jamais marquées faites', () => {
    const v = retentionVerdict({ ...happy, observedSha256: null });
    expect(v.completedSteps).not.toContain('VERIFY_MANIFEST');
    expect(v.completedSteps).not.toContain('RESTORE_SAMPLE');
    expect(v.completedSteps).not.toContain('RECORD_POINTERS');
  });
});

describe('éligibilité — la borne des 14 jours, exercée aux extrémités', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');
  const cutoff = cutoffDate(now);

  it('la coupure vaut bien 14 jours avant maintenant', () => {
    expect(HOT_RETENTION_DAYS).toBe(14);
    expect(cutoff.toISOString()).toBe('2026-09-06T12:00:00.000Z');
  });

  it('une observation de 15 jours est éligible', () => {
    expect(isEligibleForArchive(row('a', '2026-09-05T12:00:00.000Z'), cutoff)).toBe(true);
  });

  it('une observation de 13 jours ne l\'est PAS', () => {
    expect(isEligibleForArchive(row('a', '2026-09-07T12:00:00.000Z'), cutoff)).toBe(false);
  });

  it('une observation pile à la coupure n\'est PAS éligible — la borne est stricte', () => {
    // Une inégalité mal orientée ici supprimerait une journée d'observations de plus que décidé.
    expect(isEligibleForArchive(row('a', '2026-09-06T12:00:00.000Z'), cutoff)).toBe(false);
  });

  it('une observation d\'aujourd\'hui n\'est jamais éligible', () => {
    expect(isEligibleForArchive(row('a', '2026-09-20T11:59:00.000Z'), cutoff)).toBe(false);
  });
});

describe('partitionnement — date × runId × sourceKey', () => {
  it('la partition est DÉRIVÉE de la ligne, pas choisie', () => {
    expect(partitionOf(row('a', '2026-09-03T23:59:59.000Z'), 'run-7'))
      .toEqual({ day: '2026-09-03', runId: 'run-7', sourceKey: 'mecca' });
  });

  it('le jour est en UTC — pas de glissement de fuseau', () => {
    expect(partitionOf(row('a', '2026-09-03T23:30:00.000Z'), 'r').day).toBe('2026-09-03');
    expect(partitionOf(row('a', '2026-09-04T00:30:00.000Z'), 'r').day).toBe('2026-09-04');
  });

  it('le chemin d\'archive est hiérarchique : listable et purgeable par date', () => {
    expect(archiveObjectKey({ day: '2026-09-03', runId: 'run-7', sourceKey: 'mecca' }))
      .toBe('source-observations/2026-09-03/run-7/mecca.jsonl.gz');
  });
});

describe('vérifications unitaires, exercées seules', () => {
  it('verifyManifest accepte un lot conforme', () => {
    expect(verifyManifest(manifest(), ROWS, SHA)).toBeNull();
  });

  it('verifyRestoredSample accepte un sous-ensemble — on restaure un ÉCHANTILLON', () => {
    // Restaurer tout serait plus coûteux sans être plus probant : ce qui compte est que ce qui revient
    // appartienne bien au lot.
    expect(verifyRestoredSample([ROWS[0]!], ROWS)).toBeNull();
  });

  it('verifyRestoredSample refuse une ligne étrangère au lot', () => {
    expect(verifyRestoredSample([row('z')], ROWS)?.step).toBe('RESTORE_SAMPLE');
  });
});
