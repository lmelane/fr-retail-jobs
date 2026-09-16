/**
 * Campagne de qualification par vague (lot F3). Pour chaque candidat d'un export privé du registre
 * (clé, Maison, famille, configuration, domaine carrière, palier, domaine officiel de la Maison), le lanceur
 * rejoue les étapes maintenues de `source-onboard` avec les mêmes fonctions, séquentiellement, et rend un
 * VERDICT PROUVÉ par source :
 *
 *   QUALIFIEE              identité vérifiée (lien exact de la page officielle vers le portail), collecte native
 *                          validée hors réseau, accès ALLOWED sur les requêtes réellement observées, source ACTIVE
 *   REFUSEE                robots ou périmètre : décision NOT_AUTHORIZED enregistrée, rien ne sera collecté
 *   INACCESSIBLE           le portail ou la page officielle ne répond pas (HTTP, délai, défi anti-robot)
 *   RETIREE                source RETIRED dans le registre, non ressuscitée
 *   BLOCAGE_EXTERNE        conflit d'enregistrement ou contrat du portail indisponible pour cette famille
 *   IDENTITE_NON_PROUVEE   aucune page du domaine officiel ne lie exactement le portail : lacune de preuve à instruire
 *   DOMAINE_OFFICIEL_MANQUANT  la Maison n'a pas de domaine officiel résolu : rien à inspecter
 *   COLLECTE_NON_VALIDEE   l'adaptateur ou la validation native refuse : défaut de notre contrat, à développer
 *   HORS_PARCOURS          palier ou famille hors du parcours maintenu (éditeurs, cabinets)
 *
 * Le lanceur n'invente aucune décision : les énoncés sont factuels (page, lien, requêtes, robots), le réviseur
 * est nommé, et chaque décision reste liée à la révision de la source et au lecteur courant. Il est rejouable et
 * reprend où il s'est arrêté (`--resume` lit les verdicts déjà rendus). Il s'exécute dans l'environnement voulu
 * (par exemple `npm run stack:exec -- node --import tsx apps/aggregator/scripts/ops/source-campaign.mts …`).
 *
 * usage: source-campaign.mts --candidates=<export.json> --out-dir=<dossier privé> [--keys=k1,k2] [--limit=n]
 *        [--ingest] [--resume] [--deadline-ms=120000]
 */
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadBuffer } from 'cheerio';
import { parse as parseDomain } from 'tldts';
import { parseSourceCandidate, registerSourceCandidate } from '../../src/connectors/sourceCandidate.js';
import { captureSourceEvidence, readSourceEvidence } from '../../src/capture/sourceEvidence.js';
import { inspectSourceRelation } from '../../src/connectors/sourceRelation.js';
import { recordSourceIdentityReview } from '../../src/connectors/sourceIdentity.js';
import { captureSourceForValidation } from '../../src/connectors/sourceValidation.js';
import { recordSourceAccessDecision } from '../../src/connectors/sourceAccess.js';
import { promoteSource } from '../../src/connectors/sourceStore.js';
import { sourceStatus } from '../../src/onboarding/status.js';
import { readRequestData } from '../../src/capture/requestDataRead.js';
import { objectStoreConfigured, objectStoreFromEnv } from '../../src/retention/objectStore.js';
import { readRefreshPlan } from '../../src/pipeline/refresh.js';
import { closeBrowser } from '../../src/lib/browser.js';
import { auditUrl } from '../../src/capture/context.js';

type Candidat = { key: string; maison: string; kind: string; config: Record<string, unknown>; careersDomain: string; tier: string;
  jobUrlPattern?: string | null; domain?: string | null; domainSource?: string | null; lastRunJobs?: number | null };
type Verdict = { key: string; kind: string; maison: string; verdict: string; raisons: string[]; revision?: string; etapes: Record<string, unknown>;
  offres?: number; ingestion?: Record<string, unknown>; absence?: Record<string, unknown>; dureeMs: number; evalueLe: string };

