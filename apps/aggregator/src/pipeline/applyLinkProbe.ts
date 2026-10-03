/**
 * LA SONDE DES LIENS « POSTULER » — R-143 §2 (D-513, 02/10/2026).
 *
 * Une offre encore servie que sa source n'a pas revue depuis plus de 24 h est lue à son adresse de candidature. Une page
 * réellement morte retire la représentation de l'expérience (retenue APPLY_LINK_DEAD, motif tracé), sans rien fermer ;
 * la retenue s'efface dès que la source la revoit. Une erreur technique ne retire JAMAIS rien.
 *
 * POURQUOI UN TÉMOIN VIVANT. La sonde du 02/10/2026 au matin a classé 12 pages « mortes » ; 6 ne l'étaient pas : leur
 * texte d'erreur était dans le code de la page (chaînes de traduction d'une application JavaScript), pas affiché. La
 * relecture de 36 pages du même jour (`audits/2026-10-02/r143-disponibilite/`) en ajoute trois autres : Ulta répond 404
 * à toute fiche, ouverte ou non, URBN (iCIMS) répond 410 à une offre revue la veille, et le portail Sephora affiche
 * « Sorry, this position has been filled » sur une offre que sa source liste encore. Aucune règle de texte ne distingue
 * ces cas d'une vraie fin. D'où deux protections :
 *   1. on ne lit que le texte AFFICHÉ (scripts, styles, gabarits, commentaires et SVG retirés), et une page dont le texte
 *      affiché est trop court pour juger (une coquille d'application) n'est pas concluante ;
 *   2. un verdict « morte » ne tient que si, dans la même passe, une autre offre de la même source sur le même hôte, la
 *      plus récemment revue, est lue OUVERTE. Sinon, le signal de mort n'est pas propre à l'offre : non concluant.
 *
 * POLITESSE ET PÉRIMÈTRE : au plus 2 requêtes par seconde, redirections comprises, 10 s par lecture, l'identité du
 * collecteur, et chaque requête (redirections comprises) dans le périmètre d'accès revu de la source
 * (`matchingAccessScope`), comme une collecte. Une adresse hors périmètre n'est pas lue.
 */
import type { PrismaClient } from '@prisma/client';
import { confirmedSourceWhere } from '@catwalks/db/availability';
import { assertBusinessUrl } from '@catwalks/runtime';
import { assertPublicUrl, isPublicHttpUrl } from '../lib/ssrf.js';
import { publicDispatcher } from '../lib/publicTransport.js';
import { CRAWLER_IDENTITY } from '../lib/crawlerIdentity.js';
import { describeRequest } from '../capture/context.js';
import { matchingAccessScope } from '../connectors/accessScope.js';
import { requireSourceAccess } from '../connectors/sourceAccess.js';
import { assertPipelineRunning } from '../lib/pipelinePause.js';

export const PROBE_READER = 'r143-apply-link/1';
export const PROBE_MAX_REQUESTS_PER_SECOND = 2;
export const PROBE_TIMEOUT_MS = 10_000;
/** Une offre revue depuis moins longtemps n'est pas sondée : sa source vient de la lister. */
export const PROBE_UNSEEN_HOURS = 24;
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 3_000_000;
/** Sous ce nombre de caractères affichés, la page est une coquille : rien ne s'y lit. */
export const MIN_VISIBLE_TEXT = 200;

export type ProbeVerdict = 'OPEN' | 'DEAD' | 'TECHNICAL' | 'NON_CONCLUSIVE';
export type ProbeReading = { verdict: ProbeVerdict; reason: string; status?: number; finalUrl?: string; matched?: string };

/**
 * Les mentions d'une offre terminée, telles que les pages les affichent, dans les langues servies. Comparées au texte
 * affiché, en minuscules, apostrophes typographiques ramenées à `'`. Jamais « not found » ou « introuvable » seuls :
 * un pied de page ou un menu les porte sur une page vivante.
 */
export const DEAD_PHRASES: readonly string[] = [
  'no longer available', 'no longer accepting applications', 'job has expired', 'job posting has expired',
  'this job is no longer', 'position has been filled', 'position is no longer', 'this job has been closed',
  'job is closed', 'posting has been closed',
  "n'est plus disponible", "n'est plus en ligne", 'offre a expiré', 'offre est expirée', 'offre expirée',
  'offre a été pourvue', "offre n'existe plus", "annonce n'est plus",
  'nicht mehr verfügbar', 'bereits besetzt', 'stellenanzeige ist abgelaufen', 'nicht mehr aktiv',
  'ya no está disponible', 'oferta ha caducado', 'oferta ha expirado',
  'non è più disponibile', 'annuncio è scaduto', 'offerta è scaduta',
  'não está mais disponível', 'já não está disponível', 'vaga foi encerrada',
  'niet meer beschikbaar', 'vacature is verlopen',
  'inte längre tillgänglig', 'ikke længere tilgængelig', 'ikke lenger tilgjengelig',
];

