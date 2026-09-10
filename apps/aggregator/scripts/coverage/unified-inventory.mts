/**
 * ONE tracking inventory for LOT 4, actor by actor and source by source, built read-only from the production database and the
 * existing evidence sets — never a new "master" list typed by hand. Every set keeps its own denominator; an actor appearing in
 * several sets is ONE row (deduplicated by reviewed alias, then canonical company key), and the row says which sets name it.
 *
 * Sets: FashionJobs benchmark (1 653 discovery labels — actors to find, never a source of postings) · web discovery reconciliation
 * (65 rows) · group portfolio observations (275 brands) · B6 tenant candidates (33) · production companies with active postings ·
 * the Source table (every status). A source may feed several actors (group portal) and an actor may have several sources: both
 * links are listed, nothing is merged by this tool.
 *
 * Usage: npx tsx apps/aggregator/scripts/coverage/unified-inventory.mts <output-dir>
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { assertIdentityReview } from '../../src/connectors/sourceIdentity.js';
import { resolveCompany } from '../../src/normalize/company.js';
import { normalizedEmployerName } from '../../src/normalize/employerName.js';

const out = process.argv[2];
if (!out) { console.error('usage: unified-inventory.mts <output-dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const A9 = 'audits/2026-09-09', A10 = 'audits/2026-09-10';
const ledger: any[] = JSON.parse(readFileSync(`${A9}/fashionjobs-portals/ledger.json`, 'utf8'));
const web: any[] = JSON.parse(readFileSync(`${A10}/discovery-web/reconciliation.json`, 'utf8')).items;
const portfolio: any[] = JSON.parse(readFileSync(`${A9}/lot4-world-coverage/portfolio-observations-expanded.json`, 'utf8'));
const b6: any[] = JSON.parse(readFileSync(`${A9}/lot4-world-coverage/b6-candidates-sector.json`, 'utf8'));
/** Tracker v10 receipts: the adapter replayed locally with the current code (proof-dimensions.py) — enumeration and collection verdicts, dated. */
const receipts = new Map<string, Record<string, string>>();
{ const lines = readFileSync(`${A9}/lot4-world-coverage/tracker-v10/sources-proof-dimensions.csv`, 'utf8').split(/\r?\n/).filter(Boolean); const head = lines[0]!.split(','); for (const l of lines.slice(1)) { const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')); receipts.set(cells[0]!, Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']))); } }

type SourceRow = { key: string; maison: string; kind: string; status: string; tenantKey: string; config: unknown; identity: string; scope: string | null; reviewedAt: string | null; lastRun: { status: string; fetched: number | null; declaredTotal: number | null; complete: boolean | null; truncated: boolean | null; at: string } | null; active: number; feeds: Array<{ actor: string; n: number }>; completeness: string; receipt: { enumeration: string; collection: string; at: string; revision: string; gap: string; deficit: string; details: string } | null; verdict: string };
type Actor = { key: string; name: string; sets: Set<string>; fjStage?: string; fjLabels: string[]; fjEditions: number; webVerdicts: string[]; portfolioGroups: string[]; b6Tenants: string[]; company: { id: string; name: string; kind: string; domain: string | null; parentGroup: string | null; active: number } | null; sources: Map<string, string>; };

