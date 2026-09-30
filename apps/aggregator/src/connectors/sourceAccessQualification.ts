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
import { matchingAccessScope, SourceAccessGateError, type AccessDocument } from './accessScope.js';
import { deriveAccessBootstrap, type ObservedBootstrapRequest, type ObservedChallenge } from './wafBootstrap.js';
import { describeRequest } from '../capture/context.js';
import { CRAWLER_IDENTITY } from '../lib/crawlerIdentity.js';
import { requireSourceValidation, SourceValidationGateError } from './sourceCertification.js';
import { SourceAdmissionGateError } from './sourceAdmission.js';
import { isDatabaseFailure } from '../lib/ingestionIssue.js';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').replace(/(https?:\/\/[^\s'")?]+)\?[^\s'")]*/g, '$1?…').slice(0, 400);

/**
 * Le journal d'une capture relu pour la dérivation : les requêtes HTTP réellement observées (chaque saut de chaque
 * réponse, avec le type de contenu servi), les défis AWS archivés (`202` + `x-amzn-waf-action: challenge`), et les
 * requêtes du navigateur d'amorçage inscrites (D-483). Toute autre provenance arrête la dérivation.
 */
export async function observedJournal(db: PrismaClient, captureBatchId: string, store?: ObjectStore) {
  const rows = await db.rawCapture.findMany({ where: { batchId: captureBatchId }, orderBy: { sequence: 'asc' } });
  const requests: { method: string; url: URL; contentType: string }[] = [];
  const challenges: ObservedChallenge[] = [];
  const bootstrap: ObservedBootstrapRequest[] = [];
  for (const row of rows) {
    const data = await readRequestData(db, row, store);
    if (data?.origin === 'BROWSER_TRANSPORT' && row.format === 'BROWSER_RESPONSE' && data.hops.length === 1) {
      const hop = data.hops[0];
      bootstrap.push({ sequence: row.sequence, url: new URL(hop.request.url), method: hop.request.method, userAgent: hop.request.userAgent });
      continue;
    }
    if (!data || data.origin !== 'HTTP_TRANSPORT') throw new Error('ACCESS_JOURNAL: requête sans provenance HTTP native');
    for (const hop of data.hops) requests.push({ method: hop.request.method, url: new URL(hop.request.url), contentType: String((hop.responseHeaders as Record<string, string>)['content-type'] ?? '') });
    const last = data.hops.at(-1);
    if (last?.status === 202 && (row.headers as Record<string, unknown>)['x-amzn-waf-action'] === 'challenge') challenges.push({ sequence: row.sequence, url: last.request.url });
  }
  if (!requests.length) throw new Error('ACCESS_JOURNAL: aucune requête observée');
  return { requests, challenges, bootstrap };
}

/** Les requêtes HTTP réellement observées pendant une capture (chaque saut de chaque réponse), avec le type de contenu servi. */
export async function observedRequests(db: PrismaClient, captureBatchId: string, store?: ObjectStore) {
  return (await observedJournal(db, captureBatchId, store)).requests;
}

