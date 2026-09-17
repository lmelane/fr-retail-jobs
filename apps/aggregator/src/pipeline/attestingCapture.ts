/**
 * LA CAPTURE ATTESTANTE d'une source — la seule base d'une preuve d'absence.
 *
 * Une absence se prouve sur le même périmètre natif et la même révision de source, avec des identifiants
 * comparables et un parcours complet démontré. Ce que ce module lit pour l'établir est entièrement scellé :
 *
 *   · la DERNIÈRE tentative d'offres de la révision courante (ordre SQL, jamais l'horloge), qui doit être
 *     ADMISE (`SourceIngestionAdmission`), SCELLÉE (`CaptureOutcome` EXTRACTED + manifeste haché) et ACHEVÉE
 *     (`SourceIngestionCompletion`, rapport haché) ;
 *   · le manifeste scellé du résultat d'adaptateur : énumération, terminaison, identifiants canoniques, total
 *     déclaré, troncature, lignes rejetées ;
 *   · le rapport de fin d'ingestion : le devenir de chaque sortie que la boucle n'a pas publiée.
 *
 * La porte de publication (`requireCurrentCaptureRevision`) est réutilisée telle quelle : une collecte qui ne
 * pourrait plus publier aujourd'hui — source non ACTIVE, révision changée, accès révoqué, identité remplacée,
 * qualification périmée ou tentative plus récente — ne peut pas non plus faire disparaître une offre.
 *
 * Ce que ce module NE lit PAS : `SourceRun` (historique de santé élagué) et `PipelineEvent` (journal de
 * diagnostic). Ni l'un ni l'autre n'est une preuve.
 */
import type { Prisma } from '@prisma/client';
import type { ObjectStore } from '../retention/objectStore.js';
import { readExtractionManifest } from '../capture/manifest.js';
import { readIngestionCompletion } from '../capture/completion.js';
import { requireCurrentCaptureRevision } from '../connectors/sourceRevision.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { isDeclaredEmptyEnumeration, isTrustedForAttestation } from './attestation.js';
import { splitRejectedRows } from './rejectedRows.js';
import { enumerationEvidence, type AttestationFacts, type EnumerationEvidence } from './refreshPlan.js';

/** Les identifiants VUS par la capture, classés par devenir. `published` = sorties du manifeste sans disposition. */
export type CaptureDispositions = {
  published: Set<string>; held: Set<string>; writeFailed: Set<string>; skipped: Set<string>; rejected: Set<string>;
  /** Lignes rejetées ou sorties sans identifiant exploitable : une absence pourrait être l'une d'elles. */
  anonymous: number;
};
export type AttestingCapture = {
  sourceKey: string; captureBatchId: string; sourceRevisionId: string; startedAt: Date; completedAt: Date;
  manifestHash: string; reportHash: string; facts: AttestationFacts; evidence: EnumerationEvidence;
  dispositions: CaptureDispositions;
  /** L'empreinte figée dans le manifeste de refresh : mêmes faits, même preuve, mêmes octets scellés. */
  proofHash: string;
};
export type AttestingCaptureResult = { ok: true; capture: AttestingCapture } | { ok: false; captureBatchId: string | null; reasons: string[] };

const HALF = 0.5;
const COLLAPSE_SHARE = HALF;

/**
 * Les faits d'attestation dérivés de la preuve scellée. Pure, pour être contre-éprouvée sans base.
 *
 * `status` est la projection, pertinente pour le droit d'attester, de la classification de santé : un run
 * qui n'a rien publié sans zéro déclaré ne prouve rien (BROKEN), un premier run n'a pas de passé (NEW), un run
 * avec erreurs, retenues ou troncature est DEGRADED — et seul `isTrustedForAttestation` tranche ensuite.
 */
export function attestationFacts(input: {
  sourceKey: string; captureBatchId: string; startedAt: Date;
  metadata: { complete?: boolean; truncated?: boolean; declaredTotal?: number };
  outputs: number; counts: { published: number; held: number; writeFailed: number; skipped: number };
  unreadableRows: number; previousPublished: number | null;
}): AttestationFacts {
  const { counts, previousPublished: previous } = input;
  const errors = counts.writeFailed + input.unreadableRows;
  const complete = input.metadata.complete ?? null;
  const truncated = input.metadata.truncated === true;
  const declaredTotal = input.metadata.declaredTotal ?? null;
  const fetched = input.outputs;
  const declaredEmpty = isDeclaredEmptyEnumeration({ complete: complete ?? undefined, errors, truncated, declaredTotal: declaredTotal ?? undefined, fetched });
  const status: AttestationFacts['status'] = counts.published === 0 && !declaredEmpty ? 'BROKEN'
    : previous === null && !declaredEmpty ? 'NEW'
    : errors > 0 || counts.held > 0 || truncated ? 'DEGRADED' : 'OK';
  const collapsed = !declaredEmpty && previous !== null && previous > 0 && counts.published < previous * COLLAPSE_SHARE;
  const canAttestAbsence = (previous !== null || declaredEmpty) && !collapsed && isTrustedForAttestation({
    status, complete: complete ?? undefined, errors, truncated, declaredTotal: declaredTotal ?? undefined, fetched, previous,
  });
  return { sourceKey: input.sourceKey, captureBatchId: input.captureBatchId, startedAt: input.startedAt, status, errors, truncated,
    complete, declaredTotal, fetched, published: counts.published, previous, canAttestAbsence };
}

