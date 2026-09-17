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
 * Les dimensions candidates, et la colonne qui les porte.
 *
 * Reprises telles quelles de `facettes-par-marche-2026-09-15.mjs` — un second relevé qui
 * nommerait ses colonnes autrement produirait deux vérités sur la même donnée. Les noms sont
 * ceux du schéma : `jobFunction` et `seniority`, pas les intitulés d'interface.
 */
const DIMENSIONS = {
  metier: 'jobFunction',
  seniorite: 'seniority',
  /*
   * `contrat` a été omis d'une première version de cette liste, et la sonde a rendu quatre
   * qualifications sans lui — alors qu'il est renseigné de 31 à 38 % sur les quatre pays, très
   * au-dessus du seuil. Une sonde incomplète ne se voit pas : elle rend un tableau qui a l'air
   * complet. C'est la comparaison avec le relevé de référence qui l'a attrapée.
   */
  contrat: 'employmentTerm',
  temps: 'workTime',
  programme: 'programType',
  engagement: 'engagementType',
  modeDeTravail: 'workplaceType',
  salaire: 'salaryMin',
  langue: 'language',
  ville: 'city',
};

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

    for (const [nom, colonne] of Object.entries(DIMENSIONS)) {
      const [r] = await db.$queryRawUnsafe(`
        SELECT count(*) FILTER (WHERE "${colonne}" IS NOT NULL)::int AS remplies,
               count(DISTINCT "${colonne}")::int AS distinctes
          FROM "Job" WHERE "isActive" AND "countryCode" = $1`, pays);

      const couverture = offres ? r.remplies / offres : 0;
      let partDominante = null;
      if (r.remplies > 0) {
        const [d] = await db.$queryRawUnsafe(`
          SELECT count(*)::int AS n FROM "Job"
           WHERE "isActive" AND "countryCode" = $1 AND "${colonne}" IS NOT NULL
           GROUP BY "${colonne}" ORDER BY count(*) DESC LIMIT 1`, pays);
        partDominante = d ? d.n / r.remplies : null;
      }

      const couvre = couverture >= SEUIL_COUVERTURE;
      const diverse = r.distinctes > 1 && partDominante !== null && partDominante <= PART_DOMINANTE_MAXIMALE;
      const verdict = !couvre ? 'couverture insuffisante'
        : !diverse ? (r.distinctes <= 1 ? 'une seule valeur' : 'valeurs trop uniformes')
        : 'exposable';

      console.log(`   ${nom.padEnd(16)} ${pct(couverture).padStart(9)} ${String(r.distinctes).padStart(9)}`
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
