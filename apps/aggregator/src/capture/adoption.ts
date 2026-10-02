/**
 * LECTURE UNIQUE DU RUN (lecture D-492 de D-516 §1, 02/10/2026).
 *
 * Quand la qualification native d'une source a dû être refaite dans ce tour (`maintainSourceAccess`), l'ingestion qui
 * suit publie CETTE capture, rejouée hors réseau par le lecteur lui-même, au lieu de relire le site. Le 01/10/2026, le
 * RUN a lu deux fois 411 sources sur 411 (56 874 requêtes de qualification, puis 54 893 d'ingestion) ; chez Avature,
 * une lecture qui suit de moins de 5 minutes une lecture complète est refusée (406) dès son début, 12 fois sur 12.
 *
 * Rien n'est affaibli : la capture adoptée doit donner exactement ce qu'aurait donné une nouvelle lecture du même
 * contenu, et elle passe ensuite TOUTES les portes de la collecte sous décision (publication, retenues, attestation).
 * Elle n'est adoptée qu'à ces conditions, vérifiées ici puis, pour celles qui tiennent en base, par le garde SQL de
 * `SourceCaptureAdoption` (migration 20261002190000) :
 *   · c'est la capture que la qualification de CE tour vient de faire (même run), de cette source, sans décision
 *     d'accès à sa création (une collecte gouvernée a son admission normale) ;
 *   · même révision de source, mêmes réglages, même lecteur ; EXTRACTED, transport pris en charge ;
 *   · sa propre validation est la plus récente de la révision, VALIDATED, rejeu exact, politique courante ;
 *   · son énumération n'est ni INCOMPLETE ni tronquée (`ENUMERATION_INCOMPLETE`) : une lecture coupée se relit ;
 *   · elle est la dernière tentative de la révision et date d'au plus 60 minutes (`CAPTURE_ADOPTION_MAX_AGE_MS`) ;
 *   · la décision d'accès courante couvre son journal ENTIER (chaque saut HTTP dans un périmètre, l'amorçage WAF
 *     déclaré), comme la collecte sous décision l'aurait exigé requête par requête ;
 *   · son rejeu hors réseau, maintenant, rend exactement son manifeste scellé (sorties et métadonnées).
 * Sinon : refus nommé, journalisé (`source.capture_adoption_refused`), et la source relit le site comme avant.
 */
import type { AtsType, PrismaClient } from '@prisma/client';
import type { AdapterResult } from '../types.js';
import type { ObjectStore } from '../retention/objectStore.js';
import { replayExtraction } from './batch.js';
import { compareExtractionResult } from './manifest.js';
import { captureConfig } from './config.js';
import { captureReaderRevision } from './revision.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { requireSourceAccess } from '../connectors/sourceAccess.js';
import { SourceAccessGateError } from '../connectors/accessScope.js';
import { journalCoveredBy } from '../connectors/sourceAccessQualification.js';
import { SOURCE_VALIDATION_POLICY } from '../connectors/sourceCertification.js';
import { CAPTURE_ADOPTION_POLICY } from '../connectors/sourceAdmission.js';
import { lockSourceWrites, SOURCE_WRITE_TRANSACTION } from '../lib/writeLocks.js';
import { fetchAtsJobs } from '../ats/index.js';
import { log } from '../observability/logger.js';

/**
 * L'âge maximal d'une capture adoptée, au moment de l'adoption. Le 01/10/2026, l'ingestion a commencé au plus 19,1 min
 * après sa qualification (p95 2,5 min, médiane 0, 408 sources ; `audits/2026-10-02/lecture-unique/requetes.out`) :
 * c'est l'âge qu'a déjà, aujourd'hui, le contenu que la seconde lecture remplace. 60 min laisse trois fois ce maximum à
 * la plus longue qualification ; au-delà, la capture ne vient pas du même tour de la source. Le garde SQL porte la même
 * borne.
 */
export const CAPTURE_ADOPTION_MAX_AGE_MS = 60 * 60_000;

export type AdoptionRefusal = 'DISABLED' | 'NOT_FOUND' | 'OTHER_SOURCE' | 'OTHER_RUN' | 'GOVERNED_CAPTURE' | 'OTHER_REVISION' |
  'READER_CHANGED' | 'NOT_EXTRACTED' | 'UNSUPPORTED_TRANSPORT' | 'NOT_VALIDATED' | 'TRUNCATED' | 'NOT_LATEST_ATTEMPT' |
  'STALE' | 'ACCESS_NOT_COVERING' | 'REPLAY_DIVERGED' | 'ADMISSION_REFUSED';
export type AdoptedExtraction = AdapterResult & { captureBatchId: string };
export type AdoptionOutcome = { adopted: AdoptedExtraction } | { refused: AdoptionRefusal; detail: string };

