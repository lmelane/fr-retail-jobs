/**
 * D-520 §4 a : la liste COMPLÈTE de knitwell-us-retail, lue en direct avec le lecteur de ce lot, liste seule (aucune
 * fiche, aucune base, aucune écriture), pour partager les fermetures des fausses preuves entre « à tort » et « à bon
 * droit ». Hors fenêtre du RUN et hors RUN.
 *   cd apps/aggregator && npx tsx ../../audits/2026-10-02/preuve-facette-limite-knitwell/liste-knitwell.mts > ../../audits/2026-10-02/preuve-facette-limite-knitwell/liste-knitwell.json
 */
import { fetchWorkdayJobs } from '../../../apps/aggregator/src/ats/adapters/workday.js';
import { PROVING_TERMINATIONS } from '../../../apps/aggregator/src/pipeline/refreshPlan.js';
const started = Date.now();
const r = await fetchWorkdayJobs({ site: 'US_Retail_Jobs', origin: 'https://knitwellgroup.wd1.myworkdayjobs.com', tenant: 'knitwellgroup', withDescriptions: false });
const e = r.enumeration!;
const ids = r.jobs.map(j => j.externalId).sort();
console.log(JSON.stringify({ at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), complete: r.complete,
  proving: !!e.termination && PROVING_TERMINATIONS.has(e.termination), termination: e.termination, declaredTotal: r.declaredTotal,
  distinct: new Set(ids).size, canonicalAbsenceProofUsable: e.canonicalAbsenceProofUsable, issues: e.issues,
  coveringFacet: e.pageEvidence?.find(p => p.url.includes('#coveringFacet='))?.componentCounters, ids }, null, 1));
