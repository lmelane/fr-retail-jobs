/**
 * D-514 §4 — sans base : ce que la garde de santé du RUN (`evaluateSourceHealth`, puis le classement de l'orchestrateur)
 * dirait de GANNI si la collecte d'ingestion du 01/10 avait vu les mêmes 20 postes que la capture de qualification
 * (10 listés sans annonce, 1 candidature spontanée, 9 publiés), le RUN précédent en ayant publié 20 pour 20 déclarés.
 * Puis la forme courante (28/09 : 1 poste sans annonce sur 21). Usage : npx tsx audits/2026-10-02/d514-talentrecruiter/sante-forme-0110.mts
 */
import { evaluateSourceHealth } from '../../../apps/aggregator/src/pipeline/health.js';
import { classifySourceRun } from '../../../apps/aggregator/src/pipeline/ingestOrchestrator.js';
import type { IngestStats } from '../../../apps/aggregator/src/pipeline/ingest.js';

const forme = (published: number, withdrawn: number, before: number) => {
  const held = withdrawn + 1, fetched = published + held;
  const stat: IngestStats = { source: 'ganni-talentrecruiter', complete: true, enumerationReading: 'PROVEN', fetched, inSector: published, france: 0,
    created: 0, merged: 0, updated: published, errors: 0, withDescription: published, withDate: published, withCountry: published, withUrl: published,
    declaredTotal: fetched, held, heldUnresolved: 0, heldReasons: { NATIVE_ADVERTISEMENT_WITHDRAWN: withdrawn, NATIVE_SPONTANEOUS_APPLICATION: 1 },
    captureBatchId: 'forme', completionReportHash: 'forme' } as IngestStats;
  const health = evaluateSourceHealth(stat, before, { fetched: before, accepted: before }, before);
  const { issues, incidents } = classifySourceRun([stat], [health]);
  return { published, withdrawn, before, status: health.status, finding: health.finding ?? null, note: health.note,
    issues: issues.map(i => `${i.origin}/${i.code}`), blocking: incidents.some(i => i.blocking) };
};
console.log(JSON.stringify(forme(9, 10, 20), null, 1));
console.log(JSON.stringify(forme(19, 1, 20), null, 1));
