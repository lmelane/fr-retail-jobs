/**
 * Lecture unique — ce qui change, octet par octet, entre la sortie de la qualification et celle de l'ingestion d'une
 * même offre, au RUN du 01/10 (complète `rejeu-compare.out`). LECTURE SEULE (accès d'audit vérifié).
 *   AUDIT_DATABASE_URL=… npx tsx audits/2026-10-02/lecture-unique/diff-sorties.mts 2026-10-01 ami-paris,caudalie,… > …/diff-sorties.out
 * Pour une offre par source : le premier écart entre les deux sorties sérialisées, avec 80 caractères de contexte.
 */
import { gunzipSync } from 'node:zlib';
import { ouvrirAccesAudit } from '../../../apps/aggregator/scripts/ops/audit-acces.ts';
const [day, list] = [process.argv[2] ?? '2026-10-01', process.argv[3] ?? 'ami-paris'];
const { prisma } = await ouvrirAccesAudit();
const [run] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "PipelineRun" WHERE command='ingest-all' AND "startedAt" >= ${new Date(day)}
  AND "startedAt" < ${new Date(new Date(day).getTime() + 86_400_000)} ORDER BY "startedAt" LIMIT 1`;
const text = async (hash: string) => gunzipSync((await prisma.rawBlob.findUniqueOrThrow({ where: { hash }, include: { body: true } })).body!.gzip).toString('utf8');
for (const key of list.split(',')) {
  const batches = await prisma.captureBatch.findMany({ where: { sourceKey: key, runId: run.id, purpose: 'JOBS' }, orderBy: { attemptOrdinal: 'asc' } });
  const [q, i] = [batches.find(b => !b.accessDecisionId)!, batches.find(b => b.accessDecisionId)!];
  const rows = (id: string) => prisma.sourceExtraction.findMany({ where: { batchId: id }, orderBy: { ordinal: 'asc' } });
  const [qr, ir] = await Promise.all([rows(q.id), rows(i.id)]);
  const pair = qr.map((row, n) => [row, ir.find(other => other.externalId === row.externalId)] as const).find(([a, b]) => b && a.outputHash !== b.outputHash);
  if (!pair) { console.log(`${key} : aucune sortie différente`); continue; }
  const [a, b] = await Promise.all([text(pair[0].outputHash), text(pair[1]!.outputHash)]);
  let at = 0; while (at < a.length && a[at] === b[at]) at++;
  const differing = qr.filter(row => ir.some(other => other.externalId === row.externalId && other.outputHash !== row.outputHash)).length;
  console.log(`## ${key} — ${differing}/${qr.length} sorties différentes ; offre ${pair[0].externalId}, premier écart au caractère ${at} sur ${a.length}/${b.length}`);
  console.log(`  qualification : …${JSON.stringify(a.slice(Math.max(0, at - 60), at + 80))}…`);
  console.log(`  ingestion     : …${JSON.stringify(b.slice(Math.max(0, at - 60), at + 80))}…`);
}
await prisma.$disconnect();
