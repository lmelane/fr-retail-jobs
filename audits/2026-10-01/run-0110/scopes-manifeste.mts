/** Lecture seule : périmètres (`enumeration.scopes`) et pages (offset, total, nb d'ids) d'une capture. Usage : tsx scopes-manifeste.mts <captureBatchId>… */
import { PrismaClient } from '@prisma/client';
import { readExtractionManifest } from '../../../apps/aggregator/src/capture/manifest.js';

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
for (const id of process.argv.slice(2)) {
  const m = await readExtractionManifest(p, id);
  const e = (m.metadata as { enumeration?: Record<string, unknown> }).enumeration ?? {};
  console.log(`== ${id} jobs=${m.outputs.length} termination=${e.termination} pages=${e.pages} rawCount=${e.rawCount}`);
  console.log('scopes', JSON.stringify(e.scopes ?? null));
  const pages = (e.pageEvidence ?? []) as { url: string; offset?: number; pagination?: { total?: number; start?: number; end?: number }; ids?: string[] }[];
  for (const page of pages.slice(0, 400)) console.log(`  off=${page.offset} total=${page.pagination?.total ?? '-'} [${page.pagination?.start ?? ''}-${page.pagination?.end ?? ''}] ids=${page.ids?.length ?? '-'} first=${page.ids?.[0] ?? ''} last=${page.ids?.at(-1) ?? ''} ${page.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}`);
}
await p.$disconnect();
