/**
 * QUELS ATS SERVENT US / AU / CH, ET QUE PORTENT-ILS VRAIMENT ?
 *
 * Doute du CEO le 15/09/2026 : « regarde le chemin, le raw original de
 * l'extraction, ou l'ATS du pays, tu vas voir. »
 *
 * Une couverture basse peut venir de DEUX causes opposées :
 *   · le marché ne PUBLIE pas l'expérience (constat métier) ;
 *   · nos connecteurs ne la LISENT pas (défaut de notre côté).
 * Seule la ventilation par ATS les distingue.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const CLES = ['experienceLevel','requiredExperience','requiredExperienceFilter',
  'experience_level_minimum','experienceRequired','workExperience','experience_code',
  'experience_min','experience_max','careerLevel','experience','seniority','yearsOfExperience'];
const clause = CLES.map((k) => `(j.raw -> '${k}') IS NOT NULL`).join(' OR ');

for (const pays of ['US', 'AU', 'CH']) {
  const r = await prisma.$queryRawUnsafe(`
    SELECT j.source, count(*)::int AS actives,
           count(*) FILTER (WHERE ${clause})::int AS declaree,
           count(*) FILTER (WHERE j.raw IS NULL)::int AS sans_raw
    FROM "Job" j
    WHERE j."isActive" = true AND j."countryCode" = '${pays}'
    GROUP BY j.source ORDER BY actives DESC LIMIT 8
  `);
  console.log(`\n=== ${pays} ===`);
  for (const l of r) {
    const pct = l.actives ? (l.declaree / l.actives * 100).toFixed(1) : '0.0';
    console.log(`${String(l.actives).padStart(6)} | declaree ${String(l.declaree).padStart(5)} (${pct}%) | sans raw ${l.sans_raw} | ${l.source}`);
  }
}
await prisma.$disconnect();