function gateReason(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : null;
  const message = error instanceof Error ? error.message : 'unknown gate failure';
  return `porte de publication : ${code ? `${code} — ` : ''}${message}`;
}

/** Lit la capture attestante d'une source, ou explique pourquoi elle n'en a aucune. Aucune écriture. */
export async function readAttestingCapture(db: Prisma.TransactionClient, sourceKey: string, now: Date, store?: ObjectStore): Promise<AttestingCaptureResult> {
  const [registry] = await db.$queryRaw<{ status: string; currentRevisionId: string }[]>`
    SELECT status, "currentRevisionId" FROM "Source" WHERE key=${sourceKey}`;
  if (!registry) return { ok: false, captureBatchId: null, reasons: ['source absente du registre'] };
  if (registry.status !== 'ACTIVE') return { ok: false, captureBatchId: null, reasons: [`source ${registry.status} : aucune collecte admise possible`] };
  const batch = await db.captureBatch.findFirst({
    where: { sourceKey, sourceRevisionId: registry.currentRevisionId, purpose: 'JOBS', attemptOrdinal: { not: null } },
    orderBy: { attemptOrdinal: 'desc' }, include: { outcome: true, ingestionAdmission: true, ingestionCompletion: true },
  });
  if (!batch) return { ok: false, captureBatchId: null, reasons: ['aucune collecte d’offres de la révision courante'] };
  const reasons: string[] = [];
  if (!batch.ingestionAdmission) reasons.push('dernière collecte non admise : sonde de qualification');
  if (!batch.outcome) reasons.push('dernière collecte inachevée : aucun résultat scellé');
  else if (batch.outcome.status !== 'EXTRACTED' || !batch.outcome.manifestHash) reasons.push(`dernière collecte échouée : ${batch.outcome.failure ?? batch.outcome.status}`);
  if (!batch.ingestionCompletion) reasons.push('publication inachevée : aucun rapport de fin d’ingestion');
  if (reasons.length) return { ok: false, captureBatchId: batch.id, reasons };
  try { await requireCurrentCaptureRevision(db, batch); }
  catch (error) { return { ok: false, captureBatchId: batch.id, reasons: [gateReason(error)] }; }
  // A sealed proof that cannot be read back and verified (cold archive unavailable,
  // corrupted bytes, report and manifest disagreeing) proves nothing. It never falls back
  // to the network, to a health row or to a diagnostic log.
  let manifest: Awaited<ReturnType<typeof readExtractionManifest>>, completion: Awaited<ReturnType<typeof readIngestionCompletion>>;
  try {
    manifest = await readExtractionManifest(db, batch.id, store);
    completion = await readIngestionCompletion(db, batch.id, store);
  } catch (error) {
    return { ok: false, captureBatchId: batch.id, reasons: [`preuve scellée illisible : ${error instanceof Error ? error.message : 'unknown'}`] };
  }
  if (!completion || completion.report.outputs !== manifest.outputs.length) return { ok: false, captureBatchId: batch.id, reasons: ['rapport de fin d’ingestion sans correspondance avec le manifeste scellé'] };
  const previous = await db.sourceIngestionCompletion.findFirst({
    where: { batch: { sourceKey }, published: { gt: 0 }, completedAt: { lt: completion.row.completedAt }, batchId: { not: batch.id } },
    orderBy: [{ completedAt: 'desc' }, { batchId: 'desc' }], select: { published: true },
  });
  const rejectedRows = Array.isArray(manifest.metadata.rejectedRows) ? manifest.metadata.rejectedRows : [];
  const split = splitRejectedRows(rejectedRows);
  const facts = attestationFacts({ sourceKey, captureBatchId: batch.id, startedAt: batch.startedAt, metadata: manifest.metadata,
    outputs: manifest.outputs.length, counts: completion.row, unreadableRows: split.failures.length, previousPublished: previous?.published ?? null });
  const evidence = enumerationEvidence(sourceKey, batch.id, manifest.metadata);
  const fateByOrdinal = new Map(completion.report.fates.map(fate => [fate.ordinal, fate]));
  const ids = (disposition: string) => new Set(completion.report.fates.filter(fate => fate.disposition === disposition && fate.externalId).map(fate => fate.externalId!));
  const rejected = new Set<string>();
  let anonymous = completion.report.fates.filter(fate => !fate.externalId).length;
  for (const row of rejectedRows) {
    const id = typeof row.canonicalId === 'string' && row.canonicalId.trim() ? row.canonicalId : null;
    if (id) rejected.add(id); else anonymous++;
  }
  const dispositions: CaptureDispositions = {
    published: new Set(manifest.outputs.filter(output => !fateByOrdinal.has(output.ordinal) && output.externalId).map(output => output.externalId!)),
    held: ids('HELD'), writeFailed: ids('WRITE_FAILED'), skipped: ids('SKIPPED_OUT_OF_SECTOR'), rejected, anonymous,
  };
  const proofHash = evidenceHash({ captureBatchId: batch.id, manifestHash: batch.outcome!.manifestHash, reportHash: completion.row.reportHash,
    facts: { ...facts, startedAt: facts.startedAt.toISOString() }, evidence: { ...evidence, canonicalSet: [...evidence.canonicalSet].sort() } });
  return { ok: true, capture: { sourceKey, captureBatchId: batch.id, sourceRevisionId: registry.currentRevisionId, startedAt: batch.startedAt,
    completedAt: completion.row.completedAt, manifestHash: batch.outcome!.manifestHash!, reportHash: completion.row.reportHash,
    facts, evidence, dispositions, proofHash } };
}
