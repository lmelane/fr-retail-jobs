/**
 * COMBIEN DE TITRES FAUT-IL VRAIMENT TRAITER POUR COUVRIR LE CATALOGUE ?
 *
 * La question du CEO le 15/09/2026 : « faut passer une IA sur les 80K offres,
 * mais ensuite pour les nouvelles ? C'est un bordel. »
 *
 * Elle suppose un volume ingérable. Ce script le mesure : dans un catalogue
 * d'offres, quelques centaines d'intitulés couvrent l'essentiel, et la longue
 * traîne est faite de titres qui n'apparaissent qu'UNE fois.
 *
 * Si les 500 titres les plus fréquents couvrent la majorité des offres, alors
 * le problème n'est pas « 83 431 offres » mais « quelques centaines de titres,
 * puis un flux quotidien de quelques dizaines ».
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const r = await prisma.$queryRawUnsafe(`
  WITH t AS (
    SELECT lower(btrim(title)) AS titre, count(*)::int AS n
    FROM "Job" WHERE "isActive" = true GROUP BY 1
  ), rangs AS (
    SELECT titre, n, row_number() OVER (ORDER BY n DESC) AS rang,
           sum(n) OVER (ORDER BY n DESC ROWS UNBOUNDED PRECEDING) AS cumul
    FROM t
  )
  SELECT
    (SELECT sum(n) FROM t)::int                                   AS offres,
    (SELECT count(*) FROM t)::int                                 AS titres,
    (SELECT count(*) FROM t WHERE n = 1)::int                     AS titres_uniques,
    (SELECT max(cumul) FROM rangs WHERE rang <= 200)::int          AS couvert_200,
    (SELECT max(cumul) FROM rangs WHERE rang <= 500)::int          AS couvert_500,
    (SELECT max(cumul) FROM rangs WHERE rang <= 2000)::int         AS couvert_2000
`);
const x = r[0];
const pc = (v) => `${(v / x.offres * 100).toFixed(1)} %`;
console.log('offres actives          :', x.offres);
console.log('titres distincts        :', x.titres);
console.log('titres vus UNE seule fois:', x.titres_uniques,
  `(${(x.titres_uniques / x.titres * 100).toFixed(1)} % des titres)`);
console.log('--- couverture du CATALOGUE par les titres les plus frequents ---');
console.log('  top   200 titres ->', pc(x.couvert_200));
console.log('  top   500 titres ->', pc(x.couvert_500));
console.log('  top 2 000 titres ->', pc(x.couvert_2000));

const flux = await prisma.$queryRawUnsafe(`
  SELECT count(DISTINCT lower(btrim(title)))::int AS n
  FROM "Job" WHERE "isActive" = true AND "createdAt" > now() - interval '7 days'
`);
console.log('titres distincts arrives en 7 jours :', flux[0].n,
  `(~${Math.round(flux[0].n / 7)}/jour)`);
await prisma.$disconnect();
