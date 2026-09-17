/**
 * COMBIEN DE TITRES DISTINCTS FAUT-IL CLASSER, ET NON COMBIEN D'OFFRES ?
 *
 * Une classification se paie au TITRE, pas à l'offre : `occupationReviewQueue`
 * groupe déjà par `normalizedTitle`. Deux offres « Conseiller de Vente » ne se
 * classent qu'une fois.
 *
 * Ce chiffre décide si le coût d'une refonte est un sujet ou du bruit.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const r = await prisma.$queryRawUnsafe(`
  SELECT count(*)::int AS offres,
         count(DISTINCT lower(btrim(title)))::int AS titres_distincts,
         count(*) FILTER (WHERE "occupationCode" IS NULL)::int AS non_classees
  FROM "Job" WHERE "isActive" = true
`);
const { offres, titres_distincts, non_classees } = r[0];
console.log('offres actives     :', offres);
console.log('titres distincts   :', titres_distincts,
  `(${(titres_distincts / offres * 100).toFixed(1)} %)`);
console.log('non classees       :', non_classees,
  `(${(non_classees / offres * 100).toFixed(1)} %)`);

const t = await prisma.$queryRawUnsafe(`
  SELECT count(DISTINCT lower(btrim(title)))::int AS n
  FROM "Job" WHERE "isActive" = true AND "occupationCode" IS NULL
`);
console.log('titres distincts NON CLASSES :', t[0].n, '<- le vrai volume a traiter');
await prisma.$disconnect();
