/**
 * Mesure de l'écart entre le schéma AGRÉGATEUR (Railway) et ce que le
 * matching candidat exige (Catwalks/Neon). Lecture seule.
 * Usage : DATABASE_URL=... node apps/api/scripts/mesure-schema-canonique.mjs
 */
import { prisma } from '@catwalks/db';

const actives = await prisma.job.count({ where: { isActive: true } });

// Les axes que le matching candidat utilise réellement (préférences du profil).
const axes = {
  'métier (occupationCode)': { occupationCode: { not: null } },
  'séniorité': { seniority: { not: null } },
  'contrat (employmentTerm)': { employmentTerm: { not: null } },
  'temps de travail': { workTime: { not: null } },
  'télétravail (workplaceType)': { workplaceType: { not: null } },
  'ville': { city: { not: null } },
  'pays': { countryCode: { not: null } },
  'coordonnées (lat/long)': { latitude: { not: null } },
  'salaire structuré (min)': { salaryMin: { not: null } },
  'secteur (via Company)': { company: { sectorCodes: { isEmpty: false } } },
  'langue de l\'offre': { language: { not: null } },
  'description': { description: { not: null } },
};

const lignes = [];
for (const [nom, where] of Object.entries(axes)) {
  const n = await prisma.job.count({ where: { isActive: true, ...where } });
  lignes.push({ axe: nom, renseignées: n, taux: `${Math.round((n / actives) * 1000) / 10} %` });
}
console.log(`Offres actives : ${actives.toLocaleString('fr-FR')}\n`);
console.table(lignes);

// Les valeurs réellement prises par les dimensions d'emploi (vocabulaire).
for (const champ of ['employmentTerm', 'workTime', 'workplaceType', 'seniority']) {
  const g = await prisma.job.groupBy({ by: [champ], where: { isActive: true }, _count: true, orderBy: { _count: { [champ]: 'desc' } }, take: 8 });
  console.log(`\n${champ} :`, g.map((x) => `${x[champ] ?? 'null'}=${x._count}`).join(' · '));
}
await prisma.$disconnect();