const REVIEWER = 'claude-fable-5.1 (campagne F3, pour Loïc)';
const SURFACE_BY_KIND: Record<string, string> = {
  teamtailor: 'PUBLIC_ATS_JOB_API', ashby: 'PUBLIC_ATS_JOB_API', recruitee: 'PUBLIC_ATS_JOB_API', workday: 'PUBLIC_ATS_JOB_API',
  greenhouse: 'PUBLIC_ATS_JOB_API', lever: 'PUBLIC_ATS_JOB_API', personio: 'PUBLIC_XML_OR_RSS', 'smartrecruiters-whitelabel': 'PUBLIC_ATS_JOB_API',
  successfactors: 'PUBLIC_ATS_JOB_API', digitalrecruiters: 'PUBLIC_ATS_JOB_API', workable: 'PUBLIC_ATS_JOB_API', talentrecruiter: 'PUBLIC_ATS_JOB_API',
};
const CAREER_LINK = /carri|career|recrut|emploi|\bjobs?\b|talent|rejoin|join|work-with|travailler|offres|opportunit/i;
const nowMs = () => new Date().toISOString();
const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 400);
const inaccessible = (text: string) => /HTTP (?:4\d\d|5\d\d)|timeout|délai|challenge|défi|ECONN|ENOTFOUND|certificate|TLS|socket/i.test(text);

const candidatesFile = arg('candidates'), outDir = arg('out-dir');
if (!candidatesFile || !outDir) throw new Error('usage: source-campaign.mts --candidates=<export.json> --out-dir=<dossier privé> [--keys=] [--limit=] [--ingest] [--resume]');
mkdirSync(outDir, { recursive: true, mode: 0o700 });
const verdictsFile = path.join(outDir, 'verdicts.json');
const deadlineMs = Number(arg('deadline-ms') ?? 120_000);
let candidats = JSON.parse(readFileSync(candidatesFile, 'utf8')) as Candidat[];
if (arg('keys')) { const keys = new Set(arg('keys')!.split(',')); candidats = candidats.filter(c => keys.has(c.key)); }
const previous: Verdict[] = flag('resume') && existsSync(verdictsFile) ? JSON.parse(readFileSync(verdictsFile, 'utf8')) : [];
const done = new Set(previous.map(v => v.key));
if (flag('resume')) candidats = candidats.filter(c => !done.has(c.key));
if (arg('limit')) candidats = candidats.slice(0, Number(arg('limit')));

const db = new PrismaClient({ errorFormat: 'minimal', log: [] });
const store = objectStoreConfigured() ? objectStoreFromEnv() : undefined;
const verdicts: Verdict[] = [...previous];
const save = () => { writeFileSync(verdictsFile, JSON.stringify(verdicts, null, 1) + '\n', { mode: 0o600 }); };

/** Les liens « carrières » de la page archivée, sur le domaine officiel seulement, dans l'ordre du document. */
async function careerLinks(captureBatchId: string, officialDomain: string): Promise<string[]> {
  const evidence = await readSourceEvidence(db, captureBatchId, store);
  const $ = loadBuffer(evidence.body); $('script,style,template,noscript').remove();
  const found: string[] = [];
  $('a[href]').each((_, node) => {
    const href = $(node).attr('href')!; let url: URL; try { url = new URL(href, evidence.finalUrl); } catch { return; }
    const label = `${$(node).text()} ${href}`;
    if (url.protocol !== 'https:' || !(url.hostname === officialDomain || url.hostname.endsWith(`.${officialDomain}`)) || !CAREER_LINK.test(label)) return;
    url.hash = ''; const s = url.toString(); if (!found.includes(s) && found.length < 4) found.push(s);
  });
  return found;
}

