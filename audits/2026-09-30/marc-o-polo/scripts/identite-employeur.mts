/**
 * MARC O'POLO (D-485) — L'EMPLOYEUR APRÈS LE CHANGEMENT DE LECTEUR, lecture seule.
 *
 *   PYTHONDONTWRITEBYTECODE=1 python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/2026-09-30/marc-o-polo/scripts/identite-employeur.mts
 *
 * Le lecteur générique lisait « Marc O’Polo » dans le JSON-LD de chaque fiche (`hiringOrganization`, une constante du
 * code du site) ; l'API du lecteur dédié ne nomme aucun employeur. Sans libellé natif, l'offre passe par le portail
 * certifié (`Source.portalScope`, `identity/resolve.ts`) : ce script dit si ce chemin aboutirait, et à quelle société,
 * pour les publications déjà en ligne (le résolveur refuse de remplacer un employeur déjà attribué).
 */
import { PrismaClient } from '@prisma/client';
import { sourceSubjectKey } from '../../../../apps/aggregator/src/connectors/sourceIdentity.js';

const KEY = 'marc-o-polo';
const prisma = new PrismaClient({ log: [] });
try {
  const [source] = await prisma.$queryRawUnsafe<Array<{ maison: string; portalScope: string | null }>>(
    `SELECT maison, "portalScope" FROM "Source" WHERE key = $1`, KEY);
  const ownerKey = sourceSubjectKey(source);
  const owner = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; mergedIntoId: string | null }>>(
    `SELECT id, name, "mergedIntoId" FROM "Company" WHERE "fashionjobsUrl" = $1`, `resolved:${ownerKey}`);
  const actuels = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; fashionjobsUrl: string | null; mergedIntoId: string | null; n: bigint }>>(
    `SELECT c.id, c.name, c."fashionjobsUrl", c."mergedIntoId", count(*) AS n FROM "JobSource" s JOIN "Job" j ON j.id = s."jobId"
       JOIN "Company" c ON c.id = j."companyId" WHERE s."sourceKey" = $1 AND s."isActive" GROUP BY c.id`, KEY);
  const alias = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*) AS n FROM "CompanyAlias" WHERE "sourceKey" = $1`, KEY);
  console.log(JSON.stringify({ portalScope: source.portalScope, maison: source.maison, ownerKey, proprietaire: owner,
    employeursActuels: actuels.map((c) => ({ ...c, n: Number(c.n) })), aliasDeLaSource: Number(alias[0].n),
    memeSociete: owner.length === 1 && actuels.length === 1 && owner[0].id === actuels[0].id }, null, 1));
} finally {
  await prisma.$disconnect();
}
