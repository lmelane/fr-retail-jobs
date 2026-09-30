/**
 * LES CHUTES DE VOLUME (« X % d'offres en moins ») DES RUN RÉCENTS, ET CE QUE L'ÉDITEUR ANNONÇAIT — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/mesures/chutes-de-volume.mts [--depuis=2026-09-20]
 *
 * `health.ts` classe DEGRADED (bloquant) toute source dont le volume tombe sous la moitié du run précédent. Ce
 * programme rend chaque occurrence depuis `--depuis`, avec le total annoncé par l'éditeur au run de la chute et au run
 * précédent, et ce que la source a rendu au run SUIVANT : une chute que le compteur de l'éditeur accompagne et que le
 * run suivant confirme est un retrait chez l'éditeur ; une chute sans compteur, ou suivie d'un retour, est à
 * instruire. N'écrit rien.
 */
import { PrismaClient } from '@prisma/client';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const depuis = arg('depuis') ?? '2026-09-20';
const prisma = new PrismaClient({ log: [] });
try {
  const rows = await prisma.$queryRawUnsafe<{ sourceKey: string; ranAt: Date; jobs: number; previousJobs: number | null; fetched: number | null;
    declaredTotal: number | null; complete: boolean | null; prevDeclared: number | null; nextJobs: number | null; nextStatus: string | null; nextAt: Date | null }[]>(`
    SELECT r."sourceKey", r."ranAt", r.jobs, r."previousJobs", r.fetched, r."declaredTotal", r.complete,
           p."declaredTotal" AS "prevDeclared", n.jobs AS "nextJobs", n.status AS "nextStatus", n."ranAt" AS "nextAt"
      FROM "SourceRun" r
      LEFT JOIN LATERAL (SELECT "declaredTotal" FROM "SourceRun" x WHERE x."sourceKey" = r."sourceKey" AND x."ranAt" < r."ranAt" AND x.jobs > 0
                          ORDER BY x."ranAt" DESC LIMIT 1) p ON true
      LEFT JOIN LATERAL (SELECT jobs, status, "ranAt" FROM "SourceRun" x WHERE x."sourceKey" = r."sourceKey" AND x."ranAt" > r."ranAt"
                          ORDER BY x."ranAt" LIMIT 1) n ON true
     WHERE r."ranAt" >= $1::timestamp AND r.note LIKE '%d’offres en moins%'
     ORDER BY r."ranAt"`, depuis);
  const lignes = rows.map((row) => ({
    source: row.sourceKey, a: row.ranAt.toISOString().slice(0, 16), avant: row.previousJobs, apres: row.jobs,
    totalAnnonceAvant: row.prevDeclared, totalAnnonceApres: row.declaredTotal, parcoursComplet: row.complete,
    compteurDeLEditeurSuit: row.prevDeclared != null && row.declaredTotal != null && row.previousJobs != null && row.previousJobs > 0 &&
      row.declaredTotal < row.prevDeclared * 0.5,
    suivant: row.nextAt ? { a: row.nextAt.toISOString().slice(0, 16), offres: row.nextJobs, statut: row.nextStatus } : null,
  }));
  console.log(JSON.stringify({ depuis, chutes: lignes.length,
    avecCompteurQuiSuit: lignes.filter((l) => l.compteurDeLEditeurSuit).length,
    sansCompteur: lignes.filter((l) => l.totalAnnonceApres == null).length, lignes }, null, 1));
} finally {
  await prisma.$disconnect();
}
