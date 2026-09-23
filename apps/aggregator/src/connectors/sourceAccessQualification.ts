/** Shared Golden Path access qualification; normal ingestion uses the same evidence and writer. */
import type { PrismaClient } from '@prisma/client';
import type { ObjectStore } from '../retention/objectStore.js';
import { captureSourceEvidence } from '../capture/sourceEvidence.js';
import { readRequestData } from '../capture/requestDataRead.js';
import { deriveAccessScopeDocument } from './accessScopeDerivation.js';
import { recordSourceAccessDecision, assertSourceAccess, requireSourceAccess } from './sourceAccess.js';
import { assertPipelineRunning } from '../lib/pipelinePause.js';
import { assertSourceRunning } from '../lib/sourceBudget.js';
import { log } from '../observability/logger.js';
import { captureReaderRevision } from '../capture/revision.js';
import { captureSourceForValidation } from './sourceValidation.js';
import { SourceAccessGateError } from './accessScope.js';
import { requireSourceValidation, SourceValidationGateError } from './sourceCertification.js';
import { SourceAdmissionGateError } from './sourceAdmission.js';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').replace(/(https?:\/\/[^\s'")?]+)\?[^\s'")]*/g, '$1?…').slice(0, 400);

/** Les requêtes HTTP réellement observées pendant une capture (chaque saut de chaque réponse), avec le type de contenu servi. */
export async function observedRequests(db: PrismaClient, captureBatchId: string, store?: ObjectStore) {
  const rows = await db.rawCapture.findMany({ where: { batchId: captureBatchId }, orderBy: { sequence: 'asc' } });
  const requests: { method: string; url: URL; contentType: string }[] = [];
  for (const row of rows) {
    const data = await readRequestData(db, row, store);
    if (!data || data.origin !== 'HTTP_TRANSPORT') throw new Error('ACCESS_JOURNAL: requête sans provenance HTTP native');
    for (const hop of data.hops) requests.push({ method: hop.request.method, url: new URL(hop.request.url), contentType: String((hop.responseHeaders as Record<string, string>)['content-type'] ?? '') });
  }
  if (!requests.length) throw new Error('ACCESS_JOURNAL: aucune requête observée');
  return requests;
}

export async function qualifySourceAccess(db: PrismaClient, c: { key: string; kind: string }, revision: string, jobsCaptureId: string,
  reviewer: string, etapes: Record<string, unknown> = {}, store?: ObjectStore, expectedDecisionId?: string | null) {
  assertPipelineRunning(); assertSourceRunning();
  const requests = await observedRequests(db, jobsCaptureId, store);
  const origins = [...new Set(requests.map(r => r.url.origin))];
  const robotsCaptureIds: string[] = [];
  for (const origin of origins) {
    const capture = await captureSourceEvidence(db, c.key, { revisionId: revision, purpose: 'SOURCE_ACCESS', url: `${origin}/robots.txt`, deadlineMs: 60_000 }, store) as { captureBatchId: string };
    robotsCaptureIds.push(capture.captureBatchId);
  }
  const { scopes, derivation } = deriveAccessScopeDocument(c.kind, requests);
  const statement = `Périmètre dérivé des ${requests.length} requête(s) HTTP réellement observées, sous l'identité du robot, pendant la collecte de qualification ${jobsCaptureId} : ${derivation.exact} chemin(s) observé(s) déclaré(s) tel(s) quel(s) (EXACT) et ${derivation.prefix} répertoire(s) d'offres observé(s) déclaré(s) par leur préfixe (PREFIX), qui couvre les entrées futures de ce répertoire et rien au-delà${derivation.climbs ? ` ; ${derivation.climbs} remontée(s) d'un répertoire pour tenir dans la liste bornée de 64 périmètres, jamais jusqu'à la racine` : ''}${scopes.some(s => s.query.variable.length) ? ' ; les paramètres variables sont ceux observés avec plusieurs valeurs' : ''}. Méthodes déclarées par périmètre, jamais fusionnées entre un point d'entrée et des pages. Robots archivé pour chaque origine interrogée. Liste : ${scopes.map(s => `${s.methods.join('/')} ${s.origin}${s.path.value}${s.path.kind === 'PREFIX' ? '…' : ''}${Object.keys(s.query.fixed).length ? ' ?' + Object.entries(s.query.fixed).map(([k, v]) => `${k}=${v}`).join('&') : ''}${s.query.variable.length ? ` [variables : ${s.query.variable.join(', ')}]` : ''}`).join(' ; ')}`;
  const document = { sourceKey: c.key, sourceRevisionId: revision, captureBatchId: jobsCaptureId, verdict: 'ALLOWED', robotsCaptureIds, scopes, statement, reviewer, checkedAt: new Date().toISOString() };
  etapes.acces = { origins, scopes, robotsCaptureIds, derivation };
  try {
    const decision = await recordSourceAccessDecision(db, document as Parameters<typeof recordSourceAccessDecision>[1], true, store, expectedDecisionId) as { verdict?: string; written?: number; reason?: string };
    etapes.decisionAcces = decision;
    if (decision.verdict === 'ALLOWED' && (decision.written === 1 || (decision as { isLatestDecision?: boolean }).isLatestDecision)) return { allowed: true, reason: null as string | null };
    return { allowed: false, reason: decision.reason ?? JSON.stringify(decision).slice(0, 300) };
  } catch (error) {
    const reason = message(error);
    // Un refus robots ou un périmètre non couvert devient une décision NOT_AUTHORIZED explicite : rien ne sera collecté.
    if (/not covered|DISALLOWED|robots/i.test(reason)) {
      const denial = { sourceKey: c.key, sourceRevisionId: revision, captureBatchId: null, verdict: 'NOT_AUTHORIZED', robotsCaptureIds: [], scopes: [],
        statement: `Accès refusé lors de la qualification : ${reason}`, reviewer, checkedAt: new Date().toISOString() };
      try { etapes.decisionAcces = await recordSourceAccessDecision(db, denial as Parameters<typeof recordSourceAccessDecision>[1], true, store, expectedDecisionId); } catch (e) { etapes.decisionAccesErreur = message(e); }
    }
    return { allowed: false, reason };
  }
}

