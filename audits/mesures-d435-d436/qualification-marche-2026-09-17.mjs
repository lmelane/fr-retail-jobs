/**
 * QUALIFICATION D'UN MARCHÉ — couverture, diversité, et ce que la qualité n'est PAS.
 *
 * ── POURQUOI CETTE SONDE ──────────────────────────────────────────────────────────────────────
 *
 * `facettes-par-marche-2026-09-15.mjs` mesure la COUVERTURE : quelle part des offres renseigne
 * une dimension. C'est nécessaire et insuffisant, et la Chine le prouve : 81,9 % des offres y
 * portent un temps de travail, mais 99,7 % portent LA MÊME valeur. Un filtre à une seule valeur
 * utile ne filtre rien — il promet un tri qu'il ne rend pas.
 *
 * Cette sonde ajoute donc la DIVERSITÉ, dimension par dimension et marché par marché, et rend
 * les deux critères ensemble. Elle sert à deux choses :
 *
 *  1. qualifier un pays candidat à devenir un marché supporté (volume, puis couverture, puis
 *     diversité) ;
 *  2. vérifier qu'un marché déjà supporté expose les bonnes facettes.
 *
 * ── CE QU'ELLE NE MESURE PAS, ET IL FAUT LE DIRE ──────────────────────────────────────────────
 *
 * Elle ne mesure AUCUNE qualité de donnée. Le remplissage dit qu'une information EXISTE, jamais
 * qu'elle est JUSTE. Le cas connu et vérifié : le salaire est renseigné sur plusieurs marchés
 * mais contient des montants annuels étiquetés horaires. Une dimension peut donc passer les deux
 * critères de cette sonde et rester inexploitable.
 *
 * Tant qu'aucune sonde ne mesure la justesse, la troisième condition de la politique
 * (`qualiteValidee`) reste une VÉRIFICATION HUMAINE, pas un calcul. Prétendre le contraire
 * reviendrait à déclarer une garantie qu'aucun code ne rend.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────────────────────
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly node \
 *     audits/mesures-d435-d436/qualification-marche-2026-09-17.mjs [CODE...]
 *
 * Sans argument : les pays candidats (volume au-dessus du seuil, non encore marchés).
 * Avec des codes : ces pays-là, marchés supportés compris.
 */
import { PrismaClient } from '@prisma/client';
import { EXPRESSION_FACETTE } from '@catwalks/db/colonnes-facette';

/** Le volume à partir duquel un pays MÉRITE d'être qualifié. Il ne promeut rien à lui seul. */
const SEUIL_QUALIFICATION = 500;
/** La couverture au-dessous de laquelle un filtre rend majoritairement du « non précisé ». */
const SEUIL_COUVERTURE = 0.2;
/**
 * La part maximale de la valeur DOMINANTE. Au-delà, la dimension est renseignée mais uniforme :
 * le filtre existerait sans rien séparer. La Chine à 99,7 % sur le temps de travail est le cas
 * qui a fait écrire ce critère.
 */
const PART_DOMINANTE_MAXIMALE = 0.9;

/**
 * Les dimensions candidates, et l'expression qui les porte.
 *
 * ── D'OÙ VIENNENT CES EXPRESSIONS, ET POURQUOI PLUS D'UNE LISTE ÉCRITE ICI ────────────────────
 *
 * Les dimensions RÉELLEMENT SERVIES au candidat sont importées de `@catwalks/db/colonnes-facette`,
 * la déclaration unique. Elles ne sont plus recopiées : cette sonde a mesuré `jobFunction` du
 * 15 au 17/09/2026 alors que la facette agrège `occupationCode` — 42 points d'écart, et la
 * décision d'ouvrir 29 marchés prise sur ce chiffre. La Pologne annoncée « métier exposable »
 * tombe à 20,2 % sur la colonne servie, le Danemark à 17,6 %, la Thaïlande à 16,7 %.
 *
 * ── LES DIMENSIONS D'OBSERVATION, DÉCLARÉES ICI ET SEULEMENT ICI ──────────────────────────────
 *
 * `engagement`, `modeDeTravail` et `salaire` ne sont servies par AUCUNE facette aujourd'hui. Les
 * mesurer reste utile — c'est ce qui dira le jour venu si une nouvelle facette est possible — mais
 * elles ne peuvent pas venir de `colonnes-facette`, qui décrit ce qui EST servi. Elles sont donc
 * déclarées localement, et le tableau le signale par un `·` devant leur nom : le lecteur voit
 * immédiatement qu'un verdict « exposable » sur ces lignes-là ne décrit aucune facette existante.
 *
 * `seniorite` a été RETIRÉE : la dimension a quitté les facettes le 15/09/2026 (99,97 % de la
 * donnée est déduite par expression régulière sur l'intitulé, et elle contredit la source dans
 * 80 % des cas confrontables). La mesurer ici décrirait une facette qui n'existe plus.
 */
const DIMENSIONS_SERVIES = {
  metier: EXPRESSION_FACETTE.metier,
  /*
   * `contrat` a été omis d'une première version de cette liste, et la sonde a rendu quatre
   * qualifications sans lui — alors qu'il est renseigné de 31 à 38 % sur les quatre pays, très
   * au-dessus du seuil. Une sonde incomplète ne se voit pas : elle rend un tableau qui a l'air
   * complet. C'est la comparaison avec le relevé de référence qui l'a attrapée.
   */
  contrat: EXPRESSION_FACETTE.contrat,
  temps: EXPRESSION_FACETTE.temps,
  programme: EXPRESSION_FACETTE.programme,
  langue: EXPRESSION_FACETTE.langue,
  ville: EXPRESSION_FACETTE.ville,
};

