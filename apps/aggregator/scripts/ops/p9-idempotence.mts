/**
 * L'IDEMPOTENCE quand le publieur pagine de façon INSTABLE.
 *
 * Exiger deux ensembles observés strictement identiques serait un faux critère ici : Hugo Boss et Skechers
 * servent un sous-ensemble différent à chaque passage (77 doublons inter-pages mesurés sur 784 lignes). Une
 * source qui rend de nouvelles annonces entre deux passages n'est pas non plus un « no-op ».
 *
 * Ce qui DOIT tenir, en revanche, ne souffre aucune exception :
 *   · un même identifiant ne produit jamais deux JobSource ;
 *   · un même identifiant ne produit jamais deux Jobs ;
 *   · aucune offre n'est fermée parce que le second passage ne l'a pas revue — l'énumération n'étant pas
 *     prouvée, une absence ne prouve rien (P7).
 *
 * usage: db.py readonly npx tsx scripts/ops/p9-idempotence.mts --before=<f.json> --cutoff=<iso>
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const before = JSON.parse(readFileSync(arg('before')!, 'utf8'));
const cutoff = new Date(arg('cutoff')!);
const p = new PrismaClient();

for (const key of Object.keys(before.sets)) {
  const prev = new Map<string, string>(before.sets[key].map((x: any) => [x.id, x.seen]));
  const now = await p.jobSource.findMany({ where: { sourceKey: key }, select: { externalId: true, lastSeenAt: true, job: { select: { isActive: true } } } });

  const nowIds = new Set(now.map((r) => r.externalId));
  const revus = now.filter((r) => r.lastSeenAt && r.lastSeenAt > cutoff).length;
  const apparus = now.filter((r) => !prev.has(r.externalId)).length;
  const nonRevus = [...prev.keys()].filter((id) => {
    const row = now.find((r) => r.externalId === id);
    return row && (!row.lastSeenAt || row.lastSeenAt <= cutoff);
  });
  const disparus = [...prev.keys()].filter((id) => !nowIds.has(id));

  // LES INVARIANTS — un échec ici est un défaut, pas une variation du publieur.
  const dupJobSource: any[] = await p.$queryRawUnsafe(
    `SELECT count(*)::int n FROM (SELECT "externalId" FROM "JobSource" WHERE "sourceKey"=$1
      GROUP BY "externalId" HAVING count(*) > 1) t`, key);
  const dupJob: any[] = await p.$queryRawUnsafe(
    `SELECT count(*)::int n FROM (SELECT js."externalId" FROM "JobSource" js
      WHERE js."sourceKey"=$1 GROUP BY js."externalId" HAVING count(DISTINCT js."jobId") > 1) t`, key);
  const fermees = now.filter((r) => !r.job.isActive && (!r.lastSeenAt || r.lastSeenAt <= cutoff)).length;

  console.log(JSON.stringify({
    source: key,
    avant: prev.size, apres: now.length,
    revusParLeSecondPassage: revus, apparusAuSecond: apparus,
    nonRevusMaisCONSERVES: nonRevus.length, disparusDeLaBase: disparus.length,
    INVARIANTS: {
      doublonsJobSource: dupJobSource[0].n,
      identifiantsSurPlusieursJobs: dupJob[0].n,
      fermeesParAbsence: fermees,
    },
  }, null, 1));
}
await p.$disconnect();