export async function qualifySourceAccess(db: PrismaClient, c: { key: string; kind: string }, revision: string, jobsCaptureId: string,
  reviewer: string, etapes: Record<string, unknown> = {}, store?: ObjectStore, expectedDecisionId?: string | null) {
  assertPipelineRunning(); assertSourceRunning();
  const journal = await observedJournal(db, jobsCaptureId, store);
  const requests = journal.requests;
  // D-483 : l'amorçage observé, dérivé et borné (source et origine nommées, adresse défiée, hôtes du défi), ou rien.
  const bootstrap = deriveAccessBootstrap(c.key, journal.challenges, journal.bootstrap);
  const origins = [...new Set(requests.map(r => r.url.origin))];
  const robotsCaptureIds: string[] = [];
  for (const origin of origins) {
    const capture = await captureSourceEvidence(db, c.key, { revisionId: revision, purpose: 'SOURCE_ACCESS', url: `${origin}/robots.txt`, deadlineMs: 60_000 }, store) as { captureBatchId: string };
    robotsCaptureIds.push(capture.captureBatchId);
  }
  const { scopes, derivation } = deriveAccessScopeDocument(c.kind, requests);
  const statement = `Périmètre dérivé des ${requests.length} requête(s) HTTP réellement observées, sous l'identité du robot, pendant la collecte de qualification ${jobsCaptureId} : ${derivation.exact} chemin(s) observé(s) déclaré(s) tel(s) quel(s) (EXACT) et ${derivation.prefix} répertoire(s) d'offres observé(s) déclaré(s) par leur préfixe (PREFIX), qui couvre les entrées futures de ce répertoire et rien au-delà${derivation.climbs ? ` ; ${derivation.climbs} remontée(s) d'un répertoire pour tenir dans la liste bornée de 64 périmètres, jamais jusqu'à la racine` : ''}${scopes.some(s => s.query.variable.length) ? ' ; les paramètres variables sont ceux observés avec plusieurs valeurs' : ''}. Méthodes déclarées par périmètre, jamais fusionnées entre un point d'entrée et des pages. Robots archivé pour chaque origine interrogée.${bootstrap ? ` Amorçage du défi AWS WAF (D-483) observé sur ${bootstrap.origin} : ${journal.bootstrap.length} requête(s) du navigateur inscrites au journal, limitées à l'adresse défiée elle-même et aux hôtes du défi ${bootstrap.challengeHosts.join(', ')}, sous l'identité du collecteur ; aucune autre requête du navigateur n'est autorisée.` : ''} Liste : ${scopes.map(s => `${s.methods.join('/')} ${s.origin}${s.path.value}${s.path.kind === 'PREFIX' ? '…' : ''}${Object.keys(s.query.fixed).length ? ' ?' + Object.entries(s.query.fixed).map(([k, v]) => `${k}=${v}`).join('&') : ''}${s.query.variable.length ? ` [variables : ${s.query.variable.join(', ')}]` : ''}`).join(' ; ')}`;
  const document = { sourceKey: c.key, sourceRevisionId: revision, captureBatchId: jobsCaptureId, verdict: 'ALLOWED', robotsCaptureIds, scopes, statement, reviewer, checkedAt: new Date().toISOString(),
    ...(bootstrap ? { bootstraps: [bootstrap] } : {}) };
  etapes.acces = { origins, scopes, robotsCaptureIds, derivation, ...(bootstrap ? { bootstraps: [bootstrap] } : {}) };
  try {
    const decision = await recordSourceAccessDecision(db, document as Parameters<typeof recordSourceAccessDecision>[1], true, store, expectedDecisionId) as { verdict?: string; written?: number; reason?: string };
    etapes.decisionAcces = decision;
    if (decision.verdict === 'ALLOWED' && (decision.written === 1 || (decision as { isLatestDecision?: boolean }).isLatestDecision)) return { allowed: true, reason: null as string | null };
    return { allowed: false, reason: decision.reason ?? JSON.stringify(decision).slice(0, 300) };
  } catch (error) {
    // A database failure is ours, not a refused access: it keeps its own class (INTERNAL/DATABASE_FAILURE).
    // RUN du 01/10/2026 : diptyque-workday, une transaction close à 7 446 ms, était rapportée en
    // `SourceAccessGateError` « Access qualification refused », comme si l'éditeur avait refusé l'accès.
    if (isDatabaseFailure(error)) throw error;
    const reason = message(error);
    // A failed inspection blocks this attempt. It is not an explicit revocation:
    // do not turn a temporary HTTP/parser/scope error into a permanent denial.
    // Existing explicit NOT_AUTHORIZED decisions remain authoritative.
    return { allowed: false, reason };
  }
}

