/**
 * QUI VIENT D'ÊTRE QUALIFIÉ, ET QUI A ÉCHOUÉ — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/qualifiees-recemment.mts <cle1,cle2,…>
 *
 * La campagne écrit ses verdicts dans le conteneur, hors de portée. Mais une qualification
 * RÉUSSIE laisse une trace en base : une `SourceAccessDecision`. On compare donc, pour un lot de
 * clés donné, celles qui ont une décision fraîche et celles qui n'en ont pas — sans supposer la
 * raison de l'échec, qui demande le journal du conteneur.
 */
import { PrismaClient } from '@prisma/client';

const cles = (process.argv[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!cles.length) { console.error('Usage : qualifiees-recemment.mts <cle1,cle2,…>'); process.exit(2); }

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });

const rows = await prisma.$queryRawUnsafe<Array<{
  key: string; kind: string; verdict: string | null; checkedAt: Date | null;
  lastRunJobs: number | null; lastRunStatus: string | null; publiees: bigint;
}>>(`
  WITH derniere AS (
    SELECT DISTINCT ON ("sourceKey") "sourceKey", verdict, "checkedAt"
      FROM "SourceAccessDecision" ORDER BY "sourceKey", sequence DESC
  )
  SELECT s.key, s.kind, d.verdict, d."checkedAt", s."lastRunJobs", s."lastRunStatus",
         (SELECT count(*) FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId"
           WHERE js."sourceKey"=s.key AND j."isActive") AS publiees
    FROM "Source" s LEFT JOIN derniere d ON d."sourceKey"=s.key
   WHERE s.key = ANY($1::text[]) ORDER BY d."checkedAt" DESC NULLS LAST, s.key`, cles);

const avec = rows.filter((r) => r.verdict);
console.log(`\n── ${cles.length} clé(s) demandée(s) · ${avec.length} avec décision ──\n`);
for (const r of rows)
  console.log(`   ${r.key.padEnd(26)} ${r.kind.padEnd(28)} ${(r.verdict ?? 'AUCUNE').padEnd(16)} ${String(r.publiees).padStart(5)} offre(s)  ${r.checkedAt ? r.checkedAt.toISOString().slice(11, 16) : ''}`);

console.log('');
await prisma.$disconnect();