async function identite(c: Candidat, revision: string, officialDomain: string, etapes: Record<string, unknown>) {
  const tried: Record<string, unknown>[] = [];
  const pages = [`https://${c.domain}/`, ...(c.domain!.startsWith('www.') ? [] : [`https://www.${c.domain}/`])];
  const seen = new Set<string>();
  for (let i = 0; i < pages.length && i < 6; i++) {
    const url = pages[i]; if (seen.has(url)) continue; seen.add(url);
    let capture: { captureBatchId: string; lastStatus: number | null };
    try { capture = await captureSourceEvidence(db, c.key, { revisionId: revision, purpose: 'SOURCE_IDENTITY', url, deadlineMs: 60_000 }, store) as typeof capture; }
    catch (error) { tried.push({ url, capture: message(error) }); continue; }
    const relation = await inspectSourceRelation(db, c.key, { captureBatchId: capture.captureBatchId, officialDomain }, store);
    tried.push({ url, captureBatchId: capture.captureBatchId, status: capture.lastStatus, verdict: relation.verdict, reason: relation.reason ?? null });
    if (relation.verdict === 'LINK_MATCHED') {
      etapes.identite = tried;
      const review = await recordSourceIdentityReview(db, { sourceKey: c.key, sourceRevisionId: revision, captureBatchId: capture.captureBatchId, verdict: 'VERIFIED', officialDomain,
        statement: `La page officielle archivée ${auditUrl(relation.proofUrl!)} désigne exactement le portail configuré ${relation.configuredPortal} (lien n° ${(relation as { witness?: { ordinal: number } }).witness?.ordinal ?? '?'}). Le rôle exact du portail n'est pas déduit du nom de la Maison : portalScope reste nul.`,
        reviewer: REVIEWER, checkedAt: nowMs(), portalScope: null } as Parameters<typeof recordSourceIdentityReview>[1], true, store) as { written?: number; verdict?: string; reason?: string };
      etapes.decisionIdentite = review;
      return review.written === 1 || (review as { isLatestDecision?: boolean }).isLatestDecision === true;
    }
    if (relation.reason === 'EXACT_PORTAL_REFERENCE_NOT_FOUND' && i === 0) {
      for (const link of await careerLinks(capture.captureBatchId, officialDomain)) if (!seen.has(link)) pages.push(link);
    }
  }
  etapes.identite = tried;
  return false;
}

async function acces(c: Candidat, revision: string, jobsCaptureId: string, etapes: Record<string, unknown>) {
  const rows = await db.rawCapture.findMany({ where: { batchId: jobsCaptureId }, orderBy: { sequence: 'asc' } });
  const requests: { method: string; url: URL }[] = [];
  for (const row of rows) {
    const data = await readRequestData(db, row, store);
    if (!data || data.origin !== 'HTTP_TRANSPORT') throw new Error('ACCESS_JOURNAL: requête sans provenance HTTP native');
    for (const hop of data.hops) requests.push({ method: hop.request.method, url: new URL(hop.request.url) });
  }
  if (!requests.length) throw new Error('ACCESS_JOURNAL: aucune requête observée');
  const origins = [...new Set(requests.map(r => r.url.origin))];
  const robotsCaptureIds: string[] = [];
  for (const origin of origins) {
    const capture = await captureSourceEvidence(db, c.key, { revisionId: revision, purpose: 'SOURCE_ACCESS', url: `${origin}/robots.txt`, deadlineMs: 60_000 }, store) as { captureBatchId: string };
    robotsCaptureIds.push(capture.captureBatchId);
  }
  const groups = new Map<string, { origin: string; path: string; methods: Set<string>; values: Map<string, Set<string>>; count: number }>();
  for (const r of requests) {
    const k = `${r.url.origin}${r.url.pathname}`;
    const g = groups.get(k) ?? { origin: r.url.origin, path: r.url.pathname, methods: new Set(), values: new Map(), count: 0 };
    g.methods.add(r.method); g.count++;
    for (const [key, value] of r.url.searchParams) { if (!g.values.has(key)) g.values.set(key, new Set()); g.values.get(key)!.add(value); }
    groups.set(k, g);
  }
  const scopes = [...groups.values()].map(g => {
    const fixed: Record<string, string> = {}; const variable: string[] = [];
    for (const [key, values] of g.values) { if (values.size === 1 && g.count === requests.filter(r => `${r.url.origin}${r.url.pathname}` === `${g.origin}${g.path}` && r.url.searchParams.has(key)).length) fixed[key] = [...values][0]; else variable.push(key); }
    return { origin: g.origin, path: { kind: 'EXACT' as const, value: g.path }, methods: [...g.methods], query: { fixed, variable }, surface: SURFACE_BY_KIND[c.kind] ?? 'PUBLIC_ATS_HTML' };
  });
  const statement = `Périmètre dérivé des ${requests.length} requête(s) HTTP réellement observées pendant la collecte de qualification ${jobsCaptureId} (${scopes.map(s => `${s.methods.join('/')} ${s.origin}${s.path.value}${Object.keys(s.query.fixed).length ? ' ?' + Object.entries(s.query.fixed).map(([k, v]) => `${k}=${v}`).join('&') : ''}${s.query.variable.length ? ` [variables : ${s.query.variable.join(', ')}]` : ''}`).join(' ; ')}). Robots archivé pour chaque origine interrogée ; la décision ne couvre que ce qui a été vu.`;
  const document = { sourceKey: c.key, sourceRevisionId: revision, captureBatchId: jobsCaptureId, verdict: 'ALLOWED', robotsCaptureIds, scopes, statement, reviewer: REVIEWER, checkedAt: nowMs() };
  etapes.acces = { origins, scopes, robotsCaptureIds };
  try {
    const decision = await recordSourceAccessDecision(db, document as Parameters<typeof recordSourceAccessDecision>[1], true, store) as { verdict?: string; written?: number; reason?: string };
    etapes.decisionAcces = decision;
    if (decision.verdict === 'ALLOWED' && (decision.written === 1 || (decision as { isLatestDecision?: boolean }).isLatestDecision)) return { allowed: true, reason: null as string | null };
    return { allowed: false, reason: decision.reason ?? JSON.stringify(decision).slice(0, 300) };
  } catch (error) {
    const reason = message(error);
    // Un refus robots ou un périmètre non couvert devient une décision NOT_AUTHORIZED explicite : rien ne sera collecté.
    if (/not covered|DISALLOWED|robots/i.test(reason)) {
      const denial = { sourceKey: c.key, sourceRevisionId: revision, captureBatchId: null, verdict: 'NOT_AUTHORIZED', robotsCaptureIds: [], scopes: [],
        statement: `Accès refusé lors de la campagne F3 : ${reason}`, reviewer: REVIEWER, checkedAt: nowMs() };
      try { etapes.decisionAcces = await recordSourceAccessDecision(db, denial as Parameters<typeof recordSourceAccessDecision>[1], true, store); } catch (e) { etapes.decisionAccesErreur = message(e); }
    }
    return { allowed: false, reason };
  }
}

