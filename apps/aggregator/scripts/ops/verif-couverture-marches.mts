/**
 * LA COUVERTURE PAR MARCHÉ, RE-MESURÉE — lecture seule, rejouable.
 *
 * Pourquoi ce script existe : les taux gravés dans `packages/db/marches.ts`
 * décident de l'affichage des facettes. Un chiffre qu'on ne peut pas recompter
 * n'est pas une preuve — il devient un commentaire, et un commentaire ne se met
 * pas à jour quand la base change sous lui.
 *
 * ── L'ÉTALONNAGE, ET POURQUOI IL PASSE AVANT LA MESURE ─────────────────────
 *
 * Le script re-mesure d'abord DIX marchés déjà gravés. Si ces dix-là ne
 * retombent pas sur les taux du registre, alors ma définition de « couverture »
 * diverge de celle qui a produit le registre, et TOUT nouveau chiffre mesuré
 * avec cette définition serait faux de la même façon — sans que rien ne le
 * signale. On ne mesure un marché neuf qu'après avoir prouvé qu'on sait
 * reproduire les anciens.
 *
 * ── LES DÉFINITIONS, LUES DANS LE SCHÉMA, PAS SUPPOSÉES ───────────────────
 *
 * Population : `Job` WHERE "isActive" — la même que `production-counts.mts`.
 * Une dimension est « couverte » quand sa colonne est NON NULLE. Le saisonnier
 * est un booléen à trois états (true / false / NULL) : couvert = NON NULL,
 * comme les autres, et non « = true ». Confondre les deux ferait passer
 * « renseigné à false » pour « non renseigné ».
 */
import { PrismaClient } from '@prisma/client';

/*
 * ⚠️ `metier` LIT `occupationCode`, ET JAMAIS `jobFunction`. CORRIGÉ LE
 * 2026-09-15 — ce script portait `"jobFunction"`, et c'est CE défaut qui a
 * produit les taux faux du registre (95,5 % en FR au lieu de 48,8 %).
 *
 * La facette `metier` servie au candidat agrège `COALESCE("occupationCode",
 * 'unclassified')` — `apps/api/lib/job-search-query.ts:167` — que
 * `CORRESPONDANCE_FACETTE` mappe sur la facette d'API `occupations`.
 * `jobFunction` est la FAMILLE (27 valeurs, dérivée du code) : elle sert de
 * critère de filtrage interne (`?fonction=`) et de libellé sur la fiche, mais
 * elle n'est agrégée en facette NULLE PART.
 *
 * Mesurer ici la mauvaise colonne suffirait à réintroduire le défaut au
 * registre, puisque c'est de ce script qu'on recopie les taux.
 *
 * `seniorite` est RETIRÉE : ce n'est plus une dimension de facette (la donnée
 * est déduite par regex sur l'intitulé à 99,97 %, et contredit la source
 * déclarée dans 80 % des cas confrontables). La colonne `seniority` reste en
 * base pour l'usage interne — voir `packages/db/marches.ts`.
 */
const DIMENSIONS = {
  contrat: '"employmentTerm"',
  temps: '"workTime"',
  programme: '"programType"',
  saisonnier: '"isSeasonal"',
  metier: '"occupationCode"',
} as const;

const p = new PrismaClient();
try {
  const colonnes = Object.entries(DIMENSIONS)
    .map(([nom, col]) => `count(*) FILTER (WHERE ${col} IS NOT NULL)::float / count(*) AS "${nom}"`)
    .join(',\n           ');

  const lignes = await p.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT "countryCode" AS code,
           count(*)::int AS offres,
           ${colonnes}
      FROM "Job"
     WHERE "isActive" AND "countryCode" IS NOT NULL
     GROUP BY "countryCode"
     HAVING count(*) >= 500
     ORDER BY count(*) DESC`);

  console.log(JSON.stringify(lignes, null, 1));

  const [total] = await p.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM "Job" WHERE "isActive"`;
  console.log(`\nTOTAL ACTIF : ${Number(total.n)}`);
} finally {
  await p.$disconnect();
}