/** Mesurées pour observer, jamais servies : aucune facette ne les expose aujourd'hui. */
const DIMENSIONS_OBSERVEES = {
  engagement: '"engagementType"',
  modeDeTravail: '"workplaceType"',
  salaire: '"salaryMin"',
};

const DIMENSIONS = { ...DIMENSIONS_SERVIES, ...DIMENSIONS_OBSERVEES };

const db = new PrismaClient();
const pct = (n) => `${(n * 100).toFixed(1)} %`;

try {
  const demandes = process.argv.slice(2).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));

  const volumes = await db.$queryRawUnsafe(`
    SELECT "countryCode" AS pays, count(*)::int AS offres
      FROM "Job" WHERE "isActive" AND "countryCode" IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC`);

  const cibles = demandes.length
    ? volumes.filter((v) => demandes.includes(v.pays))
    : volumes.filter((v) => v.offres >= SEUIL_QUALIFICATION);

  console.log(`\nQUALIFICATION — mesure du ${new Date().toISOString().slice(0, 10)}`);
  console.log(`seuil de volume ${SEUIL_QUALIFICATION} · couverture ${pct(SEUIL_COUVERTURE)} · part dominante max ${pct(PART_DOMINANTE_MAXIMALE)}\n`);

  for (const { pays, offres } of cibles) {
    console.log(`\n══ ${pays} — ${offres.toLocaleString('fr-FR')} offres actives ${offres >= SEUIL_QUALIFICATION ? '' : '(SOUS LE SEUIL)'}`);
    console.log('   dimension        couverture   valeurs   dominante        verdict');
    console.log('   ' + '─'.repeat(72));

    for (const [nom, expression] of Object.entries(DIMENSIONS)) {
      /*
       * `<> ''` REPRODUIT L'EXCLUSION DE LA FACETTE, et ce n'est pas une précaution théorique :
       * `count(colonne)` compte la chaîne vide, la facette servie l'exclut. Mesuré le 17/09/2026 :
       * zéro chaîne vide sur les six dimensions servies, donc l'écart est nul AUJOURD'HUI. La
       * règle est reprise quand même, pour que l'apparition d'une chaîne vide ne creuse pas un
       * écart silencieux entre ce qu'on mesure et ce que le candidat voit.
       */
      const rempli = `${expression} IS NOT NULL AND (${expression})::text <> ''`;
      const [r] = await db.$queryRawUnsafe(`
        SELECT count(*) FILTER (WHERE ${rempli})::int AS remplies,
               count(DISTINCT ${expression}) FILTER (WHERE ${rempli})::int AS distinctes
          FROM "Job" WHERE "isActive" AND "countryCode" = $1`, pays);

      const couverture = offres ? r.remplies / offres : 0;
      let partDominante = null;
      if (r.remplies > 0) {
        const [d] = await db.$queryRawUnsafe(`
          SELECT count(*)::int AS n FROM "Job"
           WHERE "isActive" AND "countryCode" = $1 AND ${rempli}
           GROUP BY ${expression} ORDER BY count(*) DESC LIMIT 1`, pays);
        partDominante = d ? d.n / r.remplies : null;
      }

      const couvre = couverture >= SEUIL_COUVERTURE;
      const diverse = r.distinctes > 1 && partDominante !== null && partDominante <= PART_DOMINANTE_MAXIMALE;
      const verdict = !couvre ? 'couverture insuffisante'
        : !diverse ? (r.distinctes <= 1 ? 'une seule valeur' : 'valeurs trop uniformes')
        : 'exposable';

      /*
       * Le `·` marque une dimension qu'AUCUNE facette n'expose. Sans lui, un verdict « exposable »
       * sur `salaire` ou `modeDeTravail` se lit comme un filtre existant — alors qu'il décrit une
       * possibilité, pas l'état du produit.
       */
      const servie = nom in DIMENSIONS_SERVIES;
      console.log(`   ${(servie ? '  ' : '· ') + nom.padEnd(14)} ${pct(couverture).padStart(9)} ${String(r.distinctes).padStart(9)}`
        + `   ${(partDominante === null ? '—' : pct(partDominante)).padStart(9)}        ${verdict}`);
    }

    const [langues] = await db.$queryRawUnsafe(`
      SELECT string_agg(l, ', ' ORDER BY n DESC) AS reparti FROM (
        SELECT coalesce("language", '(sans)') || ' ' || count(*)::text AS l, count(*) AS n
          FROM "Job" WHERE "isActive" AND "countryCode" = $1
         GROUP BY "language" ORDER BY 2 DESC LIMIT 5) t`, pays);
    console.log(`   langues des annonces : ${langues?.reparti ?? '—'}`);
  }

  console.log('\n' + '─'.repeat(78));
  console.log('La couverture et la diversité sont MESURÉES ici. La QUALITÉ ne l\'est pas :');
  console.log('une dimension peut passer les deux critères et rester fausse (le salaire porte');
  console.log('des montants annuels étiquetés horaires). La validation de qualité reste humaine.');
  console.log('LECTURE SEULE — aucune donnée modifiée.\n');
} finally {
  await db.$disconnect();
}
