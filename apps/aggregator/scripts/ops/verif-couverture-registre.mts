/**
 * LE TÉMOIN DE COUVERTURE — le registre dit-il la vérité sur la BONNE colonne ?
 *
 *   npm run verif:couverture -w @catwalks/aggregator
 *   DB_URL=postgresql://… npm run verif:couverture -w @catwalks/aggregator
 *
 * LECTURE SEULE STRICTE : un seul `SELECT`, et la session est mise en
 * `default_transaction_read_only` avant toute requête.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  LE DÉFAUT QUE CE TÉMOIN CHERCHE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `packages/db/marches.ts` a porté, du 2026-09-15 au 2026-09-15, des taux de
 * couverture `metier` mesurés sur `Job.jobFunction` (95,5 % en FR, 77,7 % en CH)
 * alors que la facette réellement servie au candidat lit `Job.occupationCode`
 * (48,8 % en FR, 25,7 % en CH). Un écart de 42 points en moyenne, sur la
 * dimension qui décide de l'affichage d'un filtre.
 *
 * AUCUN TÉMOIN UNITAIRE NE POUVAIT L'ATTRAPER, et c'est le point. Le registre
 * est un module de DONNÉES PURES : il ne requête rien. Un test qui compare des
 * constantes à d'autres constantes ne peut que vérifier qu'on les a recopiées
 * de façon cohérente — jamais qu'on les a recopiées de la BONNE SOURCE.
 *
 * Les 22 témoins de `marches-d436.test.ts` étaient verts sur les chiffres de
 * `jobFunction`. Ils le seraient restés indéfiniment.
 *
 * ── CE QUI REND CE TÉMOIN CAPABLE D'ÉCHOUER ───────────────────────────────
 *
 * Il ne relit PAS le registre pour en confirmer la cohérence interne : il va
 * chercher le chiffre en base, sur la colonne que la facette sert vraiment, et
 * le confronte à ce qui est gravé. C'est la seule construction qui puisse
 * distinguer « mal recopié » de « recopié de la mauvaise colonne ».
 *
 * ⚠️ LA COLONNE EST NOMMÉE ICI, ET ELLE DOIT SUIVRE LE CODE. Si un jour la
 * facette `occupations` cessait d'agréger `occupationCode`, ce témoin
 * deviendrait faux à son tour, silencieusement. La CHAÎNE est vérifiée par
 * `apps/api/lib/__tests__/facettes-marche.test.ts` (« `occupations` est bien la
 * facette qui SUIT la dimension `metier` ») ; ce témoin-ci vérifie le CHIFFRE.
 * Les deux sont nécessaires, aucun ne remplace l'autre.
 *
 * ── LA TOLÉRANCE, ET POURQUOI ELLE N'EST PAS ZÉRO ─────────────────────────
 *
 * Le catalogue bouge : des offres entrent, d'autres se ferment, la
 * classification progresse. Exiger l'égalité stricte ferait rougir ce témoin
 * chaque jour, et un témoin qui rougit tous les jours est un témoin qu'on
 * désactive.
 *
 * 3 points de pourcentage absorbent la dérive normale d'un catalogue de 83 000
 * offres. Ils n'absorbent PAS une erreur de colonne : l'écart `jobFunction` /
 * `occupationCode` va de 32 points (DE) à 57 points (CA). Le défaut d'origine
 * aurait été détecté sur les DOUZE marchés, pas sur un seul.
 */
import { PrismaClient } from '@prisma/client';
import { CODES_MARCHE, MARCHES, SEUIL_AFFICHAGE_FACETTE } from '@catwalks/db/marches';

/** L'écart toléré, en proportion (0.03 = 3 points de pourcentage). */
const TOLERANCE = 0.03;

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

type Ligne = { marche: string; actives: number; metier: number; jobfunction: number };

