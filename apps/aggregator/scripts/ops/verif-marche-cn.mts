/**
 * LE MARCHÉ CHINE — mesure d'ouverture, lecture seule, rejouable.
 *
 * Le registre `packages/db/marches.ts` écartait la Chine avec une raison
 * explicite : « mesurable, mais non ouverte — décision CEO ». Ce script
 * produit les chiffres qui permettent de graver l'ouverture sans estimer une
 * seule valeur.
 *
 * ── L'ÉTALONNAGE PASSE AVANT LA MESURE ────────────────────────────────────
 *
 * Même discipline que `verif-couverture-marches.mts` : on re-mesure d'abord
 * des marchés DÉJÀ gravés. S'ils ne retombent pas sur les taux du registre, ma
 * définition de « couverture » diverge de celle qui a produit le registre, et
 * le chiffre chinois serait faux de la même façon — sans que rien ne le dise.
 *
 * Définitions lues dans le schéma, jamais supposées :
 *   · population = `Job` WHERE "isActive" AND "countryCode" = <code> ;
 *   · couvert    = colonne NON NULLE. `isSeasonal` est un booléen à TROIS
 *     états (true / false / NULL) : « renseigné à false » est couvert.
 *
 * ── LA COLLISION `CN`, VÉRIFIÉE ET NON SUPPOSÉE ───────────────────────────
 *
 * D-435 garde les codes qui sont à la fois un pays et un ÉTAT américain
 * (`CA` = Canada/Californie, `IN` = Inde/Indiana). `CN` n'est pas un code
 * d'État américain — mais cela se PROUVE, et la preuve est ici : on sonde le
 * stock chinois avec des villes américaines et européennes majeures sans
 * homonyme chinois plausible. Une contre-épreuve sur `US` prouve que la sonde
 * sait trouver ce qu'elle cherche : une sonde muette des deux côtés ne
 * démontre rien.
 */
import { PrismaClient } from '@prisma/client';
import { MARCHES, SEUIL_AFFICHAGE_FACETTE } from '@catwalks/db/marches';

const DIMENSIONS = {
  contrat: '"employmentTerm"',
  temps: '"workTime"',
  programme: '"programType"',
  saisonnier: '"isSeasonal"',
  metier: '"jobFunction"',
  seniorite: '"seniority"',
} as const;

/**
 * L'étalon est IMPORTÉ du registre, jamais retypé.
 *
 * Première version : les taux étaient recopiés à la main, et l'un d'eux venait
 * d'un COMMENTAIRE de prose (« 90,0 à 96,8 % ») plutôt que de la donnée. Le
 * script a donc déclaré l'étalonnage divergent alors que la mesure retombait
 * au chiffre près sur le registre (FR.metier = 0.95538). Une vérification qui
 * compare la base à une recopie ne vérifie que la recopie.
 */
const ETALON_CODES = ['FR', 'US'] as const;

/*
 * Villes sans homonyme chinois plausible. On ne teste PAS « Shanghai » ni
 * « Macau » (réellement chinoises), ni des noms portés par des villes chinoises
 * translittérées. Une sonde à faux positifs surestimerait la contamination et
 * ferait rejeter un marché sain.
 */
const VILLES_NON_CN = [
  'Los Angeles', 'San Francisco', 'New York', 'Chicago', 'Boston', 'Seattle',
  'Paris', 'London', 'Milan', 'Madrid', 'Berlin', 'Amsterdam', 'Toronto',
];