/**
 * L'interrupteur d'exploitation : `INGEST_SINGLE_READ=off` (ou `0`, `false`) rétablit la double lecture pour toutes les
 * sources, sans déploiement. Absent : la lecture unique s'applique.
 */
export function singleReadEnabled(raw = process.env.INGEST_SINGLE_READ): boolean {
  return !['off', '0', 'false', 'non'].includes((raw ?? '').trim().toLowerCase());
}

class Refused extends Error {
  constructor(readonly code: AdoptionRefusal, detail: string) { super(detail); }
}

type AdoptionSource = { key: string; revisionId: string; config: Record<string, unknown> };

/**
 * Adopte la capture de qualification `captureBatchId` pour l'ingestion de `source`, ou dit pourquoi elle ne le peut pas.
 * `config` est la configuration effective de la source, celle que la collecte sous décision recevrait.
 * N'écrit que l'adoption et son admission, ensemble, dans une transaction sous le verrou de la source.
 */
export async function adoptQualificationCapture(db: PrismaClient, source: AdoptionSource, kind: AtsType, captureBatchId: string,
  options: { store?: ObjectStore; now?: () => Date; runId?: string | null } = {}): Promise<AdoptionOutcome> {
  const started = Date.now();
  try {
    const adopted = await adopt(db, source, kind, captureBatchId, options);
    await log.info('source.capture_adopted', { sourceKey: source.key, captureBatchId, outputs: adopted.result.jobs.length,
      ageMs: adopted.ageMs, accessDecisionId: adopted.decisionId, durationMs: Date.now() - started });
    return { adopted: adopted.result };
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    await log.info('source.capture_adoption_refused', { sourceKey: source.key, captureBatchId, refusal: error.code, detail: error.message });
    return { refused: error.code, detail: error.message };
  }
}

