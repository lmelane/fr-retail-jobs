/**
 * REJOUE L'EXTRACTION D'UNE SOURCE ET DIT CE QUE LA VALIDATION VERRAIT — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/rejouer-une-source.mts <clé>
 *
 * Quand une source échoue en CONTENT_MISSING alors que la capture ET le lecteur fonctionnent en
 * isolation, il faut voir ce que le REJEU produit réellement — le `job.raw` que
 * `sourceValidation` passe ensuite à `recoverRetainedPublication`. Raisonner sur le code ne dit
 * pas ce que l'exécution fait.
 */
import { PrismaClient } from '@prisma/client';
import { replayExtraction } from '../../src/capture/batch.js';
import { fetchAtsJobs } from '../../src/ats/index.js';
// La correspondance kind -> AtsType n'est PAS mécanique (`oraclehcm` -> ORACLE_HCM,
// `talentfunnel` -> TALENT_FUNNEL) : on emprunte la table du pipeline plutôt que d'en
// réinventer une qui divergerait. `sourceValidation.ts` emprunte exactement la même.
import { KIND_TO_ATS } from '../../src/ats/catalogKinds.js';
import { recoverRetainedPublication } from '../../src/publication/recovery.js';

const cle = process.argv[2];
if (!cle) { console.error('Usage : rejouer-une-source.mts <clé>'); process.exit(2); }
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });

const [src] = await prisma.$queryRawUnsafe<Array<{ kind: string; config: unknown }>>(
  `SELECT kind, config FROM "Source" WHERE key = $1`, cle);
const [batch] = await prisma.$queryRawUnsafe<Array<{ id: string; startedAt: Date }>>(
  `SELECT id, "startedAt" FROM "CaptureBatch" WHERE "sourceKey" = $1 AND purpose = 'JOBS'
    ORDER BY "startedAt" DESC LIMIT 1`, cle);
if (!src || !batch) { console.error('source ou lot absent'); process.exit(1); }
if (!KIND_TO_ATS[src.kind]) { console.error(`famille « ${src.kind} » hors table KIND_TO_ATS`); process.exit(1); }

console.log(`\n   ${cle} [${src.kind}] · lot ${batch.id.slice(0, 12)} · ${batch.startedAt.toISOString().slice(0, 19)}\n`);

const config = src.config as Record<string, unknown>;
const rejoue = await replayExtraction(prisma as never, batch.id, () => fetchAtsJobs(KIND_TO_ATS[src.kind]!, config));
console.log(`   rejeu : ${rejoue.jobs.length} offre(s)\n`);

const echantillon = rejoue.jobs.slice(0, 3);
for (const j of echantillon) {
  const raw = j.raw as Record<string, unknown> | undefined;
  console.log(`   ── ${j.externalId} · ${j.title?.slice(0, 50)}`);
  console.log(`      job.description : ${typeof j.description === 'string' ? `${j.description.length} car.` : 'absente'}`);
  console.log(`      raw.description : ${typeof raw?.description === 'string' ? `${raw.description.length} car.` : 'absente'}`);
  console.log(`      clés du raw     : ${raw ? Object.keys(raw).join(', ') : '—'}`);
  const r = recoverRetainedPublication(src.kind, j.raw, {
    externalId: j.externalId, url: j.url, observedAt: batch.startedAt, config });
  console.log(`      rejeu → ${r.status === 'RECOVERABLE' ? 'RECOVERABLE' : `REFUS : ${r.reason}`}\n`);
}

let ok = 0, refus: Record<string, number> = {};
for (const j of rejoue.jobs) {
  const r = recoverRetainedPublication(src.kind, j.raw, {
    externalId: j.externalId, url: j.url, observedAt: batch.startedAt, config });
  if (r.status === 'RECOVERABLE') ok++;
  else refus[r.reason] = (refus[r.reason] ?? 0) + 1;
}
console.log(`   VERDICT : ${ok} relisible(s) sur ${rejoue.jobs.length}`);
for (const [r, n] of Object.entries(refus)) console.log(`      ${r.padEnd(28)} ${n}`);
console.log('');
await prisma.$disconnect();
