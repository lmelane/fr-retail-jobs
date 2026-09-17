/**
 * TOUTES LES CLÉS DE `raw`, SANS LISTE PRÉALABLE.
 *
 * La mesure précédente cherchait 8 noms de champs choisis à l'avance. C'est
 * exactement le biais que le CEO a relevé le 15/09/2026 : « faut voir si dans
 * les schémas nous n'avons pas un champ qui correspond à seniority, c'est tout
 * l'enjeu, en fonction des pays ce n'est pas pareil. »
 *
 * Un ATS allemand peut écrire `berufserfahrung`, un espagnol `experiencia`, un
 * chinois `工作经验`. Une liste devinée ne les trouvera jamais.
 *
 * Ce script ÉNUMÈRE les clés présentes dans `raw` par marché, sans en supposer
 * aucune, puis laisse le filtrage à la lecture humaine.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const lignes = await prisma.$queryRawUnsafe(`
  SELECT cle, count(*)::int AS n,
         count(DISTINCT j."countryCode")::int AS nb_marches,
         string_agg(DISTINCT j."countryCode", ',' ORDER BY j."countryCode") AS marches
  FROM "Job" j, LATERAL jsonb_object_keys(j.raw) AS cle
  WHERE j."isActive" = true AND j.raw IS NOT NULL
  GROUP BY cle
  HAVING count(*) >= 100
  ORDER BY n DESC
`);

console.log(`clés distinctes dans raw (>= 100 offres) : ${lignes.length}\n`);
for (const l of lignes) {
  console.log(`${String(l.n).padStart(6)} | ${l.nb_marches} marchés | ${l.cle}  [${l.marches}]`);
}

await prisma.$disconnect();