/** Maintain only a missing/stale prerequisite for an ACTIVE source in its normal run.
 * A current grant is untouched; denials/invalid evidence never trigger a replacement grant.
 * Qualification captures are evidence only. The subsequent normal ingestion still has to
 * obtain its own admission and pass every existing publication check. */
export async function maintainSourceAccess(db: PrismaClient, sourceKey: string, timeoutMs: number, store?: ObjectStore) {
  assertPipelineRunning(); assertSourceRunning();
  const source = await db.source.findUniqueOrThrow({ where: { key: sourceKey },
    select: { key: true, kind: true, status: true, currentRevisionId: true } });
  if (source.status !== 'ACTIVE') throw new SourceAdmissionGateError('ADMISSION_MISSING', 'Automatic qualification requires an ACTIVE source');
  const previous = await db.sourceAccessDecision.findFirst({ where: { sourceKey }, orderBy: { sequence: 'desc' } });
  if (previous && previous.verdict !== 'ALLOWED')
    throw new SourceAccessGateError('ACCESS_DENIED', 'Automatic qualification cannot replace an explicit denial');
  let reason: string;
  try {
    const { decision } = assertSourceAccess(source, previous);
    // Access grants live up to 30 days; native qualification lasts 24 hours.
    // A daily run must renew the latter without replacing a still-valid grant.
    try { await requireSourceValidation(db, source.currentRevisionId); }
    catch (error) {
      if (!(error instanceof SourceValidationGateError)) throw error;
      await log.info('source.native_qualification_started', { sourceKey, reason: error.code });
      const validation = await captureSourceForValidation(db, sourceKey, timeoutMs, store);
      if (validation.verdict !== 'VALIDATED') throw new SourceAdmissionGateError('CAPTURE_NOT_VALIDATED', `Native qualification failed: ${validation.verdict}`);
      await log.info('source.native_qualification_completed', { sourceKey, captureBatchId: validation.captureBatchId });
    }
    return { renewed: false, decisionId: decision.id };
  } catch (error) {
    if (!(error instanceof SourceAccessGateError) || !['ACCESS_STALE', 'ACCESS_MISSING'].includes(error.code)) throw error;
    reason = error.code;
  }
  await log.info('source.access_qualification_started', { sourceKey, reason, previousDecisionId: previous?.id ?? null });
  assertPipelineRunning(); assertSourceRunning();
  const validation = await captureSourceForValidation(db, sourceKey, timeoutMs, store);
  if (validation.verdict !== 'VALIDATED')
    throw new SourceAdmissionGateError('CAPTURE_NOT_VALIDATED', `Access qualification requires validated native evidence: ${validation.verdict}`);
  const qualification = await qualifySourceAccess(db, source, source.currentRevisionId, validation.captureBatchId,
    `normal-worker:${captureReaderRevision()}`, {}, store, previous?.id ?? null);
  if (!qualification.allowed) throw new SourceAccessGateError('ACCESS_INVALID', `Access qualification refused: ${qualification.reason}`);
  assertPipelineRunning(); assertSourceRunning();
  // Re-read the real grant; a returned boolean cannot replace admission.
  const { decision } = await requireSourceAccess(db, source);
  await log.info('source.access_qualification_completed', { sourceKey, reason, decisionId: decision.id,
    verdict: decision.verdict, captureBatchId: validation.captureBatchId });
  return { renewed: true, decisionId: decision.id };
}