const p = new PrismaClient();
try {
  const colonnes = Object.entries(DIMENSIONS)
    .map(([nom, col]) => `count(*) FILTER (WHERE ${col} IS NOT NULL)::float / count(*) AS "${nom}"`)
    .join(',\n           ');

  /* ── 1. ÉTALONNAGE ─────────────────────────────────────────────────────── */
  const liste = ETALON_CODES.map((c) => `'${c}'`).join(',');
  const etalons = await p.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT "countryCode" AS code, count(*)::int AS offres, ${colonnes}
      FROM "Job" WHERE "isActive" AND "countryCode" IN (${liste})
     GROUP BY "countryCode"`);

  console.log('=== ÉTALONNAGE (doit retomber sur le registre) ===');
  let etalonnageOk = true;
  for (const ligne of etalons) {
    const code = String(ligne.code) as (typeof ETALON_CODES)[number];
    console.log(code, 'offres=' + ligne.offres, JSON.stringify(
      Object.fromEntries(Object.keys(DIMENSIONS).map((d) => [d, Number(ligne[d]).toFixed(5)])),
    ));
    for (const [dim, attendu] of Object.entries(MARCHES[code].couverture)) {
      const mesure = Number(ligne[dim]);
      /* Tolérance 1 point : le stock bouge entre deux mesures, la définition non. */
      const ecart = Math.abs(mesure - attendu);
      if (ecart > 0.01) {
        etalonnageOk = false;
        console.log(`  ⚠️ ${code}.${dim} : mesuré ${mesure.toFixed(5)} vs registre ${attendu} (écart ${ecart.toFixed(4)})`);
      }
    }
  }
  console.log('étalonnage', etalonnageOk ? '✅ conforme' : '❌ DIVERGENT — ne pas graver le chiffre CN');

  /* ── 2. LA CHINE ───────────────────────────────────────────────────────── */
  const [cn] = await p.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT count(*)::int AS offres, ${colonnes}
      FROM "Job" WHERE "isActive" AND "countryCode" = 'CN'`);

  console.log('\n=== CHINE (CN) ===');
  console.log('offres actives :', cn.offres);
  for (const dim of Object.keys(DIMENSIONS)) {
    const taux = Number(cn[dim]);
    const affichee = taux >= SEUIL_AFFICHAGE_FACETTE;
    console.log(`  ${dim.padEnd(11)} ${(taux * 100).toFixed(3).padStart(7)} %  ${affichee ? '✅ AFFICHÉE' : '✗ sous seuil'}  (${taux.toFixed(5)})`);
  }

  /* Le pouvoir de discrimination : un filtre à une seule valeur ne filtre rien. */
  const distinctes = await p.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT count(DISTINCT "jobFunction")::int AS metier,
           count(DISTINCT "seniority")::int AS seniorite,
           count(DISTINCT "employmentTerm")::int AS contrat,
           count(DISTINCT "workTime")::int AS temps
      FROM "Job" WHERE "isActive" AND "countryCode" = 'CN'`);
  console.log('valeurs distinctes CN :', JSON.stringify(distinctes[0]));

  /* ── 3. LA COLLISION ───────────────────────────────────────────────────── */
  const suspectes = await p.$queryRaw<Array<{ city: string; n: bigint }>>`
    SELECT "city", count(*) AS n FROM "Job"
     WHERE "isActive" AND "countryCode" = 'CN' AND "city" = ANY(${VILLES_NON_CN})
     GROUP BY "city" ORDER BY count(*) DESC`;
  const contaminees = suspectes.reduce((s, r) => s + Number(r.n), 0);

  const [temoin] = await p.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM "Job"
     WHERE "isActive" AND "countryCode" IN ('US','FR','GB','IT','ES','NL','DE','CA')
       AND "city" = ANY(${VILLES_NON_CN})`;

  console.log('\n=== COLLISION `CN` ===');
  console.log('offres CN portant une ville non chinoise :', contaminees, JSON.stringify(suspectes.map((r) => [r.city, Number(r.n)])));
  console.log('CONTRE-ÉPREUVE — mêmes villes sous leurs pays réels :', Number(temoin.n),
    Number(temoin.n) > 0 ? '✅ la sonde sait trouver' : '❌ SONDE MUETTE : le 0 ci-dessus ne prouve rien');

  /* Les vraies villes chinoises, pour montrer que le stock CN est bien chinois. */
  const villesCn = await p.$queryRaw<Array<{ city: string; n: bigint }>>`
    SELECT "city", count(*) AS n FROM "Job"
     WHERE "isActive" AND "countryCode" = 'CN' AND "city" IS NOT NULL
     GROUP BY "city" ORDER BY count(*) DESC LIMIT 12`;
  console.log('top villes CN :', JSON.stringify(villesCn.map((r) => [r.city, Number(r.n)])));

  /* ── 3bis. LE CODE DE REPLI DU TÉMOIN DÉGRADÉ ──────────────────────────── */
  /*
   * Le témoin `marches-d436` exerce son cas dégradé avec un code pays RÉEL du
   * catalogue qui n'est pas un marché. `CN` jouait ce rôle ; en l'ouvrant, il
   * faut le remplacer — et vérifier que le remplaçant est bien réel, sinon le
   * témoin ne testerait plus que des chaînes absurdes et le cas NORMAL de
   * production (un code valide hors registre) ne serait plus couvert.
   */
  const [jp] = await p.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM "Job" WHERE "isActive" AND "countryCode" = 'JP'`;
  console.log('\n=== REPLI DU TÉMOIN DÉGRADÉ ===');
  console.log(`offres actives JP : ${Number(jp.n)} ${Number(jp.n) > 0 ? '✅ code réel du catalogue' : '❌ JP est absent — choisir un autre code'}`);

  /* ── 4. LE CONTENU RESTE NATIF ─────────────────────────────────────────── */
  const [natif] = await p.$queryRaw<Array<{ total: bigint; han: bigint }>>`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE "title" ~ '[一-鿿]') AS han
      FROM "Job" WHERE "isActive" AND "countryCode" = 'CN'`;
  console.log('\n=== CONTENU NATIF ===');
  console.log(`titres CN contenant des caractères han : ${Number(natif.han)} / ${Number(natif.total)}`);
} finally {
  await p.$disconnect();
}
