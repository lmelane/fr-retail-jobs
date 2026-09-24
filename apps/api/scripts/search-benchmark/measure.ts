import { createWriteStream, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { prisma } from '@catwalks/db';
import { perimetreDeRecherche } from '@catwalks/db/marches';
import { snapshotModel, type SnapshotMetadata } from './model';
import { enrichedPostgres } from './adapters';

export type BenchmarkIntention = {
  id: string; description: string; market: string; variants: string[];
  strata: string[]; split: 'development' | 'holdout';
};
async function main() {
  const [metadataFile, intentionsFile, output, ...extra] = process.argv.slice(2);
  if (!output || extra.length) throw new Error('Expected metadata, intentions and output paths');
  const metadata: SnapshotMetadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
  const intentions: BenchmarkIntention[] = JSON.parse(readFileSync(intentionsFile, 'utf8'));
  if (!intentions.length || new Set(intentions.map(i => i.id)).size !== intentions.length) throw new Error('Invalid intention IDs');
  const model = snapshotModel(metadata);
  const out = createWriteStream(output, { flags: 'wx', mode: 0o600 });
  const finished = once(out, 'finish');
  let count = 0;
  for (const intention of intentions) {
    const scope = perimetreDeRecherche(intention.market, new Set([intention.market]));
    if (!scope) throw new Error(`Invalid market ${intention.market}`);
    for (const q of intention.variants) {
      const intent = model.resolver.resolve(q);
      const engine = 'postgres';
      const result = await enrichedPostgres(intent, scope.pays, 100);
      const row = { intentionId: intention.id, q, engine, intent, ...result,
        requestId: createHash('sha256').update(intention.id + '\0' + q + '\0' + engine).digest('hex').slice(0, 16) };
      if (!out.write(JSON.stringify(row) + '\n')) await once(out, 'drain');
      count++;
    }
    console.log(JSON.stringify({ measured: intention.id, variants: count }));
  }
  out.end(); await finished;
  console.log(JSON.stringify({ complete: true, intentions: intentions.length, variants: count }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
