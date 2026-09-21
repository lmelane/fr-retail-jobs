/**
 * LES RÉFÉRENCES `Company.identityReviewId` ORPHELINES — preuve, portée, impact.
 *
 * Découvertes le 2026-09-21 en copiant le référentiel : trois Maisons portent un
 * `identityReviewId` qui ne correspond à aucune ligne. La contrainte n'est pas revérifiée en
 * production (elle l'est à l'écriture, pas rétroactivement), mais elle bloque toute copie.
 */
import { ouvrirAccesAudit } from '../audit-acces.ts';
const { prisma } = await ouvrirAccesAudit();
const q = <T,>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

const orph = await q<{ id: string; name: string; ref: string; jobs: bigint }>(`
  SELECT c.id, c.name, c."identityReviewId" AS ref,
         (SELECT count(*) FROM "Job" j WHERE j."companyId" = c.id) AS jobs
    FROM "Company" c
   WHERE c."identityReviewId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "EmployerIdentityReview" e WHERE e.id = c."identityReviewId")
     AND NOT EXISTS (SELECT 1 FROM "SourceIdentityReview" s WHERE s.id = c."identityReviewId")
   ORDER BY 2`);

console.log(`═══ ${orph.length} RÉFÉRENCE(S) ORPHELINE(S) ═══\n`);
for (const o of orph)
  console.log(`  ${o.name.padEnd(28)} ref=${o.ref.padEnd(26)} offres rattachées=${o.jobs}`);

const [t] = await q<{ total: bigint; avec: bigint }>(
  `SELECT count(*) AS total, count("identityReviewId") AS avec FROM "Company"`);
console.log(`\n  sur ${t.total} Maisons, ${t.avec} portent une référence — dont ${orph.length} orpheline(s)`);
await prisma.$disconnect();
