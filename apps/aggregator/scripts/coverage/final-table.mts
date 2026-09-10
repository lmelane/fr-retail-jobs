/**
 * The final LOT 4 table, one row per ACTIVE source (plus the sources touched by the lot in another status), generated from the
 * production database and the bounded-lot ledger — never typed by hand:
 *   Acteur | Source | Identité | Périmètre | Collecte | Rejets/blocages | Publication | Commit | Déploiement | Preuve prod | Restant
 * Identité = the promotion contract applied to the CURRENT configuration. Collecte = the last production run (what was written) and
 * the tracker receipt (what the current adapter enumerates). Publication = active postings under the source, and the public API
 * total per company when --api is given. Commit / Déploiement = the revision of the pipeline run that last wrote the source (a bounded
 * lot or the global run), and whether that run finished. Nothing here is a claim of worldwide coverage of the actor.
 *
 * Usage: npx tsx apps/aggregator/scripts/coverage/final-table.mts <inventory-dir> <output.md> [--api]
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';

const [inventoryDir, outFile] = process.argv.slice(2);
if (!inventoryDir || !outFile) { console.error('usage: final-table.mts <inventory-dir> <output.md> [--api]'); process.exit(2); }
const API = process.argv.includes('--api');
const parseCsv = (text: string) => { const lines = text.split(/\r?\n/).filter(Boolean); const head = lines[0]!.split(','); return lines.slice(1).map((l) => { const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')); return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])); }); };
const sources = parseCsv(readFileSync(`${inventoryDir}/sources.csv`, 'utf8'));
const p = new PrismaClient({ log: [] });
try {
  const db: any = await p.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const runs: any[] = await tx.$queryRaw`SELECT id, command, status, revision, "startedAt", "finishedAt" FROM "PipelineRun" ORDER BY "startedAt" DESC`;
    const lastSourceRun: any[] = await tx.$queryRaw`SELECT DISTINCT ON ("sourceKey") "sourceKey", status, fetched, accepted, "declaredTotal", complete, truncated, errors, note, "ranAt" FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC`;
    const rejected: any[] = await tx.$queryRaw`SELECT e."sourceKey", e.event, SUM(COALESCE((e.payload->>'count')::int, 1))::int n, MAX(e.at) last FROM "PipelineEvent" e WHERE e.event IN ('source.rows_rejected','job.publication_held','job.write_failed') AND e.at >= now() - interval '7 days' GROUP BY 1,2`;
    const review: any[] = await tx.$queryRaw`SELECT "sourceKey", COUNT(*)::int n FROM "EmployerObservation" WHERE rule='REVIEW_REQUIRED' AND "observedAt" >= now() - interval '7 days' GROUP BY 1`;
    const scope: any[] = await tx.$queryRaw`SELECT "sourceKey", verdict, COUNT(*)::int n FROM "PostingScopeDecision" GROUP BY 1,2`;
    const companies: any[] = await tx.$queryRaw`SELECT js."sourceKey", c.id, c.name, COUNT(*)::int n FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" JOIN "Company" c ON c.id=j."companyId" WHERE js."isActive" AND j."isActive" GROUP BY 1,2,3`;
    // Attribution proven = the LATEST identity observation of every active representation of the source is a reviewed decision
    // (REVIEWED_ALIAS, REVIEWED_MERGE, CERTIFIED_SINGLE_BRAND_PORTAL, GROUP_LABEL_KEPT_HOUSE); LEGACY_UNREVIEWED is a historical assignment, not a proof.
    const attribution: any[] = await tx.$queryRaw`SELECT o."sourceKey", o.rule, COUNT(*)::int n FROM (SELECT DISTINCT ON (eo."sourceKey", eo."externalId") eo."sourceKey", eo."externalId", eo.rule FROM "EmployerObservation" eo JOIN "JobSource" js ON js."sourceKey"=eo."sourceKey" AND js."externalId"=eo."externalId" JOIN "Job" j ON j.id=js."jobId" WHERE js."isActive" AND j."isActive" ORDER BY eo."sourceKey", eo."externalId", eo."observedAt" DESC, eo.id DESC) o GROUP BY 1,2`;
    return { runs, lastSourceRun, rejected, review, scope, companies, attribution };
  });
  const runFor = (at: Date) => db.runs.find((r: any) => new Date(r.startedAt) <= at && (!r.finishedAt || new Date(r.finishedAt) >= new Date(at.getTime() - 60_000)));
  const apiTotals = new Map<string, number | null>();
  if (API) {
    const names = [...new Set(db.companies.map((c: any) => c.name))] as string[];
    for (let i = 0; i < names.length; i += 4) await Promise.all(names.slice(i, i + 4).map(async (name) => { const t = await fetch(`https://modecareers.com/api/jobs?maison=${encodeURIComponent(name)}&limit=1&_=${Date.now()}`, { headers: { 'cache-control': 'no-cache', 'user-agent': 'Mozilla/5.0 final-table' } }).then((x) => x.json()).then((d: any) => d.total as number).catch(() => null); apiTotals.set(name, t); }));
  }
  const companyActive = new Map<string, number>(); for (const c of db.companies) companyActive.set(c.name, (companyActive.get(c.name) ?? 0) + 0);
  const dbActiveByCompany: any[] = API ? await p.$queryRaw`SELECT c.name, COUNT(*)::int n FROM "Job" j JOIN "Company" c ON c.id=j."companyId" WHERE j."isActive" GROUP BY 1` : [];
  for (const r of dbActiveByCompany) companyActive.set(r.name, r.n);
  const stateRows: any[] = [];
  const rows = sources.filter((s) => s.status === 'ACTIVE' || s.status === 'PAUSED').sort((a, b) => Number(b.activePostings) - Number(a.activePostings) || a.sourceKey.localeCompare(b.sourceKey)).map((s) => {
    const run = db.lastSourceRun.find((r: any) => r.sourceKey === s.sourceKey);
    const pr = run ? runFor(new Date(run.ranAt)) : null;
    const rej = db.rejected.filter((r: any) => r.sourceKey === s.sourceKey).map((r: any) => `${r.event.replace(/^(source|job)\./, '')} ${r.n}`);
    const rev = db.review.find((r: any) => r.sourceKey === s.sourceKey)?.n ?? 0; if (rev) rej.push(`identité à revoir ${rev}`);
    const sc = db.scope.filter((r: any) => r.sourceKey === s.sourceKey).map((r: any) => `${r.verdict} ${r.n}`); if (sc.length) rej.push(`périmètre : ${sc.join(', ')}`);
    if (run?.errors) rej.push(`erreurs run ${run.errors}`);
    const fed = db.companies.filter((c: any) => c.sourceKey === s.sourceKey).sort((a: any, b: any) => b.n - a.n);
    const pub = fed.map((c: any) => `${c.name} ${c.n}`).slice(0, 4).join(', ') + (fed.length > 4 ? ` (+${fed.length - 4})` : '');
    const parity: string[] = API ? fed.map((c: any) => { const api = apiTotals.get(c.name); const dbn = companyActive.get(c.name); return api == null ? 'API ?' : api === dbn ? 'oui' : `NON (${dbn}/${api})`; }) : [];
    const parityText = API ? (parity.every((x) => x === 'oui') ? 'front = BDD' : parity.filter((x) => x !== 'oui').join(' ')) : 'parité non relue ici';
    const identity = s.identity.startsWith('CERTIFIED') ? `certifiée (${s.scope || 'sans périmètre'}, ${s.reviewedAt.slice(0, 10)})` : s.identity.startsWith('REVIEW_NOT_CURRENT') ? `revue non courante` : 'héritée, non certifiée';
    // The five states an aggregator must keep apart (review of 2026-09-10): official source confirmed · operational collection · exhaustive
    // collection proven · employer attribution proven · publication verified. A source can be operational with an explicit gap without being exhaustive.
    const att = db.attribution.filter((a: any) => a.sourceKey === s.sourceKey); const attTotal = att.reduce((n: number, a: any) => n + a.n, 0); const attProven = att.filter((a: any) => ['REVIEWED_ALIAS', 'REVIEWED_MERGE', 'CERTIFIED_SINGLE_BRAND_PORTAL', 'GROUP_LABEL_KEPT_HOUSE'].includes(a.rule)).reduce((n: number, a: any) => n + a.n, 0);
    const states = {
      official: s.identity.startsWith('CERTIFIED'),
      operational: !!run && ['OK', 'NEW', 'DEGRADED'].includes(run.status) && Number(s.activePostings) > 0,
      exhaustive: s.verdict.startsWith('PROVEN_BY_DECLARED_TOTAL') && !s.verdict.includes('ATTESTATION_WITHHELD'),
      attribution: attTotal > 0 && attProven === attTotal ? 'proven' : attTotal > 0 ? `${Math.round(100 * attProven / attTotal)} %` : 'no observation',
      published: API ? (fed.length > 0 && parity.every((x) => x === 'oui')) : null,
    };
    stateRows.push({ key: s.sourceKey, ...states, attributionRatio: attTotal ? attProven / attTotal : 0 });
    const collecte = run ? `${run.status} ${run.ranAt.toISOString().slice(0, 10)} : ${run.fetched ?? 'n/d'} lues${run.declaredTotal != null ? ` / ${run.declaredTotal} annoncées` : ''}${run.truncated ? ', tronquée' : ''} · ${s.verdict}` : `aucun run · ${s.verdict}`;
    const restant = [s.identity.startsWith('CERTIFIED') ? null : 'certifier la configuration', s.verdict.includes('PRODUCTION_RUN_DUE') ? 'run de production à rejouer' : null, s.verdict.startsWith('NOT_PROVEN') ? 'complétude à prouver' : null, s.verdict.startsWith('INCOMPLETE_EXPLAINED') ? 'écart expliqué, non résorbé' : null, rej.length ? 'écarts à traiter' : null, 'couverture mondiale de l\'acteur non prouvée par ce flux'].filter(Boolean).join(' ; ');
    return `| ${fed.map((c: any) => c.name).slice(0, 2).join(' / ') || s.maison} | ${s.sourceKey} (${s.kind}${s.status === 'PAUSED' ? ', PAUSED' : ''}) | ${[states.official ? 'officielle ✓' : 'officielle ✗', states.operational ? 'opérationnelle ✓' : 'opérationnelle ✗', states.exhaustive ? 'exhaustive ✓' : 'exhaustive ✗', `attribution ${states.attribution === 'proven' ? '✓' : states.attribution}`, states.published === null ? 'publication non relue' : states.published ? 'publication ✓' : 'publication ✗'].join(' · ')} | ${identity} | ${s.scope || '—'} | ${collecte} | ${rej.join(' ; ') || 'aucun sur 7 j'} | ${s.activePostings} actives : ${pub || '—'} | ${pr ? pr.revision.slice(0, 7) : run ? 'non enregistré (run antérieur à PipelineRun)' : '—'} | ${pr ? `${pr.status} ${(pr.finishedAt ?? pr.startedAt).toISOString().slice(0, 16)}Z` : run ? `run ${run.ranAt.toISOString().slice(0, 10)} hors registre` : '—'} | ${parityText} | ${restant} |`;
  });
  const md = [`# LOT 4 — tableau final par source (généré le ${new Date().toISOString().slice(0, 16)}Z, ${rows.length} sources ACTIVE/PAUSED)`, '', 'Généré par `apps/aggregator/scripts/coverage/final-table.mts` depuis la base de production (lecture seule) et l\'inventaire unique. Une ligne = une source ; « Acteur » = les sociétés réellement créditées par la source (une source peut en nourrir plusieurs). « Commit » / « Déploiement » = la révision et l\'état du run de pipeline qui a écrit la source en dernier. Aucune ligne ne prouve la couverture mondiale de l\'acteur.', '',
    '| Acteur | Source | Cinq états | Identité | Périmètre | Collecte | Rejets/blocages | Publication | Commit | Déploiement | Preuve prod | Restant |', '|---|---|---|---|---|---|---|---|---|---|---|---|', ...rows].join('\n');
  const count = (f: (r: any) => boolean) => stateRows.filter(f).length;
  const summary = ['', '## Les cinq états, sur les sources ACTIVE/PAUSED', '', '| État | Sources | Part |', '|---|---:|---:|',
    `| Source officielle confirmée (identité certifiée, configuration courante) | ${count((r) => r.official)} | ${Math.round(100 * count((r) => r.official) / stateRows.length)} % |`,
    `| Collecte opérationnelle (dernier run OK/NEW/DEGRADED, offres actives) | ${count((r) => r.operational)} | ${Math.round(100 * count((r) => r.operational) / stateRows.length)} % |`,
    `| Collecte exhaustive prouvée en production (annoncées = lues, attestation non retenue) | ${count((r) => r.exhaustive)} | ${Math.round(100 * count((r) => r.exhaustive) / stateRows.length)} % |`,
    `| Attribution employeur prouvée (100 % des représentations actives sous une décision revue) | ${count((r) => r.attribution === 'proven')} | ${Math.round(100 * count((r) => r.attribution === 'proven') / stateRows.length)} % |`,
    `| Publication vérifiée (API publique = base pour chaque société nourrie)${API ? '' : ' — non relue dans cette génération'} | ${API ? count((r) => r.published) : '—'} | ${API ? Math.round(100 * count((r) => r.published) / stateRows.length) + ' %' : '—'} |`,
    `| Les cinq à la fois | ${count((r) => r.official && r.operational && r.exhaustive && r.attribution === 'proven' && (API ? r.published : true))} | — |`, ''].join('\n');
  const mdWithSummary = md.replace('\n| Acteur | Source |', summary + '\n| Acteur | Source |');
  writeFileSync(outFile, mdWithSummary + '\n');
  console.log(`${rows.length} rows → ${outFile}`);
} finally { await p.$disconnect(); }
