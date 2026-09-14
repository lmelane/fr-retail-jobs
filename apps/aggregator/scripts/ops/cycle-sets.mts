/**
 * LES ENSEMBLES D'IDENTIFIANTS D'UN CYCLE — la seule façon de comparer deux cycles sans se mentir.
 *
 * Un cycle se juge par ENSEMBLES, jamais par cardinaux : une offre fermée à tort et une offre ajoutée se
 * compensent parfaitement dans un total (leçon P5). Ce programme capture donc, par source, l'identité de
 * chaque représentation et son état, pour qu'un second cycle puisse répondre à « lesquelles » et pas
 * seulement « combien ».
 *
 * Il sépare ce que le brief demande de distinguer :
 *   persistées   présentes en base, quel que soit leur état
 *   publiées     représentation active dont l'offre est active — ce que le candidat voit
 *   fermées      offre inactive : elle a été retirée du catalogue
 *   retenues     collectées et non publiées (revue d'identité, hors périmètre)
 *
 * usage: db.py readonly npx tsx scripts/ops/cycle-sets.mts --keys=a,b --out=<f.json>
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const keys = (arg('keys') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const out = arg('out');
if (!keys.length) { console.error('usage: cycle-sets.mts --keys=a,b --out=<f.json>'); process.exit(2); }

const p = new PrismaClient();
type Row = Record<string, any>;

const snapshot = await p.$transaction(async (tx) => {
  await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  const at = (await tx.$queryRawUnsafe<Row[]>('SELECT now() at'))[0].at;

  const rows = await tx.$queryRawUnsafe<Row[]>(
    /**
     * Les alias sont CITÉS. Postgres replie tout identifiant non cité en minuscules : `repActive` revient
     * `repactive`, et une lecture en camelCase rend alors `undefined` — donc « non publiée » pour chaque
     * ligne. Mesuré ici : `arcteryx` ressortait 0 publiée / 299 fermées alors que la base en compte 299
     * publiées. C'est le piège D56, et il ne produit aucune erreur : juste un résultat faux.
     */
    `SELECT js."sourceKey", js."externalId", js."isActive" AS "repActive", js."lastSeenAt", js."firstSeenAt",
            j."isActive" AS "jobActive", j."closedAt", j.id AS "jobId"
     FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
     WHERE js."sourceKey" = ANY($1)`, keys);

  const runs = await tx.$queryRawUnsafe<Row[]>(
    `SELECT DISTINCT ON ("sourceKey") "sourceKey", status, complete, "canAttestAbsence", "ranAt",
            fetched, accepted, "declaredTotal", errors
     FROM "SourceRun" WHERE "sourceKey" = ANY($1) ORDER BY "sourceKey", "ranAt" DESC`, keys);

  /** Les identifiants réellement OBSERVÉS au dernier run, corrélés par `runId` — jamais déduits. */
  const obs = await tx.$queryRawUnsafe<Row[]>(
    `SELECT DISTINCT ON (e."sourceKey") e."sourceKey", e."runId", e.payload
     FROM "PipelineEvent" e WHERE e.event = 'source.enumeration_observed' AND e."sourceKey" = ANY($1)
     ORDER BY e."sourceKey", e.at DESC`, keys);

  const parSource: Record<string, any> = {};
  for (const k of keys) {
    const mine = rows.filter((r) => r.sourceKey === k);
    const pages = obs.find((o) => o.sourceKey === k)?.payload?.enumeration?.pageEvidence ?? [];
    const observes = [...new Set(pages.flatMap((x: any) => x.ids ?? x.canonicalIds ?? []))];
    parSource[k] = {
      run: runs.find((r) => r.sourceKey === k) ?? null,
      observes,                                     // ce que le publieur a servi
      persistees: mine.map((r) => r.externalId),
      publiees: mine.filter((r) => r.repActive && r.jobActive).map((r) => r.externalId),
      fermees: mine.filter((r) => !r.jobActive).map((r) => r.externalId),
      // Un `jobId` par identifiant : c'est ce qui permettra de détecter une offre liée à DEUX Jobs.
      jobParIdentifiant: Object.fromEntries(mine.map((r) => [r.externalId, r.jobId])),
    };
  }
  return { at, keys, parSource };
});
await p.$disconnect();

const resume = Object.fromEntries(Object.entries(snapshot.parSource).map(([k, v]: [string, any]) => [k, {
  observes: v.observes.length, persistees: v.persistees.length,
  publiees: v.publiees.length, fermees: v.fermees.length,
  run: v.run ? { statut: v.run.status, complete: v.run.complete, peutAttester: v.run.canAttestAbsence,
                 servies: v.run.fetched, erreurs: v.run.errors } : null,
}]));

if (out) writeFileSync(out, JSON.stringify(snapshot, null, 1));
console.log(JSON.stringify({ at: snapshot.at, resume }, null, 1));