const p = new PrismaClient({ log: [] });
try {
  const db: any = await p.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const companies: any[] = await tx.$queryRaw`SELECT c.id, c.name, c."canonicalKey", c."fashionjobsUrl" key, c.kind::text kind, c.domain, c."parentGroup", (SELECT COUNT(*)::int FROM "Job" j WHERE j."companyId"=c.id AND j."isActive") active FROM "Company" c WHERE c."mergedIntoId" IS NULL`;
    const aliases: any[] = await tx.$queryRaw`SELECT a."normalizedName", c."canonicalKey" FROM "CompanyAlias" a JOIN "Company" c ON c.id=a."companyId" WHERE a."reviewId" IS NOT NULL AND c."mergedIntoId" IS NULL`;
    const merged: any[] = await tx.$queryRaw`SELECT m.name, r."canonicalKey" FROM "Company" m JOIN "Company" r ON r.id=m."mergedIntoId" WHERE m."mergedIntoId" IS NOT NULL`;
    const sources = await tx.source.findMany({ select: { id: true, key: true, maison: true, kind: true, status: true, tenantKey: true, config: true, careersDomain: true, tier: true } });
    const reviews = await tx.sourceIdentityReview.findMany({ orderBy: { checkedAt: 'desc' } });
    const runs: any[] = await tx.$queryRaw`SELECT DISTINCT ON ("sourceKey") "sourceKey", status, fetched, "declaredTotal", complete, truncated, "ranAt" FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC`;
    const feeds: any[] = await tx.$queryRaw`SELECT js."sourceKey", c."canonicalKey", c.name, COUNT(*)::int n FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" JOIN "Company" c ON c.id=j."companyId" WHERE js."isActive" AND j."isActive" GROUP BY 1,2,3`;
    return { companies, aliases, merged, sources, reviews, runs, feeds, activeTotal: await tx.job.count({ where: { isActive: true } }) };
  });
  const aliasIndex = new Map<string, string>(db.aliases.map((a: any) => [a.normalizedName, a.canonicalKey]));
  for (const m of db.merged) aliasIndex.set(normalizedEmployerName(m.name), m.canonicalKey);
  const companyByKey = new Map<string, any>(db.companies.map((c: any) => [c.canonicalKey, c]));
  /** Reviewed alias or merged spelling first, then the canonical identity of the name. */
  const actorKey = (name: string) => aliasIndex.get(normalizedEmployerName(name)) ?? resolveCompany(name).companyId;
  const actors = new Map<string, Actor>();
  const actor = (name: string, set: string) => {
    const key = actorKey(name);
    let a = actors.get(key);
    if (!a) { const c = companyByKey.get(key); a = { key, name: c?.name ?? resolveCompany(name).displayName, sets: new Set(), fjLabels: [], fjEditions: 0, webVerdicts: [], portfolioGroups: [], b6Tenants: [], company: c ? { id: c.id, name: c.name, kind: c.kind, domain: c.domain, parentGroup: c.parentGroup, active: c.active } : null, sources: new Map() }; actors.set(key, a); }
    a.sets.add(set); return a;
  };
  for (const c of db.companies) if (c.active > 0) actor(c.name, 'DB_ACTIVE_COMPANY');
  for (const row of ledger) { const a = actor(row.labels?.[0] ?? row.discoveryKey, 'FASHIONJOBS'); a.fjStage = row.stage; a.fjLabels.push(...(row.labels ?? [])); a.fjEditions = Math.max(a.fjEditions, (row.editions ?? []).length); }
  for (const item of web) actor(item.actor, 'WEB_DISCOVERY').webVerdicts.push(item.verdict);
  for (const o of portfolio) actor(o.name, 'PORTFOLIO').portfolioGroups.push(o.portfolioGroup);
  // Sources: identity verdict under the promotion contract, last run, completeness, actors fed.
  const sources: SourceRow[] = db.sources.map((s: any) => {
    const review = db.reviews.find((r: any) => r.sourceKey === s.key) ?? null;
    let identity = 'LEGACY_UNCERTIFIED';
    if (review) { try { assertIdentityReview(s, review); identity = 'CERTIFIED_CURRENT'; } catch (e) { identity = `REVIEW_NOT_CURRENT (${(e as Error).message.replace(/^promote: /, '').slice(0, 60)})`; } }
    const run = db.runs.find((r: any) => r.sourceKey === s.key);
    const feeds = db.feeds.filter((f: any) => f.sourceKey === s.key).map((f: any) => ({ actor: f.name, n: f.n }));
    const completeness = !run ? 'NO_RUN' : ['BROKEN', 'ERROR', 'TIMEOUT', 'CHALLENGED', 'INTERRUPTED'].includes(run.status) ? `NOT_PROVEN (${run.status})` : run.truncated || run.complete === false ? 'NOT_PROVEN (incomplete)' : run.declaredTotal != null && run.fetched != null ? (run.declaredTotal === run.fetched ? 'PROVEN_BY_DECLARED_TOTAL' : `NOT_PROVEN (declared ${run.declaredTotal} ≠ fetched ${run.fetched})`) : run.complete === true ? 'COMPLETE_FLAG_ONLY' : 'NOT_PROVEN (no signal)';
    const r = receipts.get(s.key); const receipt = r ? { enumeration: r.enumeration!, collection: r.collection!, at: r.receiptAt!, revision: r.receiptRevision!, gap: r.gap!, deficit: r.deficit!, details: r.details! } : null;
    // Combined verdict: the production run is the truth of what was WRITTEN; the receipt is the truth of what the CURRENT adapter enumerates.
    // A last production run older than the receipt with `complete=false` (2026-09-08 global run: DEGRADED ⇒ complete=false, pre-evidence semantics) is superseded by the receipt, but the run stays due.
    const verdict = completeness.startsWith('PROVEN') ? completeness : receipt && receipt.enumeration === 'EXHAUSTIVE_PROVEN' && receipt.collection === 'COMPLETE' ? (run && run.ranAt.toISOString() < receipt.at ? `RECEIPT_COMPLETE_${receipt.at.slice(0, 10)}_PRODUCTION_RUN_DUE` : 'RECEIPT_COMPLETE') : receipt && receipt.collection === 'INCOMPLETE_EXPLAINED' ? `INCOMPLETE_EXPLAINED (${receipt.deficit})` : completeness;
    return { key: s.key, maison: s.maison, kind: s.kind, status: s.status, tenantKey: s.tenantKey, config: s.config, identity, scope: review?.portalScope ?? null, reviewedAt: review?.checkedAt?.toISOString() ?? null, lastRun: run ? { status: run.status, fetched: run.fetched, declaredTotal: run.declaredTotal, complete: run.complete, truncated: run.truncated, at: run.ranAt.toISOString() } : null, active: feeds.reduce((n: number, f: any) => n + f.n, 0), feeds, completeness, receipt, verdict };
  });
  for (const s of sources) {
    actor(s.maison, 'SOURCE_MAISON').sources.set(s.key, `${s.status}:${s.identity.split(' ')[0]}`);
    for (const f of s.feeds) { const a = actor(f.actor, 'FED_BY_SOURCE'); if (!a.sources.has(s.key)) a.sources.set(s.key, `${s.status}:${s.identity.split(' ')[0]}:via-postings`); }
  }
  for (const t of b6) { const tenantSources = sources.filter((s) => s.tenantKey === t.tenantKey); const names = tenantSources.length ? tenantSources.map((s) => s.maison) : (t.labels ?? []).filter((l: string) => !l.includes('.')).slice(0, 1); for (const n of names) actor(n, 'B6_CANDIDATE').b6Tenants.push(t.tenantKey); }

  const activeSources = (a: Actor) => [...a.sources.values()].filter((v) => v.startsWith('ACTIVE')).length;
  const certifiedSources = (a: Actor) => [...a.sources.values()].filter((v) => v.startsWith('ACTIVE:CERTIFIED_CURRENT')).length;
  const nextAction = (a: Actor) => {
    if (activeSources(a) === 0) {
      if (a.sets.has('B6_CANDIDATE')) return 'B6 : certifier et activer le tenant candidat';
      if (a.fjStage === 'ACTIVE_SOURCE_CANDIDATE' || a.fjStage === 'OFFICIAL_PORTAL_TECHNICAL_VALIDATION_REQUIRED') return 'qualifier le portail candidat (identité + validation réelle)';
      if (a.fjStage === 'CAREER_LINK_REVIEW_REQUIRED' || a.fjStage === 'IDENTITY_MATCH_AMBIGUOUS') return 'revue manuelle (lien carrière / identité ambiguë)';
      if (a.sets.has('FASHIONJOBS')) return 'recherche de portail officiel à mener';
      if (a.sets.has('PORTFOLIO')) return 'marque de portefeuille : portail à rechercher';
      return 'sans source active : acteur nourri par une source retirée/pausée ou historique';
    }
    if (certifiedSources(a) < activeSources(a)) return 'certifier la configuration courante des sources actives';
    return 'contrôle live (collecte → publication) et couverture mondiale à prouver';
  };
  const rows = [...actors.values()].sort((x, y) => (y.company?.active ?? 0) - (x.company?.active ?? 0) || x.name.localeCompare(y.name));
  const csvEsc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  writeFileSync(`${out}/actors.csv`, ['actorKey,actor,sets,fashionjobsStage,fashionjobsLabels,fashionjobsEditions,webDiscoveryVerdicts,portfolioGroups,b6Tenants,companyId,companyKind,domain,parentGroup,activePostings,sources,activeSources,certifiedSources,nextAction',
    ...rows.map((a) => [a.key, a.name, [...a.sets].join('|'), a.fjStage ?? '', [...new Set(a.fjLabels)].join('|'), a.fjEditions || '', a.webVerdicts.join('|'), [...new Set(a.portfolioGroups)].join('|'), a.b6Tenants.join('|'), a.company?.id ?? '', a.company?.kind ?? '', a.company?.domain ?? '', a.company?.parentGroup ?? '', a.company?.active ?? 0, [...a.sources.entries()].map(([k, v]) => `${k}=${v}`).join('|'), activeSources(a), certifiedSources(a), nextAction(a)].map(csvEsc).join(','))].join('\n') + '\n');
  writeFileSync(`${out}/sources.csv`, ['sourceKey,maison,kind,status,tenantKey,identity,scope,reviewedAt,lastRunStatus,lastRunAt,fetched,declaredTotal,complete,truncated,productionRunCompleteness,receiptEnumeration,receiptCollection,receiptAt,receiptDetails,verdict,activePostings,actorsFed',
    ...sources.sort((x, y) => x.key.localeCompare(y.key)).map((s) => [s.key, s.maison, s.kind, s.status, s.tenantKey, s.identity, s.scope ?? '', s.reviewedAt ?? '', s.lastRun?.status ?? '', s.lastRun?.at ?? '', s.lastRun?.fetched ?? '', s.lastRun?.declaredTotal ?? '', s.lastRun?.complete ?? '', s.lastRun?.truncated ?? '', s.completeness, s.receipt?.enumeration ?? '', s.receipt?.collection ?? '', s.receipt?.at ?? '', s.receipt?.details ?? '', s.verdict, s.active, s.feeds.map((f) => `${f.actor}:${f.n}`).join('|')].map(csvEsc).join(','))].join('\n') + '\n');
  const count = (pred: (a: Actor) => boolean) => rows.filter(pred).length;
  const inSet = (s: string) => count((a) => a.sets.has(s));
  const active = sources.filter((s) => s.status === 'ACTIVE');
  const tally = (xs: string[]) => Object.fromEntries([...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]));
  const summary = {
    at: new Date().toISOString(), activePostings: db.activeTotal,
    denominators: { FASHIONJOBS: ledger.length, WEB_DISCOVERY: web.length, PORTFOLIO: portfolio.length, B6_CANDIDATE_TENANTS: b6.length, DB_ACTIVE_COMPANIES: db.companies.filter((c: any) => c.active > 0).length, SOURCES: sources.length, SOURCES_BY_STATUS: tally(sources.map((s) => s.status)) },
    actorsAfterDedup: { union: rows.length, bySet: Object.fromEntries(['FASHIONJOBS', 'WEB_DISCOVERY', 'PORTFOLIO', 'B6_CANDIDATE', 'DB_ACTIVE_COMPANY', 'SOURCE_MAISON', 'FED_BY_SOURCE'].map((s) => [s, inSet(s)])), fashionjobsOnly: count((a) => a.sets.has('FASHIONJOBS') && a.sets.size === 1), fashionjobsWithActiveSource: count((a) => a.sets.has('FASHIONJOBS') && activeSources(a) > 0), fashionjobsWithoutSource: count((a) => a.sets.has('FASHIONJOBS') && activeSources(a) === 0), webDiscoveryWithActiveSource: count((a) => a.sets.has('WEB_DISCOVERY') && activeSources(a) > 0), portfolioWithActiveSource: count((a) => a.sets.has('PORTFOLIO') && activeSources(a) > 0), withActiveSource: count((a) => activeSources(a) > 0), withOnlyCertifiedActiveSources: count((a) => activeSources(a) > 0 && certifiedSources(a) === activeSources(a)), withActivePostingsButNoActiveSource: count((a) => (a.company?.active ?? 0) > 0 && activeSources(a) === 0), fashionjobsStages: tally(rows.filter((a) => a.fjStage).map((a) => a.fjStage!)), nextActions: tally(rows.map(nextAction)) },
    sources: { identity: tally(active.map((s) => s.identity.split(' ')[0])), scope: tally(active.map((s) => s.scope ?? 'none')), productionRunCompleteness: tally(active.map((s) => s.completeness.split(' ')[0])), receiptEnumeration: tally(active.map((s) => s.receipt?.enumeration ?? 'NO_RECEIPT')), receiptCollection: tally(active.map((s) => s.receipt?.collection ?? 'NO_RECEIPT')), verdict: tally(active.map((s) => s.verdict.replace(/_\d{4}-\d{2}-\d{2}/, '').split(' ')[0])), lastRunStatus: tally(active.map((s) => s.lastRun?.status ?? 'NO_RUN')), feedingSeveralActors: active.filter((s) => s.feeds.length > 1).length, activePostingsUnderActiveSources: active.reduce((n, s) => n + s.active, 0) },
    method: 'Deduplication key: reviewed CompanyAlias or merged spelling → root canonicalKey, else resolveCompany(name).companyId. Sets keep their own denominator; a row lists every set naming the actor. Sources are attached to the actor of their catalogued maison and to every actor they feed (active postings). Nothing is merged or written by this tool.',
  };
  writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
} finally { await p.$disconnect(); }
