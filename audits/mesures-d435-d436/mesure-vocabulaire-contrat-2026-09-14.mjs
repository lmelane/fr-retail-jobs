/**
 * MESURE — le vocabulaire réel du champ `contract_type` chez WTTJ et Hermès.
 *
 * LECTURE SEULE : uniquement des agrégats `SELECT`. Aucune écriture.
 *
 * Pourquoi ce script existe. L'audit « US source-to-canonical gap » du
 * 14/09/2026 a trouvé 111 offres où `contract_type: "full_time"` est rangé
 * dans le RYTHME alors que, dans le vocabulaire WTTJ, ce champ porte la
 * DURÉE : chez eux « full_time » désigne l'emploi permanent, pas l'horaire.
 *
 * Avant de corriger, il faut connaître TOUTES les valeurs que ce champ prend
 * réellement, et combien d'offres chacune concerne — sinon on corrige un cas
 * et on en casse trois autres. Un chiffre qu'on ne peut pas recompter n'est
 * pas une preuve : ce script est rejouable.
 *
 *   node scripts/mesure-vocabulaire-contrat-2026-09-14.mjs
 *
 * `DB_URL` doit pointer le proxy TCP public (jamais le port applicatif).
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL;
if (!url) {
  console.error('DB_URL manquante.');
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

const lignes = await prisma.$queryRawUnsafe(`
  SELECT s."sourceKey"                                              AS source,
         s.raw->>'contract_type'                                    AS valeur,
         count(*)::int                                              AS offres,
         count(*) FILTER (WHERE j."employmentTerm" IS NOT NULL)::int AS avec_duree,
         count(*) FILTER (WHERE j."workTime" IS NOT NULL)::int       AS avec_rythme
    FROM "JobSource" s
    JOIN "Job" j ON j.id = s."jobId"
   WHERE s."sourceKey" IN ('wttj-sector', 'hermes')
     AND j."isActive"
     AND s.raw->>'contract_type' IS NOT NULL
   GROUP BY 1, 2
   ORDER BY 3 DESC
   LIMIT 30`);

console.log('\n  source           valeur                offres    durée   rythme');
console.log('  ' + '-'.repeat(66));
for (const l of lignes) {
  console.log(
    '  ' +
      String(l.source).padEnd(17) +
      String(l.valeur).padEnd(22) +
      String(l.offres).padStart(6) +
      String(l.avec_duree).padStart(9) +
      String(l.avec_rythme).padStart(9),
  );
}
console.log(
  '\n  Lecture : une valeur à « durée = 0 » alors qu\'elle NOMME une durée\n' +
    '  est une perte de captation. Une valeur à « rythme » rempli et\n' +
    '  « durée » vide peut être parfaitement correcte — elle ne dit qu\'un horaire.\n',
);

await prisma.$disconnect();
