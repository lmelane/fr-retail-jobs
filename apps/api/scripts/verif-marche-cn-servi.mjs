/**
 * LES OFFRES CHINOISES SORTENT-ELLES VRAIMENT ? — la chaîne jusqu'au bout.
 *
 * « Ce qui entre doit pouvoir sortir. » Ce script interroge la base par le
 * MÊME prédicat que la recherche de l'API, plutôt que de relire le code et de
 * conclure qu'il a l'air correct.
 *
 * ── POURQUOI IL VIT DANS `apps/api` ET PAS DANS L'AGRÉGATEUR ──────────────
 *
 * Première version : écrite dans `apps/aggregator/scripts/ops/`, elle importait
 * `apps/api/lib/jobs.ts`. Le typecheck a REFUSÉ — « File is not under rootDir
 * apps/aggregator » — et il a eu raison : un script de l'agrégateur qui tire du
 * code de l'API crée exactement la dépendance croisée qui a déjà cassé le build
 * Docker une fois, le `Dockerfile` ne copiant pas les mêmes dossiers dans les
 * deux étages. Le script a donc changé de dépôt logique au lieu de changer la
 * configuration pour le faire passer.
 *
 * ── CE QU'IL VÉRIFIE, ET CE QU'IL NE PEUT PAS VÉRIFIER ────────────────────
 *
 * Il vérifie que les offres chinoises sont RENDUES et que leur contenu reste
 * NATIF. Il ne vérifie PAS le rendu de la page : cela se fait dans un
 * navigateur, et aucun script ne peut l'affirmer à sa place.
 *
 * Point de contrat à connaître, lu dans `jobs.ts` et non supposé : `marche` ne
 * filtre PAS les offres, il ne restreint que les FACETTES proposées. Les 1 224
 * offres chinoises étaient donc déjà servies avant l'ouverture du marché ;
 * celle-ci change ce qu'on propose comme filtres, pas ce qu'on rend.
 *
 * Lecture seule. Rejouable :
 *   DATABASE_URL=<proxy> node apps/api/scripts/verif-marche-cn-servi.mjs
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
try {
  const [c] = await p.$queryRaw`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE "title" ~ '[一-鿿]')::int AS titres_han,
           count(DISTINCT "city")::int AS villes
      FROM "Job" WHERE "isActive" AND "countryCode" = 'CN'`;

  console.log('=== LES OFFRES CHINOISES SONT-ELLES SERVIES ? ===');
  console.log('offres actives CN :', c.total);
  console.log('villes distinctes :', c.villes);
  console.log(`titres en caractères han : ${c.titres_han} / ${c.total}`);

  if (c.total === 0) {
    console.log('❌ AUCUNE OFFRE — la chaîne est fermée.');
  }

  /*
   * L'ÉCHANTILLON : le contenu doit sortir TEL QU'IL EST ENTRÉ. On ne traduit
   * jamais un titre, une description ni un nom d'entreprise — seuls les
   * libellés d'interface sont localisés. Un script qui ne compterait que les
   * offres ne verrait pas une régression de traduction.
   */
  const ech = await p.$queryRaw`
    SELECT j."title", j."city", c."name" AS entreprise
      FROM "Job" j JOIN "Company" c ON c."id" = j."companyId"
     WHERE j."isActive" AND j."countryCode" = 'CN' AND j."title" ~ '[一-鿿]'
     LIMIT 8`;
  console.log('\n— échantillon d’annonces en caractères chinois —');
  for (const r of ech) {
    console.log(`  ${String(r.title).slice(0, 52).padEnd(52)} | ${r.city ?? ''} | ${r.entreprise ?? ''}`);
  }

  /* Le cloisonnement : aucune offre non chinoise ne doit porter le pays CN. */
  const [fuite] = await p.$queryRaw`
    SELECT count(*)::int AS n FROM "Job"
     WHERE "isActive" AND "countryCode" = 'CN'
       AND "city" = ANY(ARRAY['Los Angeles','New York','Paris','London','Milan','Madrid','Berlin'])`;
  console.log(`\noffres CN portant une ville non chinoise : ${fuite.n} ${fuite.n === 0 ? '✅' : '❌ FUITE'}`);
} finally {
  await p.$disconnect();
}
