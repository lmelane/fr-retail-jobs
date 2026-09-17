/**
 * LES 103 PAYS HORS MARCHÉS MESURÉS — combien peuvent devenir des marchés routables ?
 *
 * ── LA QUESTION, ET LE POSTULAT QU'ELLE CORRIGE ───────────────────────────────────────────────
 *
 * Les seize marchés travaillés jusqu'ici ne sont pas une limite d'architecture : ce sont nos
 * premiers marchés LOCALISÉS. L'amont déclare 103 pays de plus qui portent des offres, et un
 * visiteur bulgare n'a aujourd'hui aucune suggestion — alors que la Bulgarie compte 45 offres
 * publiables.
 *
 * La dépendance à lever : **ouvrir un marché n'exige pas de traduire l'interface**. Le corpus,
 * les facettes et le périmètre géographique d'un pays existent indépendamment de la langue dans
 * laquelle on affiche les boutons. Trois niveaux, à ne jamais confondre :
 *
 *  1. **pays présent** — des offres portent ce `countryCode` ;
 *  2. **marché routable** — le corpus est assez fiable pour être exposé, interface anglaise en
 *     repli si sa langue n'est pas encore servie ;
 *  3. **marché localisé** — locale native, catalogues, libellés d'options, validation complète.
 *
 * Cette sonde mesure le passage de 1 à 2. Elle ne décide rien : elle rend les chiffres qui
 * permettent de décider.
 *
 * ── CE QUI REND UN MARCHÉ ROUTABLE, ET POURQUOI CES CRITÈRES ──────────────────────────────────
 *
 * **Un volume minimal.** Un pays à trois offres n'est pas un marché : le candidat qui y arrive
 * voit une page vide et s'en va. Le seuil est un arbitrage produit, pas une vérité — il est
 * nommé, exporté, et se change en un endroit.
 *
 * **Une intégrité géographique suffisante.** C'est le critère qui compte le plus, et il n'est
 * pas intuitif : un pays dont le code est AMBIGU (`CA` est aussi la Californie, `IN` l'Indiana,
 * `DE` le Delaware) peut porter des offres qui n'y sont pas. L'ouvrir en marché exposerait un
 * candidat bulgare à des offres qui ne le concernent pas — exactement le défaut mesuré sur le
 * Canada, 200 offres californiennes sur 3 129.
 *
 * **Au moins une facette exploitable.** Un marché sans aucun filtre utilisable est une liste,
 * pas un moteur. On mesure donc les mêmes dimensions que pour les seize, avec les mêmes seuils.
 *
 * ── CE QUE CETTE SONDE NE MESURE PAS ──────────────────────────────────────────────────────────
 *
 * La QUALITÉ des valeurs. Le remplissage dit qu'une information existe, jamais qu'elle est
 * juste — le salaire est renseigné sur plusieurs marchés avec des montants annuels étiquetés
 * horaires. Un pays peut passer tous les critères ci-dessous et rester décevant à l'usage.
 *
 * La langue des offres est rendue **à titre informatif seulement**. Elle ne détermine ni le
 * marché, ni la locale de l'interface : une annonce anglaise publiée à Sofia est une offre
 * bulgare, et un marché bulgare peut servir une interface anglaise.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────────────────────
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/mesures-d435-d436/marches-routables-2026-09-17.mts [seuil]
 */
import { PrismaClient } from '@prisma/client';

