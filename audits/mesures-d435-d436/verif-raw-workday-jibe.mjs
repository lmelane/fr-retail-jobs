/**
 * QUE CONTIENT LE `raw` DE WORKDAY / JIBE / SUCCESSFACTORS ?
 *
 * Ces connecteurs rendent 0,0 % d'expérience déclarée sur des dizaines de
 * milliers d'offres. Un ZÉRO ABSOLU ne se produit pas naturellement : soit la
 * source ne publie rien, soit notre extraction ne conserve pas le champ.
 * On ouvre donc le raw brut, sans supposer.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

for (const src of ['WORKDAY', 'JIBE', 'SUCCESSFACTORS', 'ICIMS']) {
  const r = await prisma.$queryRawUnsafe(`
    SELECT cle, count(*)::int AS n
    FROM "Job" j, LATERAL jsonb_object_keys(j.raw) AS cle
    WHERE j."isActive" = true AND j.source = '${src}' AND j.raw IS NOT NULL
    GROUP BY cle ORDER BY n DESC LIMIT 22
  `);
  console.log(`\n=== ${src} — clés de raw ===`);
  console.log(r.map((x) => `${x.cle}(${x.n})`).join('  '));
}
await prisma.$disconnect();
