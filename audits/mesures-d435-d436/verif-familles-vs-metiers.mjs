/**
 * LA FAMILLE TIENDRAIT-ELLE LE FILTRE LÀ OÙ LE MÉTIER NE TIENT PAS ?
 *
 * Arbitrage CEO du 15/09/2026, verbatim : « "Vente" large mais complet, très
 * clairement. Je préfère enlever des features que faire mal. »
 *
 * Le métier fin (`occupationCode`, 51 valeurs) couvre 25,7 % à 57,0 % selon le
 * marché : un candidat qui filtre perd la moitié du catalogue sans le savoir.
 * La famille (`jobFunction`, 26 valeurs) est la même information, d'un cran
 * plus grossière. Ce script mesure si elle tient, marché par marché.
 *
 * Il ne change RIEN : il mesure avant de proposer.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const SEUIL = 0.2;

const r = await prisma.$queryRawUnsafe(`
  SELECT "countryCode" AS marche, count(*)::int AS actives,
         count("occupationCode")::int AS metier,
         count("jobFunction")::int     AS famille
  FROM "Job"
  WHERE "isActive" = true
    AND "countryCode" IN ('US','FR','GB','CA','DE','IT','ES','NL','AU','CH','BE','CN')
  GROUP BY 1 ORDER BY actives DESC
`);

console.log('marche | actives | metier fin | famille | gain');
let tientMetier = 0, tientFamille = 0;
for (const l of r) {
  const m = l.metier / l.actives, f = l.famille / l.actives;
  if (m >= SEUIL) tientMetier += 1;
  if (f >= SEUIL) tientFamille += 1;
  console.log(
    `${l.marche} | ${String(l.actives).padStart(6)} | ${(m * 100).toFixed(1).padStart(5)} % | ` +
    `${(f * 100).toFixed(1).padStart(5)} % | +${((f - m) * 100).toFixed(1)} pts`,
  );
}
console.log(`\nmarches ou le METIER tient le seuil  : ${tientMetier} / ${r.length}`);
console.log(`marches ou la FAMILLE tient le seuil : ${tientFamille} / ${r.length}`);

const v = await prisma.$queryRawUnsafe(`
  SELECT count(DISTINCT "jobFunction")::int AS familles_utilisees,
         count(DISTINCT "occupationCode")::int AS metiers_utilises
  FROM "Job" WHERE "isActive" = true
`);
console.log(`\nvaleurs reellement portees : ${v[0].familles_utilisees} familles, ${v[0].metiers_utilises} metiers`);
await prisma.$disconnect();
