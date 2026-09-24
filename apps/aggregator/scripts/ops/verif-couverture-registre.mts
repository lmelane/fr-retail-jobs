/** Couverture RAW actuelle par marché, en lecture seule.
 * Diagnostic des champs source, pas une décision d'exposition des filtres.
 * Le contrat produit est fixé par marches.ts ; l'API compte ses options en direct
 * dans l'union des offres agrégées et directes. Ce rapport mesure Job uniquement.
 * --ci vérifie la requête sur la base de test, même si elle est vide.
 */
import { PrismaClient } from '@prisma/client';
import { MARCHES } from '@catwalks/db/marches';
import { EXPRESSION_FACETTE, POPULATION_MESUREE, sqlCouverture } from '@catwalks/db/colonnes-facette';

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DB_URL ou DATABASE_URL requise');
const db = new PrismaClient({ datasources: { db: { url } } });
try {
  const dimensions = Object.keys(EXPRESSION_FACETTE) as Array<keyof typeof EXPRESSION_FACETTE>;
  // Valeurs exclusivement issues du registre versionné, jamais d’une entrée CLI.
  const valeurs = Object.values(MARCHES).map((m) => `('${m.code}', ARRAY[${m.pays.map((p) => `'${p}'`).join(',')}])`).join(',');
  const mesures = dimensions.map((d) => `${sqlCouverture(d)} AS "${d}"`).join(',');
  const lignes = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRawUnsafe<Array<Record<string, string | number>>>(`
      WITH marches(code, pays) AS (VALUES ${valeurs})
      SELECT marches.code, count(*)::int AS offres, ${mesures}
      FROM "${POPULATION_MESUREE.table}" JOIN marches ON "countryCode" = ANY(marches.pays)
      WHERE ${POPULATION_MESUREE.filtre} GROUP BY marches.code ORDER BY marches.code`);
  });
  console.log(JSON.stringify({ population: 'Job actif uniquement, hors DirectOffer', politiqueFiltres: 'explicite, indépendante des taux', mesures: lignes }, null, 2));
  if (!lignes.length && !process.argv.includes('--ci')) throw new Error('Corpus vide : aucune couverture mesurable');
  if (!lignes.length) console.log('CI : requête exécutée ; aucune mesure de corpus sur une base vide.');
} finally {
  await db.$disconnect();
}
