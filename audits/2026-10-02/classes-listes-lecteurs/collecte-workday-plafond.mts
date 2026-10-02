/**
 * D-520, collecte locale RÉELLE et bornée d'une source Workday plafonnée, avec le lecteur de ce lot, liste seule
 * (`withDescriptions: false` : aucune fiche n'est lue, aucune écriture, aucune base). Une requête à la fois, par le
 * transport commun (politesse par hôte, en-têtes de la collecte).
 *   cd apps/aggregator && npx tsx ../../audits/2026-10-02/classes-listes-lecteurs/collecte-workday-plafond.mts knitwell-us-retail
 */
import { fetchWorkdayJobs } from '../../../apps/aggregator/src/ats/adapters/workday.js';
const SOURCES: Record<string, Record<string, unknown>> = {
  'knitwell-us-retail': { site: 'US_Retail_Jobs', origin: 'https://knitwellgroup.wd1.myworkdayjobs.com', tenant: 'knitwellgroup' },
};
const key = process.argv[2] ?? 'knitwell-us-retail';
const started = Date.now();
const r = await fetchWorkdayJobs({ ...SOURCES[key], withDescriptions: false });
const e = r.enumeration!;
console.log(JSON.stringify({ source: key, at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), jobs: r.jobs.length,
  distinct: new Set(r.jobs.map(j => j.externalId)).size, declaredTotal: r.declaredTotal, complete: r.complete, truncated: r.truncated,
  method: e.method, termination: e.termination, issues: e.issues, pages: e.pages, rawCount: e.rawCount,
  scopes: e.scopes?.map(s => `${s.scope} ${s.uniqueIds}/${s.declaredTotal} ${s.complete ? 'prouvé' : 'non prouvé'}`),
  coveringFacet: e.pageEvidence?.find(p => p.url.includes('#coveringFacet='))?.componentCounters,
  employerFromFacet: r.jobs.filter(j => j.company !== undefined).length }, null, 2));