async function adopt(db: PrismaClient, source: AdoptionSource, kind: AtsType, captureBatchId: string,
  options: { store?: ObjectStore; now?: () => Date; runId?: string | null }) {
  if (!singleReadEnabled()) throw new Refused('DISABLED', 'INGEST_SINGLE_READ désactive la lecture unique');
  const now = options.now ?? (() => new Date());
  const batch = await db.captureBatch.findUnique({ where: { id: captureBatchId }, include: { outcome: true } });
  if (!batch) throw new Refused('NOT_FOUND', 'capture absente');
  if (batch.sourceKey !== source.key || batch.purpose !== 'JOBS' || batch.formatVersion !== 2) throw new Refused('OTHER_SOURCE', 'capture d’une autre source ou d’un autre objet');
  // Le même tour : une passe légère n'adopte jamais une capture du RUN, ni le RUN une capture d'une passe (R-143 §1).
  const runId = options.runId === undefined ? log.runId() ?? null : options.runId;
  if ((batch.runId ?? null) !== runId) throw new Refused('OTHER_RUN', 'capture d’un autre run');
  if (batch.accessDecisionId) throw new Refused('GOVERNED_CAPTURE', 'collecte déjà gouvernée par une décision d’accès');
  const settings = captureConfig(source.config);
  if (batch.sourceRevisionId !== source.revisionId || evidenceHash(settings) !== batch.configHash || batch.sourceKind !== kind)
    throw new Refused('OTHER_REVISION', 'révision, réglages ou lecteur de la source différents');
  if (batch.readerRevision !== captureReaderRevision()) throw new Refused('READER_CHANGED', 'capture lue par une autre révision du lecteur');
  if (batch.outcome?.status !== 'EXTRACTED' || !batch.outcome.manifestHash) throw new Refused('NOT_EXTRACTED', `capture ${batch.outcome?.status ?? 'inachevée'}`);
  if (batch.outcome.transportCoverage !== 'HTTP_ONLY' && batch.outcome.transportCoverage !== 'HTTP_WITH_WAF_BOOTSTRAP')
    throw new Refused('UNSUPPORTED_TRANSPORT', `transport ${batch.outcome.transportCoverage ?? 'inconnu'}`);
  const validation = await db.sourceValidation.findFirst({ where: { sourceRevisionId: source.revisionId }, orderBy: { sequence: 'desc' } });
  const report = validation?.report as { replayExact?: boolean; enumerationClaim?: string; reasons?: Record<string, number> } | undefined;
  if (!validation || validation.captureBatchId !== batch.id || validation.verdict !== 'VALIDATED' || validation.policyVersion !== SOURCE_VALIDATION_POLICY ||
    validation.readerRevision !== batch.readerRevision || report?.replayExact !== true)
    throw new Refused('NOT_VALIDATED', 'la validation courante n’est pas une validation exacte de cette capture');
  if (report.enumerationClaim === 'INCOMPLETE' || Object.hasOwn(report.reasons ?? {}, 'ENUMERATION_INCOMPLETE'))
    throw new Refused('TRUNCATED', `énumération ${report.enumerationClaim ?? 'inconnue'}, lecture coupée ou incomplète`);
  const newer = await db.captureBatch.findFirst({ where: { sourceRevisionId: source.revisionId, purpose: 'JOBS', attemptOrdinal: { gt: batch.attemptOrdinal ?? -1n } }, select: { id: true } });
  if (batch.attemptOrdinal === null || newer) throw new Refused('NOT_LATEST_ATTEMPT', 'une tentative plus récente existe');
  const ageMs = now().getTime() - batch.startedAt.getTime();
  if (!(ageMs <= CAPTURE_ADOPTION_MAX_AGE_MS)) throw new Refused('STALE', `capture âgée de ${Math.round(ageMs / 60_000)} min`);
  let access: Awaited<ReturnType<typeof requireSourceAccess>>;
  try { access = await requireSourceAccess(db, { key: source.key, currentRevisionId: source.revisionId }); }
  catch (error) {
    if (error instanceof SourceAccessGateError) throw new Refused('ACCESS_NOT_COVERING', `aucune décision d’accès courante : ${error.code}`);
    throw error;
  }
  const coverage = await journalCoveredBy(db, source.key, access.document, batch.id, options.store);
  if (!coverage.covered) throw new Refused('ACCESS_NOT_COVERING', coverage.reason);
  // Le rejeu du lecteur lui-même, hors réseau, doit rendre exactement le manifeste scellé : c'est ce qui sera publié.
  let replayed: AdapterResult;
  try {
    replayed = await replayExtraction(db, batch.id, () => fetchAtsJobs(kind, settings), options.store);
    if (!(await compareExtractionResult(db, batch.id, replayed, options.store)).exact) throw new Refused('REPLAY_DIVERGED', 'le rejeu ne rend pas le manifeste scellé');
  } catch (error) {
    if (error instanceof Refused) throw error;
    throw new Refused('REPLAY_DIVERGED', `rejeu impossible : ${error instanceof Error ? error.name : 'erreur'}`);
  }
  const outputs = await db.sourceExtraction.findMany({ where: { batchId: batch.id }, orderBy: { ordinal: 'asc' }, select: { id: true, ordinal: true, externalId: true } });
  if (outputs.length !== replayed.jobs.length || outputs.some((output, index) => output.ordinal !== index || output.externalId !== (replayed.jobs[index].externalId ?? null)))
    throw new Refused('REPLAY_DIVERGED', 'les sorties scellées ne correspondent pas au rejeu');
  try {
    await db.$transaction(async tx => {
      await lockSourceWrites(tx, source.key, true);
      const [registry] = await tx.$queryRaw<{ status: string; currentRevisionId: string }[]>`
        SELECT status, "currentRevisionId" FROM "Source" WHERE key=${source.key} FOR UPDATE`;
      if (registry?.status !== 'ACTIVE' || registry.currentRevisionId !== source.revisionId) throw new Refused('OTHER_REVISION', 'registre modifié pendant l’adoption');
      const current = await requireSourceAccess(tx, { key: source.key, currentRevisionId: source.revisionId });
      if (current.decision.id !== access.decision.id) throw new Refused('ACCESS_NOT_COVERING', 'décision d’accès remplacée pendant l’adoption');
      await tx.sourceCaptureAdoption.create({ data: { batchId: batch.id, sourceValidationId: validation.id, accessDecisionId: access.decision.id,
        policyVersion: CAPTURE_ADOPTION_POLICY } });
      await tx.sourceIngestionAdmission.create({ data: { batchId: batch.id, identityReviewId: null, sourceValidationId: validation.id,
        policyVersion: CAPTURE_ADOPTION_POLICY } });
    }, SOURCE_WRITE_TRANSACTION);
  } catch (error) {
    if (error instanceof Refused) throw error;
    // The SQL guard (or a database without the adoption migration) refuses: the source reads the site as before.
    const text = error instanceof Error ? error.message : String(error);
    if (/Capture adoption requires|Ingestion admission|SourceCaptureAdoption|P2021/.test(text) || (error as { code?: string }).code === 'P2021')
      throw new Refused('ADMISSION_REFUSED', text.replace(/\s+/g, ' ').slice(0, 240));
    throw error;
  }
  const result: AdoptedExtraction = { ...replayed, captureBatchId: batch.id,
    jobs: replayed.jobs.map((job, index) => ({ ...job, captureBatchId: batch.id, captureOutputId: outputs[index].id })) };
  return { result, ageMs, decisionId: access.decision.id };
}