/** Le texte qu'un candidat voit : ni scripts, ni styles, ni gabarits, ni commentaires, ni SVG, ni balises. */
export function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&#39;|&#x27;|&apos;|&rsquo;|&#8217;/gi, "'")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ').trim();
}

/** Le verdict d'UNE lecture, sans témoin. Pure. */
export function classifyApplyPage(input: { status: number; finalUrl: string; contentType: string | null; body: string }): ProbeReading {
  const { status, finalUrl } = input;
  if (status === 404 || status === 410) return { verdict: 'DEAD', reason: `HTTP_${status}`, status, finalUrl };
  if (status < 200 || status >= 300) return { verdict: 'TECHNICAL', reason: `HTTP_${status}`, status, finalUrl };
  if (input.contentType && !/html/i.test(input.contentType)) return { verdict: 'NON_CONCLUSIVE', reason: 'NOT_HTML', status, finalUrl };
  const text = visibleText(input.body);
  if (text.length < MIN_VISIBLE_TEXT) return { verdict: 'NON_CONCLUSIVE', reason: 'NO_VISIBLE_CONTENT', status, finalUrl };
  const lower = text.toLowerCase();
  const matched = DEAD_PHRASES.find(phrase => lower.includes(phrase));
  return matched ? { verdict: 'DEAD', reason: 'DEAD_TEXT_DISPLAYED', status, finalUrl, matched } : { verdict: 'OPEN', reason: 'OPEN', status, finalUrl };
}

/** Un verdict « morte » ne tient qu'avec un témoin de la même source et du même hôte lu ouvert. Pure. */
export function calibrate(reading: ProbeReading, witness: ProbeReading | null): ProbeReading {
  if (reading.verdict !== 'DEAD') return reading;
  if (!witness) return { ...reading, verdict: 'NON_CONCLUSIVE', reason: `NO_WITNESS:${reading.reason}` };
  if (witness.verdict !== 'OPEN') return { ...reading, verdict: 'NON_CONCLUSIVE', reason: `WITNESS_${witness.verdict}:${reading.reason}` };
  return reading;
}

/** Au plus `perSecond` départs de requête par seconde, pour toute la passe. */
export function rateLimiter(perSecond: number, now = () => Date.now(), sleep = (ms: number) => new Promise(r => setTimeout(r, ms))) {
  const spacing = 1000 / perSecond;
  let next = 0;
  return async () => {
    const at = Math.max(now(), next);
    next = at + spacing;
    const wait = at - now();
    if (wait > 0) await sleep(wait);
  };
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Scopes = Parameters<typeof matchingAccessScope>[0];

/** One bounded read: manual redirects, every hop public, in scope and paced. Never throws. */
export async function readApplyPage(url: string, scopes: Scopes, acquire: () => Promise<void>,
  // Node's fetch and installed undici share the dispatcher protocol, not their TypeScript declarations (as in http.ts).
  fetcher: Fetcher = (u, i) => fetch(u, Object.assign({ ...i }, { dispatcher: publicDispatcher() }))): Promise<ProbeReading> {
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const headers = { 'user-agent': CRAWLER_IDENTITY, accept: 'text/html,application/xhtml+xml', 'accept-language': '*' };
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      try {
        assertPublicUrl(current);
        assertBusinessUrl(current);
        matchingAccessScope(scopes, describeRequest({ url: current, method: 'GET', headers, format: 'HTTP_RESPONSE' }));
      } catch {
        return { verdict: 'NON_CONCLUSIVE', reason: 'OUTSIDE_ACCESS_SCOPE', finalUrl: current };
      }
      await acquire();
      const response = await fetcher(current, { method: 'GET', headers, redirect: 'manual', signal });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        await response.body?.cancel().catch(() => undefined);
        const next = new URL(response.headers.get('location')!, current).toString();
        if (!isPublicHttpUrl(next)) return { verdict: 'TECHNICAL', reason: 'REDIRECT_REFUSED', status: response.status, finalUrl: next };
        current = next;
        continue;
      }
      const body = await boundedText(response);
      return classifyApplyPage({ status: response.status, finalUrl: current, contentType: response.headers.get('content-type'), body });
    }
    return { verdict: 'TECHNICAL', reason: 'TOO_MANY_REDIRECTS', finalUrl: current };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    return { verdict: 'TECHNICAL', reason: name === 'TimeoutError' || signal.aborted ? 'TIMEOUT' : `TRANSPORT:${name}`, finalUrl: current };
  }
}

async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.byteLength;
      if (size >= MAX_BODY_BYTES) break;
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES).toString('utf8');
}

export type ProbeTarget = { jobSourceId: string; jobId: string; sourceKey: string; url: string; lastSeenAt: Date };
export type ProbeResult = ProbeTarget & { reading: ProbeReading; raw: ProbeReading };
export type ProbeRun = { probed: number; dead: number; held: number; byVerdict: Record<ProbeVerdict, number>; results: ProbeResult[]; dryRun: boolean };