async function qualifier(c: Candidat): Promise<Verdict> {
  const debut = Date.now(); const etapes: Record<string, unknown> = {}; const raisons: string[] = [];
  const rendre = (verdict: string, extra: Partial<Verdict> = {}): Verdict => ({ key: c.key, kind: c.kind, maison: c.maison, verdict, raisons, etapes, dureeMs: Date.now() - debut, evalueLe: nowMs(), ...extra });
  let candidate; try { candidate = parseSourceCandidate({ key: c.key, maison: c.maison, kind: c.kind, config: c.config, careersDomain: c.careersDomain, tier: c.tier, jobUrlPattern: c.jobUrlPattern ?? null }); }
  catch (error) { raisons.push(message(error)); return rendre('HORS_PARCOURS'); }
  let registration; try { registration = await registerSourceCandidate(db, candidate, true); }
  catch (error) { raisons.push(message(error)); return rendre('BLOCAGE_EXTERNE'); }
  const source = registration.source!; const revision = source.currentRevisionId as string;
  etapes.enregistrement = { created: registration.created, status: source.status, revision };
  if (source.status === 'RETIRED') { raisons.push('source RETIRED dans le registre'); return rendre('RETIREE', { revision }); }
  if (!c.domain) { raisons.push('domaine officiel de la Maison non résolu'); return rendre('DOMAINE_OFFICIEL_MANQUANT', { revision }); }
  const registrable = parseDomain(c.domain, { allowPrivateDomains: true }).domain ?? c.domain;
  let identityOk = false;
  try { identityOk = await identite(c, revision, registrable, etapes); }
  catch (error) { raisons.push(`identité : ${message(error)}`); }
  if (!identityOk) raisons.push('aucune page du domaine officiel ne lie exactement le portail configuré (voir etapes.identite)');
  let validation; try { validation = await captureSourceForValidation(db, c.key, deadlineMs, store); }
  catch (error) { const m = message(error); raisons.push(`collecte : ${m}`); return rendre(inaccessible(m) ? 'INACCESSIBLE' : 'COLLECTE_NON_VALIDEE', { revision }); }
  etapes.collecte = { captureBatchId: validation.captureBatchId, verdict: validation.verdict, report: validation.report };
  const offres = (validation.report as { observed?: number })?.observed;
  if (validation.verdict !== 'VALIDATED') { raisons.push(`validation native : ${validation.verdict}`); return rendre('COLLECTE_NON_VALIDEE', { revision, offres }); }
  let access; try { access = await acces(c, revision, validation.captureBatchId, etapes); }
  catch (error) { const m = message(error); raisons.push(`accès : ${m}`); return rendre(inaccessible(m) ? 'INACCESSIBLE' : 'COLLECTE_NON_VALIDEE', { revision, offres }); }
  if (!access.allowed) { raisons.push(`accès : ${access.reason}`); return rendre(/not covered|DISALLOWED|robots/i.test(access.reason ?? '') ? 'REFUSEE' : 'COLLECTE_NON_VALIDEE', { revision, offres }); }
  if (!identityOk) return rendre('IDENTITE_NON_PROUVEE', { revision, offres });
  const status = await sourceStatus(db, c.key) as { promotionGatesPass?: boolean; status?: string; identity?: unknown; native?: unknown; access?: unknown };
  etapes.portes = { identity: status.identity, native: status.native, access: status.access, promotionGatesPass: status.promotionGatesPass, status: status.status };
  try { etapes.promotion = await promoteSource(db, c.key, revision); }
  catch (error) { raisons.push(`promotion : ${message(error)}`); return rendre('COLLECTE_NON_VALIDEE', { revision, offres }); }
  const result = rendre('QUALIFIEE', { revision, offres });
  if (flag('ingest')) {
    const run = spawnSync('npx', ['--no-install', 'tsx', 'apps/aggregator/src/cli.ts', 'ingest', `--source=${c.key}`, '--no-geocode'], { encoding: 'utf8' });
    const line = (run.stdout + run.stderr).split('\n').reverse().find(l => l.includes('"event":"command.result"'));
    const data = line ? JSON.parse(line).data : null; const s = data?.sources?.[0];
    result.ingestion = { exit: run.status, ok: data?.ok ?? null, fetched: s?.fetched, created: s?.created, updated: s?.updated, errors: s?.errors };
    const plan = await readRefreshPlan(db, { onlyKeys: [c.key] });
    const e = plan.absencePlan.eligibility.find(x => x.source === c.key);
    result.absence = { eligible: e?.eligible ?? null, reasons: e?.reasons ?? [], termination: e?.termination ?? null, representations: Object.fromEntries([...plan.absencePlan.states.values()].reduce((m, st) => m.set(st, (m.get(st) ?? 0) + 1), new Map<string, number>())) };
  }
  return result;
}

console.log(`campagne : ${candidats.length} candidat(s), ${previous.length} verdict(s) déjà rendu(s)`);
try {
  for (const [i, c] of candidats.entries()) {
    let verdict: Verdict;
    try { verdict = await qualifier(c); }
    catch (error) { verdict = { key: c.key, kind: c.kind, maison: c.maison, verdict: 'BLOCAGE_EXTERNE', raisons: [`erreur non classée : ${message(error)}`], etapes: {}, dureeMs: 0, evalueLe: nowMs() }; }
    verdicts.push(verdict); save();
    console.log(`${String(i + 1).padStart(3)}/${candidats.length} ${verdict.verdict.padEnd(26)} ${c.key} (${verdict.offres ?? '-'} offres, ${(verdict.dureeMs / 1000).toFixed(1)} s)${verdict.raisons.length ? ' — ' + verdict.raisons[0].slice(0, 160) : ''}`);
  }
} finally {
  await closeBrowser().catch(() => {}); await db.$disconnect();
}
const totals: Record<string, number> = {};
for (const v of verdicts) totals[v.verdict] = (totals[v.verdict] ?? 0) + 1;
console.log('bilan :', JSON.stringify(totals), '→', verdictsFile);
