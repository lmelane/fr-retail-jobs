/**
 * LES FACETTES CÔTÉ SITE POUR LA CHINE — ce que le registre AVAL doit exposer.
 *
 * Le registre amont décide des facettes CONTRACTUELLES sur la couverture
 * mesurée. Le registre du site expose en plus `langue`, `ville`, `pays`,
 * `secteur`, `maison`, `groupe` — des dimensions que l'amont ne mesure pas.
 * Les ouvrir « par symétrie » avec les autres marchés serait exactement
 * l'erreur que le Canada a révélée : déduire au lieu de relever.
 *
 * Lecture seule. Rejouable.
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
try {
  /*
   * `sector` N'EST PAS UNE COLONNE DE `Job` — il vit sur `Company`, et une
   * première version de ce script l'a supposé. La base a répondu 42703 plutôt
   * que de rendre un chiffre faux : le schéma est l'autorité, pas ma mémoire
   * des noms de colonnes.
   */
  const [c] = await p.$queryRaw<Array<Record<string, unknown>>>`
    SELECT count(*)::int AS offres,
           count(*) FILTER (WHERE j."language" IS NOT NULL)::float / count(*) AS langue,
           count(*) FILTER (WHERE j."city" IS NOT NULL)::float / count(*) AS ville,
           count(*) FILTER (WHERE c."sector" <> 'UNKNOWN')::float / count(*) AS secteur
      FROM "Job" j JOIN "Company" c ON c."id" = j."companyId"
     WHERE j."isActive" AND j."countryCode" = 'CN'`;
  console.log('=== COUVERTURE DES FACETTES SITE (CN) ===');
  console.log(JSON.stringify(c, null, 1));

  const langues = await p.$queryRaw<Array<{ language: string | null; n: bigint }>>`
    SELECT "language", count(*) AS n FROM "Job"
     WHERE "isActive" AND "countryCode" = 'CN'
     GROUP BY "language" ORDER BY count(*) DESC`;
  console.log('\nlangues des annonces CN :', JSON.stringify(langues.map((r) => [r.language, Number(r.n)])));

  /*
   * LE POINT PRODUIT : le contenu des annonces chinoises reste NATIF. Si la
   * majorité des annonces `CN` sont en anglais, la locale de service reste
   * `zh-CN` (c'est le marché qui impose sa langue, pas l'annonce) mais il faut
   * le SAVOIR et non le découvrir en production.
   */
  const valeurs = await p.$queryRaw<Array<{ dim: string; v: string | null; n: bigint }>>`
    SELECT 'contrat' AS dim, "employmentTerm"::text AS v, count(*) AS n
      FROM "Job" WHERE "isActive" AND "countryCode" = 'CN' GROUP BY "employmentTerm"
    UNION ALL
    SELECT 'temps', "workTime"::text, count(*)
      FROM "Job" WHERE "isActive" AND "countryCode" = 'CN' GROUP BY "workTime"
    UNION ALL
    SELECT 'seniorite', "seniority"::text, count(*)
      FROM "Job" WHERE "isActive" AND "countryCode" = 'CN' GROUP BY "seniority"
    ORDER BY dim, n DESC`;
  console.log('\nvaleurs par dimension :');
  for (const r of valeurs) console.log(`  ${r.dim.padEnd(10)} ${String(r.v).padEnd(24)} ${Number(r.n)}`);
} finally {
  await p.$disconnect();
}
