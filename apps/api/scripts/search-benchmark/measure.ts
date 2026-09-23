import { createWriteStream, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { prisma } from '@catwalks/db';
import { perimetreDeRecherche } from '@catwalks/db/marches';
import { searchSummary } from '../../lib/job-search-query';
import { planifierRecherche } from '../../lib/search-plan';
import { getOccupationPresentation } from '../../lib/occupations';
import { snapshotModel, type SnapshotMetadata } from './model';
import { elasticsearch, enrichedPostgres } from './adapters';

export type BenchmarkIntention = {
  id: string; description: string; market: string; variants: string[];
  strata: string[]; split: 'development' | 'holdout';
};
async function main() {
  const [metadataFile, intentionsFile, output, engineList = 'baseline,postgres,elastic'] = process.argv.slice(2);
  const engines = engineList.split(',');
  if (!engines.length || engines.some(e => !['baseline', 'postgres', 'elastic'].includes(e))) throw new Error('Invalid engine selection');
  const metadata: SnapshotMetadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
  const intentions: BenchmarkIntention[] = JSON.parse(readFileSync(intentionsFile, 'utf8'));
  if (!intentions.length || new Set(intentions.map(i => i.id)).size !== intentions.length) throw new Error('Invalid intention IDs');
  const model = snapshotModel(metadata);
  // The public baseline's publication predicate is evaluated at the captured
  // transaction time. This clock is confined to this benchmark process.
  const RealDate = Date;
  const frozen = new RealDate(metadata.asOf).getTime();
  globalThis.Date = class extends RealDate {
    constructor(value?: string | number) { super(value ?? frozen); }
    static now() { return frozen; }
  } as DateConstructor;
  const presentation = await getOccupationPresentation();
  const out = createWriteStream(output, { flags: 'wx', mode: 0o600 });
  const finished = once(out, 'finish');
  let count = 0;
  for (const intention of intentions) {
    const scope = perimetreDeRecherche(intention.market, new Set([intention.market]));
    if (!scope) throw new Error(`Invalid market ${intention.market}`);
    for (const q of intention.variants) {
      const intent = model.resolver.resolve(q);
      // Rotate engine order; no engine always benefits from a colder host.
      for (let i = 0; i < engines.length; i++) {
        const engine = engines[(i + count) % engines.length];
        const started = performance.now();
        const result = engine === 'baseline'
          ? await searchSummary(planifierRecherche(scope, { q, filtres: {} }), null, 100, presentation).then(r => ({ ids: r.ids, total: r.total, elapsedMs: performance.now() - started }))
          : engine === 'postgres' ? await enrichedPostgres(intent, scope.pays, 100) : await elasticsearch(intent, scope.pays, 100);
        const row = { intentionId: intention.id, q, engine, intent, ...result,
          requestId: createHash('sha256').update(intention.id + '\0' + q + '\0' + engine).digest('hex').slice(0, 16) };
        if (!out.write(JSON.stringify(row) + '\n')) await once(out, 'drain');
      }
      count++;
    }
    console.log(JSON.stringify({ measured: intention.id, variants: count }));
  }
  out.end(); await finished;
  console.log(JSON.stringify({ complete: true, intentions: intentions.length, variants: count }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
