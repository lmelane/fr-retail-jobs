// Mesure F1 (audit sécurité 14/09/2026, finding H1/H2) — lecture seule.
// Combien d'offres actives portent une URL de candidature hors http(s) ?
// Quels index couvrent city / location (coût du paramètre `lieu`) ?
// Usage : DATABASE_URL=... node apps/api/scripts/mesure-f1-url-candidature.mjs
import { prisma } from "@catwalks/db";

const actives = await prisma.job.count({ where: { isActive: true } });
const nonHttp = await prisma.job.count({ where: { isActive: true, NOT: { url: { startsWith: "http" } } } });
const exemples = await prisma.job.findMany({
  where: { isActive: true, NOT: { url: { startsWith: "http" } } },
  select: { url: true, source: true },
  take: 5,
});
const index = await prisma.$queryRaw`
  SELECT indexname, indexdef FROM pg_indexes
  WHERE tablename = 'Job' AND (indexdef ILIKE '%(city%' OR indexdef ILIKE '%location%' OR indexdef ILIKE '%searchText%')`;
console.log(JSON.stringify({ actives, nonHttp, exemples: exemples.map((e) => ({ source: e.source, url: e.url.slice(0, 80) })), index }, null, 1));
await prisma.$disconnect();
