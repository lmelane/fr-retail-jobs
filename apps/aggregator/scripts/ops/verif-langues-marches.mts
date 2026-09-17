/**
 * LA RÉPARTITION DES LANGUES sur les marchés multilingues — lecture seule.
 *
 * Sert à choisir `locales` et `localeParDefaut` côté site sur un chiffre et non
 * sur une intuition géographique. Le Canada et la Belgique sont officiellement
 * bilingues ; ce que le CATALOGUE publie réellement est une autre question, et
 * c'est celle-là qui décide de la langue servie par défaut.
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
try {
  const lignes = await p.$queryRaw<Array<{ code: string; language: string | null; n: bigint }>>`
    SELECT "countryCode" AS code, "language", count(*) AS n
      FROM "Job"
     WHERE "isActive" AND "countryCode" IN ('CA', 'BE', 'CH', 'NL', 'AU')
     GROUP BY "countryCode", "language"
     ORDER BY "countryCode", count(*) DESC`;
  console.log(JSON.stringify(lignes.map((r) => ({ ...r, n: Number(r.n) })), null, 1));
} finally {
  await p.$disconnect();
}
