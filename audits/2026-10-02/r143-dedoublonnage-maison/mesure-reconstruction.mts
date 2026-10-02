/** R-143 §4 — la réparation peut-elle reconstruire les publications fusionnées ? recoverRetainedPublication sur l'échantillon
 * de `extraction-echantillon-reparation.sql` (8 fusions par motif). Rejouer : npx tsx …/mesure-reconstruction.mts <echantillon.jsonl> */
import { readFileSync } from 'node:fs';
import { recoverRetainedPublication } from '../../../apps/aggregator/src/publication/recovery.js';
const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
const out: Record<string, Record<string, number>> = {};
for (const r of rows) {
  const res = recoverRetainedPublication(r.kind, r.raw, { externalId: r.externalId, url: r.url, observedAt: new Date(r.lastSeenAt), config: r.config });
  const k = res.status === 'RECOVERABLE' ? 'RECOVERABLE' : `${res.status}:${(res as any).reason}`;
  (out[r.sourceKey] ??= {})[k] = ((out[r.sourceKey] ??= {})[k] ?? 0) + 1;
}
console.log(JSON.stringify(out, null, 2));
