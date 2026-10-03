/**
 * D-522 §6 : knitwell-us-retail lue en direct avec le lecteur de ce worktree (r6 + correctifs du groupe « familles »),
 * LISTE SEULE (aucune fiche, aucune base, aucune écriture) : pages de liste Workday et comptes par facette. Dit si la
 * liste passe prouvée, et ce que deviennent les lignes sans chemin.
 *   cd apps/aggregator && npx tsx ../../audits/2026-10-03/stock-exceptions/knitwell-us-retail/liste-r6.mts \
 *     > ../../audits/2026-10-03/stock-exceptions/knitwell-us-retail/liste-r6.out
 */
import { fetchWorkdayJobs } from '../../../../apps/aggregator/src/ats/adapters/workday.js';
import { normalizeAdapterResult } from '../../../../apps/aggregator/src/ats/index.js';
import { PROVING_TERMINATIONS } from '../../../../apps/aggregator/src/pipeline/refreshPlan.js';
const started = Date.now();
const raw = await fetchWorkdayJobs({ site: 'US_Retail_Jobs', origin: 'https://knitwellgroup.wd1.myworkdayjobs.com', tenant: 'knitwellgroup', withDescriptions: false });
const r = normalizeAdapterResult(raw);
const e = r.enumeration!;
console.log(JSON.stringify({ at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), requests: e.pages,
  adapterComplete: raw.complete, normalizedComplete: r.complete ?? null, verdict: r.enumerationVerdict, termination: e.termination,
  proving: !!e.termination && PROVING_TERMINATIONS.has(e.termination), declaredTotal: r.declaredTotal, jobs: r.jobs.length,
  canonicalAbsenceProofUsable: e.canonicalAbsenceProofUsable, issues: e.issues,
  coveringFacet: e.pageEvidence?.find(p => p.url.includes('#coveringFacet='))?.componentCounters,
  rowsWithoutPath: (r.rejectedRows ?? []).filter(x => x.reason === 'ROW_WITHOUT_EXTERNAL_PATH').map(x => x.raw) }, null, 1));