/** Maintain only a missing/stale prerequisite for an ACTIVE source in its normal run.
 * A current grant is kept unless the day's native qualification capture requests something outside
 * its scope; it is then re-derived from that capture. Denials/invalid evidence never trigger a replacement grant.
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
  // A fresh validated capture the grant no longer covers: the new grant is derived from it, without collecting again.
  let outgrownBy: string | null = null;
  try {
    const { decision, document } = assertSourceAccess(source, previous);
    // Access grants live up to 30 days; native qualification lasts 24 hours. A daily run renews
    // the latter and keeps a still-valid grant, unless that fresh capture outgrows its scope.
    try { await requireSourceValidation(db, source.currentRevisionId); }
    catch (error) {
      if (!(error instanceof SourceValidationGateError)) throw error;
      await log.info('source.native_qualification_started', { sourceKey, reason: error.code });
      const validation = await captureSourceForValidation(db, sourceKey, timeoutMs, store);
      if (validation.verdict !== 'VALIDATED') throw new SourceAdmissionGateError('CAPTURE_NOT_VALIDATED', `Native qualification failed: ${validation.verdict}`);
      await log.info('source.native_qualification_completed', { sourceKey, captureBatchId: validation.captureBatchId });
      if (await scopeOutgrown(db, sourceKey, document, validation.captureBatchId, store)) outgrownBy = validation.captureBatchId;
    }
    if (!outgrownBy) return { renewed: false, decisionId: decision.id };
    reason = 'ACCESS_SCOPE_OUTGROWN';
  } catch (error) {
    if (!(error instanceof SourceAccessGateError) || !['ACCESS_STALE', 'ACCESS_MISSING'].includes(error.code)) throw error;
    reason = error.code;
  }
  await log.info('source.access_qualification_started', { sourceKey, reason, previousDecisionId: previous?.id ?? null });
  assertPipelineRunning(); assertSourceRunning();
  let evidenceBatchId = outgrownBy;
  if (!evidenceBatchId) {
    const validation = await captureSourceForValidation(db, sourceKey, timeoutMs, store);
    if (validation.verdict !== 'VALIDATED')
      throw new SourceAdmissionGateError('CAPTURE_NOT_VALIDATED', `Access qualification requires validated native evidence: ${validation.verdict}`);
    evidenceBatchId = validation.captureBatchId;
  }
  const qualification = await qualifySourceAccess(db, source, source.currentRevisionId, evidenceBatchId,
    `normal-worker:${captureReaderRevision()}`, {}, store, previous?.id ?? null);
  if (!qualification.allowed) throw new SourceAccessGateError('ACCESS_INVALID', `Access qualification refused: ${qualification.reason}`);
  assertPipelineRunning(); assertSourceRunning();
  // Re-read the real grant; a returned boolean cannot replace admission.
  const { decision } = await requireSourceAccess(db, source);
  await log.info('source.access_qualification_completed', { sourceKey, reason, decisionId: decision.id,
    verdict: decision.verdict, captureBatchId: evidenceBatchId });
  return { renewed: true, decisionId: decision.id };
}

/**
 * La capture native du jour sort-elle du périmètre de l'autorisation en vigueur ?
 *
 * Un périmètre est dérivé des adresses observées le jour où l'autorisation est accordée, et l'autorisation vit
 * 30 jours. Une offre publiée ensuite hors d'un répertoire déclaré en préfixe (une offre Workday dans un lieu
 * nouveau, une page de détail qu'aucune offre n'exigeait ce jour-là) sort du périmètre, et sa lecture arrête la
 * collecte entière : 14 sources le 29/09/2026, premier RUN sans déploiement (un déploiement change la révision du
 * lecteur et requalifiait tout, ce qui masquait le défaut). La capture de qualification précède la collecte de
 * quelques secondes et lit les mêmes adresses : si l'une sort du périmètre, l'autorisation est redérivée d'elle.
 *
 * Une capture illisible pour ce contrôle ne change rien au comportement antérieur : l'autorisation est gardée, et
 * l'échec est journalisé plutôt que d'arrêter une source que rien ne bloquait. Une redérivation qui échoue ensuite
 * (budget de 64 périmètres dépassé, robots refusé) arrête la source, comme l'aurait fait sa collecte hors périmètre.
 *
 * Coût : ce contrôle relit à chaque RUN, pour chaque source requalifiée, les requêtes de sa capture du jour (lecture
 * en base, aucune requête vers l'éditeur) ; de quelques dizaines à quelques milliers de lignes selon la source.
 */
async function scopeOutgrown(db: PrismaClient, sourceKey: string, document: Readonly<AccessDocument>, captureBatchId: string, store?: ObjectStore) {
  let journal: Awaited<ReturnType<typeof observedJournal>>;
  try { journal = await observedJournal(db, captureBatchId, store); }
  catch (error) {
    await log.warn('source.access_scope_check_failed', { sourceKey, captureBatchId, error: message(error) });
    return false;
  }
  if (bootstrapOutgrown(sourceKey, document, journal)) {
    await log.info('source.access_scope_outgrown', { sourceKey, captureBatchId, outside: journal.bootstrap.length, example: 'WAF_BOOTSTRAP' });
    return true;
  }
  const outside = journal.requests.filter(request => {
    try {
      matchingAccessScope(document.scopes, describeRequest({ url: request.url.toString(), method: request.method,
        headers: { 'user-agent': CRAWLER_IDENTITY }, format: 'HTTP_RESPONSE' }));
      return false;
    } catch (error) {
      if (error instanceof SourceAccessGateError) return true;
      throw error;
    }
  });
  if (!outside.length) return false;
  await log.info('source.access_scope_outgrown', { sourceKey, captureBatchId, outside: outside.length,
    example: `${outside[0].method} ${outside[0].url.origin}${outside[0].url.pathname}` });
  return true;
}

/**
 * D-483 : la capture du jour a-t-elle dû amorcer un défi que l'autorisation en vigueur ne déclare pas (aucun
 * amorçage, autre origine, hôte du défi nouveau) ? L'autorisation est alors redérivée d'elle, comme pour un chemin.
 * Un amorçage que la dérivation refuserait (source non nommée, requête hors bornes) ne déclenche rien ici : la
 * collecte suivante échouera à l'amorçage, sur un motif nommé.
 */
function bootstrapOutgrown(sourceKey: string, document: Readonly<AccessDocument>, journal: Awaited<ReturnType<typeof observedJournal>>): boolean {
  let observed: ReturnType<typeof deriveAccessBootstrap>;
  try { observed = deriveAccessBootstrap(sourceKey, journal.challenges, journal.bootstrap); }
  catch { return false; }
  if (!observed) return false;
  const current = document.bootstraps?.find(item => item.origin === observed.origin);
  return !current || observed.challengeHosts.some(host => !current.challengeHosts.includes(host));
}