async function main(): Promise<number> {
  await prisma.$executeRawUnsafe('SET default_transaction_read_only = on');

  /*
   * LA MÊME POPULATION QUE LE REGISTRE : offres actives, marché résolu comme
   * `isFrance` d'abord (le drapeau fiable) puis `countryCode`. Une population
   * différente rendrait des chiffres différents et ferait rougir le témoin pour
   * une raison qui n'a rien à voir avec la colonne.
   *
   * `jobfunction` est ramené pour le DIAGNOSTIC seulement : quand l'écart
   * dépasse la tolérance, savoir si le chiffre gravé correspond à CETTE
   * colonne-là transforme un « ça ne colle plus » en « quelqu'un a re-mesuré
   * sur jobFunction ».
   */
  const lignes = await prisma.$queryRawUnsafe<Ligne[]>(`
    SELECT
      CASE WHEN "isFrance" THEN 'FR' ELSE upper("countryCode") END AS marche,
      count(*)::int AS actives,
      (count(*) FILTER (WHERE "occupationCode" IS NOT NULL))::float / count(*) AS metier,
      (count(*) FILTER (WHERE "jobFunction" IS NOT NULL))::float / count(*) AS jobfunction
    FROM "Job"
    WHERE "isActive"
      AND (CASE WHEN "isFrance" THEN 'FR' ELSE upper("countryCode") END) IN (${CODES_MARCHE.map(
        (c) => `'${c}'`,
      ).join(',')})
    GROUP BY 1
  `);

  const mesure = new Map(lignes.map((l) => [l.marche, l]));

  /*
   * PRÉMISSE 1 — la sonde doit RAMENER quelque chose. Sur une base vide, une
   * connexion vers la mauvaise base ou un filtre trop étroit, la boucle
   * ci-dessous ne s'exécuterait jamais et ce script sortirait 0 en ayant tout
   * validé. C'est le mode de panne classique d'un garde branché sur des données.
   */
  if (mesure.size !== CODES_MARCHE.length) {
    console.error(
      `PRÉMISSE ROUGE : ${mesure.size} marchés mesurés sur ${CODES_MARCHE.length} attendus.`,
      `Manquants : ${CODES_MARCHE.filter((c) => !mesure.has(c)).join(', ') || '(aucun)'}.`,
      '\nLa base interrogée ne porte pas le catalogue attendu — le témoin ne peut RIEN prouver.',
    );
    return 2;
  }

  const ecarts: string[] = [];
  const suspicions: string[] = [];

  for (const code of CODES_MARCHE) {
    const reel = mesure.get(code)!;
    const grave = MARCHES[code].couverture.metier;
    const ecart = Math.abs(reel.metier - grave);

    if (ecart > TOLERANCE) {
      ecarts.push(
        `  ${code} : gravé ${(grave * 100).toFixed(3)} %, mesuré ${(reel.metier * 100).toFixed(3)} % ` +
          `sur occupationCode (écart ${(ecart * 100).toFixed(1)} pts, ${reel.actives} offres actives)`,
      );
      /*
       * LE DIAGNOSTIC QUI FAIT GAGNER UNE HEURE : le chiffre gravé est-il
       * celui de l'AUTRE colonne ? C'est le défaut d'origine, et il se
       * reconnaît en une ligne au lieu de se redécouvrir en une enquête.
       */
      if (Math.abs(reel.jobfunction - grave) <= TOLERANCE) {
        suspicions.push(
          `  ${code} : le taux gravé correspond à jobFunction (${(reel.jobfunction * 100).toFixed(3)} %) ` +
            `et NON à occupationCode — c'est le défaut du 15/09/2026 qui revient.`,
        );
      }
    }

    /*
     * ET LA CONSÉQUENCE PRODUIT, pas seulement l'écart : un marché dont la
     * couverture réelle passe SOUS le seuil sert un filtre que la donnée ne
     * porte plus. C'est ce que le candidat voit, et ça doit remonter même si
     * l'écart reste dans la tolérance.
     */
    if (reel.metier < SEUIL_AFFICHAGE_FACETTE) {
      ecarts.push(
        `  ${code} : couverture métier RÉELLE ${(reel.metier * 100).toFixed(3)} % — SOUS LE SEUIL ` +
          `de ${(SEUIL_AFFICHAGE_FACETTE * 100).toFixed(0)} %. La facette ne doit plus être servie.`,
      );
    }
  }

  if (!ecarts.length) {
    console.log(
      `✅ Couverture métier du registre conforme à la base, sur ${CODES_MARCHE.length} marchés ` +
        `(colonne occupationCode, tolérance ${(TOLERANCE * 100).toFixed(0)} pts).`,
    );
    return 0;
  }

  console.error('❌ LE REGISTRE DIVERGE DE LA BASE SUR LA COUVERTURE MÉTIER :\n');
  console.error(ecarts.join('\n'));
  if (suspicions.length) {
    console.error('\n⚠️  MAUVAISE COLONNE — diagnostic :\n');
    console.error(suspicions.join('\n'));
  }
  console.error(
    '\nLa facette `occupations` agrège `occupationCode` (apps/api/lib/job-search-query.ts).',
    '\nRe-mesurer sur CETTE colonne, puis mettre à jour `packages/db/marches.ts`',
    'ET la table `tauxMesures` de `marches-d436.test.ts`.',
  );
  return 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error('ERREUR :', error?.message?.slice(0, 500) ?? String(error));
    process.exitCode = 3;
  })
  .finally(() => prisma.$disconnect());