/** Sous ce volume, une page de marché serait trop maigre pour retenir un candidat. */
const SEUIL_ROUTABLE = Number(process.argv[2] ?? 50);
/** Les seize marchés déjà travaillés : ils ne sont pas le sujet de cette mesure. */
const DEJA_MARCHES = new Set(['US', 'FR', 'GB', 'CA', 'DE', 'IT', 'ES', 'NL', 'AU', 'CN', 'CH', 'BE', 'IN', 'JP', 'KR', 'PT']);
/** Les codes qui sont à la fois un pays ISO et une subdivision fédérale — repris de `countryIntegrity.ts`. */
const AMBIGUS = new Set(['AL', 'AR', 'CA', 'CO', 'CT', 'DE', 'GA', 'ID', 'IL', 'IN', 'KY', 'LA', 'MA', 'MD', 'ME',
  'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'VA', 'VT', 'WA', 'WI', 'WY', 'NL', 'PE', 'SK', 'NU']);
/** Les langues dont le site possède un catalogue d'interface complet, au 2026-09-17. */
const LANGUES_SERVIES = new Set(['fr', 'en', 'de', 'it', 'es', 'nl', 'zh-CN']);
/** Les dimensions candidates à devenir une facette, et leur colonne — mêmes noms que les autres sondes. */
const DIMENSIONS: Record<string, string> = {
  metier: 'jobFunction', seniorite: 'seniority', contrat: 'employmentTerm',
  temps: 'workTime', ville: 'city',
};
const SEUIL_COUVERTURE = 0.2;
const PART_DOMINANTE_MAX = 0.9;

const db = new PrismaClient();
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)} %` : '—');

try {
  console.log(`\nMARCHÉS ROUTABLES — mesure du ${new Date().toISOString().slice(0, 10)}, LECTURE SEULE`);
  console.log(`seuil de volume ${SEUIL_ROUTABLE} offres · les 16 marchés déjà travaillés sont exclus\n`);

  const pays = await db.$queryRawUnsafe<Array<{ code: string; offres: number; prouves: number; sources: string; langues: string }>>(`
    SELECT j."countryCode" AS code, count(*)::int AS offres,
           count(*) FILTER (WHERE j."countryIntegrity" IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED'))::int AS prouves,
           (SELECT string_agg(s2, ', ') FROM (
              SELECT s1."sourceKey" AS s2 FROM "JobSource" s1
               JOIN "Job" j2 ON j2.id = s1."jobId"
               WHERE s1."isActive" AND j2."isActive" AND j2."countryCode" = j."countryCode"
               GROUP BY s1."sourceKey" ORDER BY count(*) DESC LIMIT 2) t) AS sources,
           (SELECT string_agg(l, ' ') FROM (
              SELECT coalesce(j3.language,'∅') || ':' || count(*)::text AS l FROM "Job" j3
               WHERE j3."isActive" AND j3."countryCode" = j."countryCode"
               GROUP BY j3.language ORDER BY count(*) DESC LIMIT 3) t2) AS langues
      FROM "Job" j
     WHERE j."isActive" AND j."countryCode" IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC`);

  const candidats = pays.filter((p) => !DEJA_MARCHES.has(p.code));
  console.log(`  ${candidats.length} pays hors des seize marchés · ${candidats.reduce((n, p) => n + p.offres, 0).toLocaleString('fr-FR')} offres au total\n`);

  const routables: typeof candidats = [];
  const bloques: Array<{ p: (typeof candidats)[number]; motif: string }> = [];

  console.log('  code  offres  prouvés  ambigu  facettes exploitables            langues des offres (informatif)');
  console.log('  ' + '─'.repeat(108));

  for (const p of candidats) {
    if (p.offres < SEUIL_ROUTABLE) { bloques.push({ p, motif: `volume (${p.offres})` }); continue; }

    const facettes: string[] = [];
    for (const [nom, colonne] of Object.entries(DIMENSIONS)) {
      const [r] = await db.$queryRawUnsafe<Array<{ remplies: number; distinctes: number; dominante: number }>>(`
        SELECT count("${colonne}")::int AS remplies, count(DISTINCT "${colonne}")::int AS distinctes,
               coalesce(max(n), 0)::int AS dominante
          FROM "Job", LATERAL (SELECT count(*) AS n FROM "Job" j2
            WHERE j2."isActive" AND j2."countryCode" = $1 AND j2."${colonne}" IS NOT NULL
            GROUP BY j2."${colonne}" ORDER BY count(*) DESC LIMIT 1) d
         WHERE "isActive" AND "countryCode" = $1`, p.code);
      const couverture = p.offres ? r.remplies / p.offres : 0;
      const dominante = r.remplies ? r.dominante / r.remplies : 1;
      if (couverture >= SEUIL_COUVERTURE && r.distinctes > 1 && dominante <= PART_DOMINANTE_MAX) facettes.push(nom);
    }

    const ambigu = AMBIGUS.has(p.code);
    const partProuvee = p.offres ? p.prouves / p.offres : 0;
    /*
     * Un code AMBIGU sans preuve majoritaire ne s'ouvre pas : le marché servirait des offres d'un
     * autre pays. C'est le défaut canadien, 200 offres californiennes sur 3 129.
     */
    const bloquant = ambigu && partProuvee < 0.5 ? 'code ambigu, pays non prouvé'
      : facettes.length === 0 ? 'aucune facette exploitable' : null;

    console.log(`  ${p.code.padEnd(5)} ${String(p.offres).padStart(6)} ${pct(p.prouves, p.offres).padStart(8)}`
      + `  ${(ambigu ? 'OUI' : '—').padEnd(6)}  ${facettes.join(' ').padEnd(32)} ${(p.langues ?? '').slice(0, 30)}`
      + (bloquant ? `   ⛔ ${bloquant}` : ''));

    if (bloquant) bloques.push({ p, motif: bloquant }); else routables.push(p);
  }

  console.log('\n  ' + '═'.repeat(108));
  console.log(`  ROUTABLES IMMÉDIATEMENT : ${routables.length} pays, ${routables.reduce((n, p) => n + p.offres, 0).toLocaleString('fr-FR')} offres`);
  console.log(`     ${routables.map((p) => `${p.code}(${p.offres})`).join(' · ')}`);
  console.log(`\n  BLOQUÉS : ${bloques.length} pays, ${bloques.reduce((n, b) => n + b.p.offres, 0).toLocaleString('fr-FR')} offres`);
  const parMotif = new Map<string, number>();
  for (const b of bloques) {
    const cle = b.motif.startsWith('volume') ? `volume sous ${SEUIL_ROUTABLE}` : b.motif;
    parMotif.set(cle, (parMotif.get(cle) ?? 0) + 1);
  }
  for (const [motif, n] of [...parMotif.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(3)} · ${motif}`);

  console.log('\n  LOCALISATION DE L’INTERFACE — indépendante de l’ouverture du marché');
  console.log(`     Le site sert ${LANGUES_SERVIES.size} langues : ${[...LANGUES_SERVIES].join(', ')}.`);
  console.log('     Aucun des pays routables ci-dessus n’a besoin de sa langue native pour ouvrir :');
  console.log('     l’interface anglaise sert de repli, et la localisation progresse ensuite.');

  console.log('\n  ' + '─'.repeat(108));
  console.log('  La langue des offres est INFORMATIVE : elle ne détermine ni le marché, ni la locale de');
  console.log('  l’interface. Une annonce anglaise publiée à Sofia est une offre bulgare.');
  console.log('  Le remplissage d’une dimension ne dit pas qu’elle est JUSTE : la qualité n’est pas mesurée ici.');
  console.log('  LECTURE SEULE — aucune donnée modifiée.\n');
} finally {
  await db.$disconnect();
}
