import { PrismaClient } from '@prisma/client'; import { writeFileSync } from 'node:fs';
import { resolveCompany } from '../../../src/normalize/company.js';
import { existsSync, readFileSync } from 'node:fs';
// Volumes of a lot, SEPARATED: collected (fetched by the adapter) → written (active representations) → published (active postings, and the
// public API count per company) — with every exclusion counted on its own line (holds, identity refusals, out-of-scope decisions, write
// failures), and a completeness verdict per source that never derives from "the activation succeeded".
// usage: lot-volumes.mts <keys,comma> <sinceISO> <lot> [--api]
const p = new PrismaClient({ log: [] });
const KEYS = process.argv[2].split(','); const SINCE = new Date(process.argv[3]); const LOT = process.argv[4]; const API = process.argv.includes('--api');
type Row = Record<string, any>;
function completeness(run: Row | undefined, held = 0, rejected: Row | undefined = undefined): string {
  if (!run) return 'NO_RUN';
  if (['BROKEN', 'ERROR', 'TIMEOUT', 'CHALLENGED', 'INTERRUPTED', 'FAILED'].includes(run.status)) return `NOT_PROVEN (${run.status})`;
  if (run.truncated) return 'NOT_PROVEN (truncated)';
  const gap = run.declaredTotal != null && run.fetched != null ? run.declaredTotal - run.fetched : null;
  const enumerated = gap === 0 ? 'PROVEN_BY_DECLARED_TOTAL' : gap != null && gap > 0 && rejected && rejected.n >= gap ? `INCOMPLETE_EXPLAINED (${gap} of ${run.declaredTotal} declared rows rejected by the adapter: ${JSON.stringify(rejected.reasons)})` : gap != null ? `NOT_PROVEN (declared ${run.declaredTotal} ≠ fetched ${run.fetched})` : run.complete === true ? 'COMPLETE_FLAG_ONLY (no total declared by the publisher: one document or an exhausted pagination)' : run.complete === false ? 'NOT_PROVEN (adapter reports incomplete)' : 'NOT_PROVEN (no completeness signal)';
  // `complete=false` with a full enumeration = postings HELD without disposition (e.g. no employer in the detail on a MULTI_BRAND portal):
  // the enumeration is proven, the source is denied the right to attest absence until the holds are reviewed. Reported, never hidden.
  if (run.complete === false && (enumerated.startsWith('PROVEN') || enumerated.startsWith('INCOMPLETE_EXPLAINED'))) return `${enumerated}; ATTESTATION_WITHHELD (${held} held)`;
  return enumerated;
}
try {
  const out: Row = await p.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const runs = await tx.sourceRun.findMany({ where: { sourceKey: { in: KEYS }, ranAt: { gte: SINCE } }, orderBy: { ranAt: 'desc' }, select: { sourceKey: true, status: true, fetched: true, accepted: true, declaredTotal: true, complete: true, truncated: true, ranAt: true, note: true } });
    const written: Row[] = await tx.$queryRaw`SELECT js."sourceKey", COUNT(*)::int written, COUNT(*) FILTER (WHERE js."firstSeenAt" >= ${SINCE})::int created, COUNT(*) FILTER (WHERE js."lastSeenAt" >= ${SINCE})::int reattested FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" WHERE js."sourceKey" = ANY(${KEYS}) AND js."isActive" AND j."isActive" GROUP BY 1`;
    const inactive: Row[] = await tx.$queryRaw`SELECT js."sourceKey", COUNT(*)::int n FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" WHERE js."sourceKey" = ANY(${KEYS}) AND NOT (js."isActive" AND j."isActive") GROUP BY 1`;
    const events: Row[] = await tx.$queryRaw`SELECT e."sourceKey", e.event, COUNT(*)::int n FROM "PipelineEvent" e WHERE e."sourceKey" = ANY(${KEYS}) AND e.at >= ${SINCE} AND e.event IN ('job.publication_held','job.write_failed') GROUP BY 1,2`;
    const rejectedRows: Row[] = await tx.$queryRaw`SELECT DISTINCT ON (e."sourceKey") e."sourceKey", COALESCE(e.payload->>'count', e.payload->'data'->>'count')::int n, COALESCE(e.payload->'reasons', e.payload->'data'->'reasons') reasons FROM "PipelineEvent" e WHERE e."sourceKey" = ANY(${KEYS}) AND e.at >= ${SINCE} AND e.event = 'source.rows_rejected' ORDER BY e."sourceKey", e.at DESC`;
    const review: Row[] = await tx.$queryRaw`SELECT "sourceKey", COUNT(*)::int n FROM "EmployerObservation" WHERE "sourceKey" = ANY(${KEYS}) AND rule='REVIEW_REQUIRED' AND "observedAt" >= ${SINCE} GROUP BY 1`;
    const scopeOut: Row[] = await tx.$queryRaw`SELECT "sourceKey", verdict, COUNT(*)::int n FROM "PostingScopeDecision" WHERE "sourceKey" = ANY(${KEYS}) GROUP BY 1,2`;
    const companies: Row[] = await tx.$queryRaw`SELECT js."sourceKey", c.name, c."fashionjobsUrl" key, COUNT(*)::int n FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" JOIN "Company" c ON c.id=j."companyId" WHERE js."sourceKey" = ANY(${KEYS}) AND js."isActive" AND j."isActive" GROUP BY 1,2,3 ORDER BY 1,4 DESC`;
    const obs: Row[] = await tx.$queryRaw`SELECT "sourceKey", rule, COUNT(*)::int n FROM "EmployerObservation" WHERE "sourceKey" = ANY(${KEYS}) AND "observedAt" >= ${SINCE} GROUP BY 1,2`;
    const sources = await tx.source.findMany({ where: { key: { in: KEYS } }, select: { key: true, maison: true, status: true } });
    // Reviewed, source-scoped aliases: a company they route to is a legitimate credit of a MULTI_BRAND source (GU on the UNIQLO US site).
    const aliases: Row[] = await tx.$queryRaw`SELECT a."sourceKey", c."canonicalKey" FROM "CompanyAlias" a JOIN "Company" c ON c.id=a."companyId" WHERE a."sourceKey" = ANY(${KEYS}) AND a."reviewId" IS NOT NULL`;
    // Labels a B6 spec deliberately leaves to identity review (collected, refused at the gate, never credited): their refusals are expected, counted apart.
    const specs: Row[] = existsSync('backups/lot4-20260909/b6-specs.json') ? JSON.parse(readFileSync('backups/lot4-20260909/b6-specs.json', 'utf8')) : [];
    const unresolvedLabels = specs.flatMap((s: Row) => (s.unresolvedLabels ?? []).map((u: Row) => ({ sourceKey: s.key, rawName: u.rawName })));
    const expectedRefusals: Row[] = unresolvedLabels.length ? await tx.$queryRaw`SELECT "sourceKey", COUNT(*)::int n FROM "EmployerObservation" WHERE "sourceKey" = ANY(${KEYS}) AND rule='REVIEW_REQUIRED' AND "observedAt" >= ${SINCE} AND ("sourceKey" || '|' || "rawEmployerName") = ANY(${unresolvedLabels.map((u: Row) => `${u.sourceKey}|${u.rawName}`)}) GROUP BY 1` : [];
    return { runs, written, inactive, events, rejectedRows, review, scopeOut, companies, obs, sources, aliases, expectedRefusals, activeTotal: await tx.job.count({ where: { isActive: true } }) };
  });
  const perSource = KEYS.map((k) => {
    const run = out.runs.find((r: Row) => r.sourceKey === k); const w = out.written.find((r: Row) => r.sourceKey === k) ?? { written: 0, created: 0, reattested: 0 };
    const ev = (e: string) => out.events.find((r: Row) => r.sourceKey === k && r.event === e)?.n ?? 0;
    const comps = out.companies.filter((r: Row) => r.sourceKey === k); const src = out.sources.find((s: Row) => s.key === k);
    // Credited to something else than the catalogued Maison: another canonical identity, or a source-scoped key (an unreviewed new employer).
    const aliasTargets = new Set(out.aliases.filter((a: Row) => a.sourceKey === k).map((a: Row) => a.canonicalKey));
    const labelNotMaison = comps.filter((c: Row) => (resolveCompany(c.name).companyId !== resolveCompany(src?.maison ?? '').companyId && !aliasTargets.has(c.key.replace(/^resolved:/, ''))) || c.key.startsWith('resolved:SOURCE_')).map((c: Row) => `${c.name} (${c.n}${c.key.startsWith('resolved:SOURCE_') ? ', source-scoped key' : ''})`);
    return {
      key: k, maison: src?.maison, status: src?.status, run: run ? { status: run.status, at: run.ranAt, fetched: run.fetched, accepted: run.accepted, declaredTotal: run.declaredTotal, complete: run.complete, truncated: run.truncated } : null,
      collected: run?.fetched ?? null, held: ev('job.publication_held'), writeFailed: ev('job.write_failed'), reviewRequired: out.review.find((r: Row) => r.sourceKey === k)?.n ?? 0, reviewRequiredExpected: out.expectedRefusals.find((r: Row) => r.sourceKey === k)?.n ?? 0,
      scopeDecisions: Object.fromEntries(out.scopeOut.filter((r: Row) => r.sourceKey === k).map((r: Row) => [r.verdict, r.n])),
      written: w.written, createdSince: w.created, reattestedSince: w.reattested, inactiveRepresentations: out.inactive.find((r: Row) => r.sourceKey === k)?.n ?? 0,
      published: w.written, companies: comps.map((c: Row) => ({ name: c.name, n: c.n, key: c.key })), labelNotMaison, identityRules: Object.fromEntries(out.obs.filter((r: Row) => r.sourceKey === k).map((r: Row) => [r.rule, r.n])),
      completeness: completeness(run, ev('job.publication_held'), out.rejectedRows.find((r: Row) => r.sourceKey === k)), rejectedRows: out.rejectedRows.find((r: Row) => r.sourceKey === k)?.n ?? 0,
    };
  });
  // Published on the front: the public API total per company (cache bypassed) against the company-wide active count in the database.
  const front: Row[] = [];
  if (API) for (const name of [...new Set(out.companies.map((c: Row) => c.name))] as string[]) {
    const company = await p.company.findFirst({ where: { name, mergedIntoId: null }, select: { id: true } });
    const db = company ? await p.job.count({ where: { companyId: company.id, isActive: true } }) : null;
    const api = await fetch(`https://modecareers.com/api/jobs?maison=${encodeURIComponent(name)}&limit=1&_=${Date.now()}`, { headers: { 'cache-control': 'no-cache', 'user-agent': 'Mozilla/5.0 lot-volumes' } }).then((x) => x.json()).then((d: any) => d.total as number).catch(() => null);
    front.push({ company: name, dbActive: db, apiTotal: api, parity: api === db });
  }
  const report = { at: new Date().toISOString(), lot: LOT, since: SINCE.toISOString(), keys: KEYS, activeTotal: out.activeTotal, sources: perSource, front };
  writeFileSync(`backups/lot4-20260909/lot-${LOT}-volumes.json`, JSON.stringify(report, null, 1));
  const md = ['| Source | Maison | Collectées | Retenues (holds / refus identité / échecs écriture / hors périmètre) | Écrites (actives) | Publiées (BDD) | Sociétés créditées | Complétude |', '|---|---|---:|---|---:|---:|---|---|',
    ...perSource.map((s) => `| ${s.key} | ${s.maison} | ${s.collected ?? 'n/d'} | ${s.held} / ${s.reviewRequired}${s.reviewRequiredExpected ? ` (${s.reviewRequiredExpected} attendus : libellés laissés en revue)` : ''} / ${s.writeFailed} / ${s.scopeDecisions.OUT_OF_SCOPE ?? 0} | ${s.written} | ${s.published} | ${s.companies.map((c: Row) => `${c.name} ${c.n}`).join(', ')}${s.labelNotMaison.length ? ` ⚠ ${s.labelNotMaison.join('; ')}` : ''} | ${s.completeness} |`),
    ...(front.length ? ['', '| Société | Actives BDD | API publique | Parité |', '|---|---:|---:|---|', ...front.map((f) => `| ${f.company} | ${f.dbActive} | ${f.apiTotal} | ${f.parity ? 'oui' : 'NON'} |`)] : [])].join('\n');
  writeFileSync(`backups/lot4-20260909/lot-${LOT}-volumes.md`, md + '\n');
  console.log(md);
  const problems = perSource.flatMap((s) => [...(s.reviewRequired > s.reviewRequiredExpected ? [`${s.key}: ${s.reviewRequired - s.reviewRequiredExpected} unexpected identity refusals (${s.reviewRequiredExpected} expected: labels left to review)`] : []), ...(s.writeFailed > s.reviewRequiredExpected ? [`${s.key}: ${s.writeFailed - s.reviewRequiredExpected} write failures beyond the expected identity refusals`] : []), ...(s.labelNotMaison.length ? [`${s.key}: credited to ${s.labelNotMaison.join('; ')}`] : []), ...(s.completeness.startsWith('NOT_PROVEN') || s.completeness === 'NO_RUN' ? [`${s.key}: ${s.completeness}`] : [])]).concat(front.filter((f) => !f.parity).map((f) => `${f.company}: front parity broken (db ${f.dbActive}, api ${f.apiTotal})`));
  console.log(JSON.stringify({ problems }));
  if (problems.length && process.argv.includes('--strict')) process.exitCode = 9;
} finally { await p.$disconnect(); }
