/**
 * LES FILTRES UNIVERSELS D'UN AGRÉGATEUR — ce que notre catalogue porte VRAIMENT.
 *
 * Constat du CEO le 15/09/2026, relevé sur Indeed FR/US/BE : les filtres qui
 * reviennent partout ne sont PAS le métier. Ce sont :
 *   salaire · télétravail · distance · type de contrat · secteur ·
 *   horaires · langue · niveau d'études · date de publication
 *
 * Et sa conclusion produit : « c'est dans "intitulé de poste, mots-clés ou
 * entreprise" que la magie opère. Vouloir trop serrer les offres, ce n'est pas
 * bon. »
 *
 * Ce script mesure la couverture de CES dimensions-là, seuil 0.2, par marché.
 * Il ne change rien.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const r = await prisma.$queryRawUnsafe(`
  SELECT "countryCode" AS marche, count(*)::int AS actives,
    count("salaryMin")::int                                   AS salaire,
    count("workplaceType")::int                                 AS teletravail,
    count("city")::int                                         AS ville,
    count(*) FILTER (WHERE latitude IS NOT NULL)::int           AS geoloc,
    count("employmentTerm")::int                               AS contrat,
    count("workTime")::int                                     AS rythme,
    count("language")::int                                     AS langue,
    count("educationLevel")::int                               AS etudes,
    count("postedAt")::int                                     AS date_pub,
    count("jobFunction")::int                                  AS famille
  FROM "Job"
  WHERE "isActive" = true
    AND "countryCode" IN ('US','FR','GB','CA','DE','IT','ES','NL','AU','CH','BE','CN')
  GROUP BY 1 ORDER BY actives DESC
`);

const DIMS = ['salaire','teletravail','ville','geoloc','contrat','rythme','langue','etudes','date_pub','famille'];
console.log('marche | actives | ' + DIMS.map(d => d.slice(0, 7).padStart(7)).join(' | '));
const tient = Object.fromEntries(DIMS.map(d => [d, 0]));
for (const l of r) {
  const cells = DIMS.map(d => {
    const p = l[d] / l.actives;
    if (p >= 0.2) tient[d] += 1;
    return `${(p * 100).toFixed(0)}%`.padStart(7);
  });
  console.log(`${l.marche} | ${String(l.actives).padStart(6)} | ${cells.join(' | ')}`);
}
console.log('\n--- sur combien de marches (sur 12) chaque dimension tient le seuil de 20 % ---');
for (const d of DIMS) console.log(`  ${d.padEnd(12)} ${tient[d]} / 12`);
await prisma.$disconnect();