/** The reviewed public HTTP scope of the source's current access decision; null when it has none in force. */
export async function reviewedScopes(prisma: PrismaClient, sourceKey: string): Promise<Scopes | null> {
  const source = await prisma.source.findUnique({ where: { key: sourceKey }, select: { key: true, currentRevisionId: true } });
  const access = source ? await requireSourceAccess(prisma, source).catch(() => null) : null;
  return access ? access.document.scopes : null;
}

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return ''; } };

/**
 * Les représentations confirmées des offres servies, non revues depuis `PROBE_UNSEEN_HOURS`, les plus anciennes d'abord,
 * une adresse par représentation.
 */
export async function probeTargets(prisma: PrismaClient, limit: number, at = new Date()): Promise<ProbeTarget[]> {
  const rows = await prisma.jobSource.findMany({
    where: { AND: [confirmedSourceWhere(at), { lastSeenAt: { lt: new Date(at.getTime() - PROBE_UNSEEN_HOURS * 3_600_000) } },
      { job: { isActive: true, mergedIntoId: null } }] },
    select: { id: true, jobId: true, sourceKey: true, url: true, lastSeenAt: true },
    orderBy: [{ lastSeenAt: 'asc' }, { id: 'asc' }], take: limit,
  });
  return rows.flatMap(row => row.jobId ? [{ jobSourceId: row.id, jobId: row.jobId, sourceKey: row.sourceKey, url: row.url, lastSeenAt: row.lastSeenAt }] : []);
}

/** The witness: the most recently seen confirmed representation of the same source on the same host. */
async function witnessFor(prisma: PrismaClient, target: ProbeTarget, at: Date) {
  const host = hostOf(target.url);
  const rows = await prisma.jobSource.findMany({
    where: { AND: [confirmedSourceWhere(at), { sourceKey: target.sourceKey, id: { not: target.jobSourceId },
      url: { contains: host }, lastSeenAt: { gt: target.lastSeenAt } }] },
    select: { url: true }, orderBy: { lastSeenAt: 'desc' }, take: 5,
  });
  return rows.map(row => row.url).find(url => hostOf(url) === host) ?? null;
}

/**
 * Une passe bornée. `dryRun` lit les pages sans rien écrire. Chaque retenue écrite porte la lecture et son témoin.
 * Ne ferme jamais une offre : la retenue la sort de l'expérience, la source qui la revoit l'y remet.
 */
export async function runApplyLinkProbe(prisma: PrismaClient, options: { limit?: number; dryRun?: boolean; targets?: ProbeTarget[];
  fetcher?: Fetcher; deadline?: number; accessScopes?: (sourceKey: string) => Promise<Scopes | null>; runId?: string | null } = {}): Promise<ProbeRun> {
  const dryRun = options.dryRun === true;
  const at = new Date();
  const targets = options.targets ?? await probeTargets(prisma, options.limit ?? 300, at);
  const acquire = rateLimiter(PROBE_MAX_REQUESTS_PER_SECOND);
  const scopesBy = new Map<string, Scopes | null>();
  const witnessBy = new Map<string, ProbeReading | null>();
  const results: ProbeResult[] = [];
  const byVerdict: Record<ProbeVerdict, number> = { OPEN: 0, DEAD: 0, TECHNICAL: 0, NON_CONCLUSIVE: 0 };
  let held = 0;
  for (const target of targets) {
    if (options.deadline && Date.now() > options.deadline) break;
    if (!dryRun) assertPipelineRunning();
    if (!scopesBy.has(target.sourceKey)) scopesBy.set(target.sourceKey, await (options.accessScopes ?? (key => reviewedScopes(prisma, key)))(target.sourceKey));
    const scopes = scopesBy.get(target.sourceKey);
    const raw: ProbeReading = scopes ? await readApplyPage(target.url, scopes, acquire, options.fetcher)
      : { verdict: 'NON_CONCLUSIVE', reason: 'NO_ACCESS_DECISION' };
    let reading = raw;
    if (raw.verdict === 'DEAD') {
      const key = `${target.sourceKey} ${hostOf(target.url)}`;
      if (!witnessBy.has(key)) {
        const url = await witnessFor(prisma, target, at);
        witnessBy.set(key, url && scopes ? await readApplyPage(url, scopes, acquire, options.fetcher) : null);
      }
      reading = calibrate(raw, witnessBy.get(key)!);
    }
    byVerdict[reading.verdict]++;
    results.push({ ...target, reading, raw });
    if (reading.verdict !== 'DEAD' || dryRun) continue;
    const probedAt = new Date();
    const key = `${target.sourceKey} ${hostOf(target.url)}`;
    held += (await prisma.jobSource.updateMany({
      // Only if its source has still not seen it: a re-observation during the pass wins.
      where: { id: target.jobSourceId, isActive: true, lastSeenAt: { lte: target.lastSeenAt } },
      data: { availabilityHold: 'APPLY_LINK_DEAD', availabilityHoldAt: probedAt,
        availabilityEvidence: { reader: PROBE_READER, runId: options.runId ?? null, url: target.url, probedAt: probedAt.toISOString(), ...reading,
          witness: witnessBy.get(key) ?? null } },
    })).count;
  }
  return { probed: results.length, dead: byVerdict.DEAD, held, byVerdict, results, dryRun };
}
