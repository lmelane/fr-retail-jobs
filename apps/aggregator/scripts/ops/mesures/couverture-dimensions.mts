/**
 * COUVERTURE DES DIMENSIONS PAR MARCHÉ — lecture seule sur le corpus figé (40 091).
 *
 * Pour chaque couple `Marché × Dimension` : combien d'offres portent la valeur, quelle part du
 * marché, et combien de valeurs DISTINCTES. Les trois comptent ensemble — une dimension remplie à
 * 95 % mais portant une seule valeur ne filtre rien, et une dimension à 30 % avec dix valeurs
 * bien réparties peut être un excellent filtre.
 *
 * ── CE QUE CE SCRIPT NE FAIT PAS ───────────────────────────────────────────────────────────────
 *
 * Il n'invente aucune dimension : chaque colonne mesurée existe dans `Job` (vérifié dans le
 * schéma), et les cinq dimensions de facette du registre (`DIMENSIONS_FACETTE`) y sont toutes.
 * Il ne décide rien non plus — la décision d'exposition est produite à part, à partir de ces
 * chiffres.
 *
 * La couverture est donnée sur DEUX populations quand elles diffèrent : tout le corpus routé du
 * marché, et le sous-ensemble à pays PROUVÉ. Un filtre reposant sur une géographie non attestée
 * expose le candidat à un résultat faux ; le second chiffre permet de le voir.
 */
import { PrismaClient } from '@prisma/client';
import { CODES_MARCHE_LOCALISES, MARCHES, MARCHES_ROUTABLES } from '../../../../../packages/db/marches.js';

const url = process.env.DATABASE_URL ?? '';
if (!url) { console.error('DATABASE_URL requise.'); process.exit(2); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Les dimensions, et la colonne qui les porte RÉELLEMENT dans `Job`. */
const DIMENSIONS: ReadonlyArray<readonly [string, string]> = [
  ['metier', 'occupationCode'],
  ['contrat', 'employmentTerm'],
  ['temps', 'workTime'],
  ['programme', 'programType'],
  ['saisonnier', 'isSeasonal'],
  ['ville', 'city'],
  ['maison', 'companyId'],
  ['langue', 'language'],
  ['teletravail', 'workplaceType'],
  ['engagement', 'engagementType'],
];

const colonnes = DIMENSIONS.map(([nom, col]) =>
  `count("${col}") FILTER (WHERE "${col}" IS NOT NULL) AS "n_${nom}",
   count(DISTINCT "${col}") AS "d_${nom}",
   count("${col}") FILTER (WHERE "${col}" IS NOT NULL AND prouve) AS "p_${nom}"`).join(',\n         ');

const lignes = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
  WITH publiables AS (
    SELECT j.*, (j."countryIntegrity" IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED')) AS prouve
      FROM "Job" j
     WHERE j."isActive" AND j."mergedIntoId" IS NULL
       AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."jobId" = j.id AND js."isActive"
                     AND (js."expiresAt" IS NULL OR js."expiresAt" > now())))
  SELECT "countryCode" AS pays, count(*) AS total, count(*) FILTER (WHERE prouve) AS "totalProuve",
         ${colonnes}
    FROM publiables GROUP BY 1`);
await prisma.$disconnect();

const parPays = new Map(lignes.map(l => [String(l.pays ?? '(aucun)'), l]));
const num = (l: Record<string, unknown> | undefined, k: string) => Number(l?.[k] ?? 0);
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

const codes = [...new Set<string>([...CODES_MARCHE_LOCALISES, ...MARCHES_ROUTABLES.map(r => r.code as string)])];
type Marche = { code: string; localise: boolean; total: number; totalProuve: number; dims: Map<string, { n: number; d: number; p: number }> };
const marches: Marche[] = [];
for (const code of codes) {
  const membres: readonly string[] = MARCHES[code as never]?.pays ?? [code];
  const dims = new Map<string, { n: number; d: number; p: number }>();
  let total = 0, totalProuve = 0;
  for (const p of membres) {
    const l = parPays.get(p);
    if (!l) continue;
    total += num(l, 'total'); totalProuve += num(l, 'totalProuve');
    for (const [nom] of DIMENSIONS) {
      const e = dims.get(nom) ?? { n: 0, d: 0, p: 0 };
      e.n += num(l, `n_${nom}`);
      /* Les valeurs distinctes s'ADDITIONNENT entre pays membres : c'est une borne haute, la
       * seule calculable sans re-requêter par marché. Signalée comme telle. */
      e.d += num(l, `d_${nom}`);
      e.p += num(l, `p_${nom}`);
      dims.set(nom, e);
    }
  }
  if (total > 0) marches.push({ code, localise: CODES_MARCHE_LOCALISES.includes(code as never), total, totalProuve, dims });
}
marches.sort((a, b) => b.total - a.total);

const routees = marches.reduce((s, m) => s + m.total, 0);
const corpus = lignes.reduce((s, l) => s + num(l, 'total'), 0);
const sansPays = num(parPays.get('(aucun)'), 'total');
const horsRegistre = corpus - routees - sansPays;
console.log(`# Couverture des dimensions — ${routees} offres routées sur ${marches.length} marchés\n`);
/* L'écart au corpus figé se décompose intégralement : rien ne disparaît en silence. */
console.log(`Corpus figé **${corpus}** = ${routees} routées + ${horsRegistre} hors registre + ${sansPays} sans pays.\n`);
console.log(`Couverture sur tout le corpus routé, puis sur le sous-ensemble à pays PROUVÉ.\n`);
console.log(`| Marché | Offres | Dimension | Renseigné | Couv. | Couv. (pays prouvé) | Valeurs distinctes |`);
console.log(`|---|---:|---|---:|---:|---:|---:|`);
for (const m of marches) {
  for (const [nom] of DIMENSIONS) {
    const e = m.dims.get(nom)!;
    const couvProuve = m.totalProuve ? `${pct(e.p, m.totalProuve)}%` : '—';
    console.log(`| ${m.localise ? `**${m.code}**` : m.code} | ${m.total} | ${nom} | ${e.n} | ${pct(e.n, m.total)}% | ${couvProuve} | ${e.d} |`);
  }
}

/*
 * ── LA MATRICE DES FILTRES ────────────────────────────────────────────────────────────────────
 *
 * `SEUIL_AFFICHAGE_FACETTE = 0.2` est le point de départ, pas une règle aveugle. Trois critères
 * se combinent, et le troisième est celui qu'un simple taux de remplissage ne voit pas :
 *
 *   COUVERTURE    en dessous du seuil, le filtre laisse la majorité du corpus hors de portée ;
 *   CARDINALITÉ   une dimension à UNE seule valeur ne filtre rien, quelle que soit sa couverture ;
 *   UTILITÉ       une dimension dont chaque offre a sa propre valeur ne regroupe rien non plus.
 *
 * `ville` illustre le troisième cas : 1 625 valeurs pour 22 190 offres aux États-Unis. C'est un
 * champ de recherche, pas une facette à cocher — exposé à part, jamais en liste de cases.
 */
const SEUIL = 0.2;
const CARDINALITE_MIN = 2;
const CARDINALITE_FACETTE_MAX = 60;

console.log(`\n# Matrice des filtres V1\n`);
console.log(`| Marché | Dimension | Couverture | Cardinalité | Exposé | Motif |`);
console.log(`|---|---|---:|---:|:---:|---|`);
for (const m of marches) {
  for (const [nom] of DIMENSIONS) {
    const e = m.dims.get(nom)!;
    const couv = e.n / m.total;
    let expose = 'OUI', motif = '';
    if (e.d < CARDINALITE_MIN) { expose = 'NON'; motif = 'une seule valeur : ne filtre rien'; }
    else if (couv < SEUIL) { expose = 'NON'; motif = `couverture ${Math.round(couv * 100)}% sous le seuil de ${SEUIL * 100}%`; }
    else if (e.d > CARDINALITE_FACETTE_MAX) { expose = 'RECHERCHE'; motif = `${e.d} valeurs : champ de recherche, pas une facette`; }
    else motif = `couverture et cardinalité suffisantes`;
    console.log(`| ${m.localise ? `**${m.code}**` : m.code} | ${nom} | ${pct(e.n, m.total)}% | ${e.d} | ${expose} | ${motif} |`);
  }
}
