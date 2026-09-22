/**
 * COUVERTURE DES DIMENSIONS PAR MARCHÉ — lecture seule sur CORPUS_ANALYTIQUE_V1_POST_GEO.
 *
 * Deux repères distincts, à ne jamais confondre :
 *   CATALOGUE_CONSOLIDE_V1          40 068 — la baseline FIGÉE, qui ne change plus ;
 *   CORPUS_ANALYTIQUE_V1_POST_GEO   40 091 — le corpus d'analyse, après le lot géographique
 *                                   (+23 offres apparues lors des collectes live de ce lot).
 * Une baseline freeze ne se renomme pas après coup : elle vaut ce qu'elle valait.
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
import { writeFileSync } from 'node:fs';
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
  ['groupe', 'groupeNom'],
];

const colonnes = DIMENSIONS.map(([nom, col]) =>
  `count("${col}") FILTER (WHERE "${col}" IS NOT NULL) AS "n_${nom}",
   count(DISTINCT "${col}") AS "d_${nom}",
   count("${col}") FILTER (WHERE "${col}" IS NOT NULL AND prouve) AS "p_${nom}"`).join(',\n         ');

const lignes = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
  WITH publiables AS (
    /* Le groupe ne vit pas sur Job mais sur Company. On lit parentGroup (le NOM, 19 valeurs sur
     * le corpus) et non parentGroupId (une seule valeur) : c est le nom que l API interroge
     * (job-search-query.ts, companies.ts), donc la colonne qui gouverne reellement la facette. */
    SELECT j.*, c."parentGroup" AS "groupeNom",
           (j."countryIntegrity" IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED')) AS prouve
      FROM "Job" j LEFT JOIN "Company" c ON c.id = j."companyId"
     WHERE j."isActive" AND j."mergedIntoId" IS NULL
       AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."jobId" = j.id AND js."isActive"
                     AND (js."expiresAt" IS NULL OR js."expiresAt" > now())))
  SELECT "countryCode" AS pays, count(*) AS total, count(*) FILTER (WHERE prouve) AS "totalProuve",
         ${colonnes}
    FROM publiables GROUP BY 1`);
await prisma.$disconnect();

const parPays = new Map(lignes.map(l => [String(l.pays ?? '(aucun)'), l]));
const num = (l: Record<string, unknown> | undefined, k: string) => Number(l?.[k] ?? 0);
/* Une décimale : `19,5 %` ne doit pas s'afficher `20 %` à côté d'un seuil de 20 %. */
const pct = (a: number, b: number) => (b ? Number(((100 * a) / b).toFixed(1)) : 0);

const codes = [...new Set<string>([...CODES_MARCHE_LOCALISES, ...MARCHES_ROUTABLES.map(r => r.code as string)])];
type Marche = { code: string; localise: boolean; total: number; totalProuve: number; dims: Map<string, { n: number; d: number; p: number }> };
const marches: Marche[] = [];
for (const code of codes) {
  const membres: readonly string[] = MARCHES[code as keyof typeof MARCHES]?.pays ?? [code];
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
  if (total > 0) marches.push({ code, localise: (CODES_MARCHE_LOCALISES as readonly string[]).includes(code), total, totalProuve, dims });
}
marches.sort((a, b) => b.total - a.total);

const routees = marches.reduce((s, m) => s + m.total, 0);
const corpus = lignes.reduce((s, l) => s + num(l, 'total'), 0);
const sansPays = num(parPays.get('(aucun)'), 'total');
const horsRegistre = corpus - routees - sansPays;
console.log(`# Couverture des dimensions — ${routees} offres routées sur ${marches.length} marchés\n`);
/* L'écart au corpus figé se décompose intégralement : rien ne disparaît en silence. */
console.log(`\`CORPUS_ANALYTIQUE_V1_POST_GEO\` **${corpus}** = ${routees} routées + ${horsRegistre} hors registre + ${sansPays} sans pays.`);
console.log(`\nBaseline figée \`CATALOGUE_CONSOLIDE_V1\` = **40 068**, inchangée : les +23 viennent des collectes live du lot géographique, et une baseline freeze ne change pas de valeur après coup.\n`);
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
const CARDINALITE_FACETTE_MAX = 60;
/*
 * TOUTES LES DIMENSIONS NE SONT PAS DES LISTES DE CASES À COCHER. Une première version écartait
 * `saisonnier` au motif qu'il ne porte qu'UNE valeur (`true`) — or c'est précisément la forme
 * d'un TOGGLE : « Saisonnier uniquement ». La cardinalité 1 disqualifie une facette, pas un
 * booléen. Et une forte cardinalité ne disqualifie pas non plus `maison` : elle en fait une
 * recherche par autocomplétion, pas un filtre à supprimer.
 */
const BOOLEENNES = new Set(['saisonnier']);

console.log(`\n# Matrice des filtres V1\n`);
console.log(`| Marché | Dimension | Couverture | Cardinalité | Type UI | Exposé | Motif |`);
console.log(`|---|---|---:|---:|:---:|:---:|---|`);
for (const m of marches) {
  for (const [nom] of DIMENSIONS) {
    const e = m.dims.get(nom)!;
    const couv = e.n / m.total;
    let type = 'FACETTE', expose = 'OUI', motif = 'couverture et cardinalité suffisantes';
    if (BOOLEENNES.has(nom)) {
      /* Un booléen filtre par PRÉSENCE : la seule question est d'avoir assez d'offres à montrer. */
      type = 'TOGGLE';
      if (e.n === 0) { expose = 'NON'; motif = 'aucune offre ne porte la propriété'; }
      else motif = `${e.n} offre(s) portent la propriété : toggle « ${nom} uniquement »`;
    } else if (e.n === 0) { type = 'NON'; expose = 'NON'; motif = 'jamais renseigné'; }
    else if (e.d < 2) { type = 'NON'; expose = 'NON'; motif = 'une seule valeur : ne filtre rien'; }
    else if (couv < SEUIL) { type = 'NON'; expose = 'NON'; motif = `couverture ${Math.round(couv * 100)}% sous le seuil de ${SEUIL * 100}%`; }
    else if (e.d > CARDINALITE_FACETTE_MAX) { type = 'RECHERCHE'; motif = `${e.d} valeurs : recherche par autocomplétion`; }
    console.log(`| ${m.localise ? `**${m.code}**` : m.code} | ${nom} | ${pct(e.n, m.total)}% | ${e.d} | ${type} | ${expose} | ${motif} |`);
  }
}

/*
 * ── L'ARTEFACT MACHINE ────────────────────────────────────────────────────────────────────────
 *
 * Le Markdown est un rapport HUMAIN : il arrondit. `19,53 %` s'y affiche `20 %`, et regraver cet
 * affichage dans le registre changerait la vérité — c'est exactement ce qui a failli faire
 * basculer `CH/programme` du mauvais côté du seuil.
 *
 * Ce fichier porte les valeurs EXACTES, et c'est lui que la configuration et le test de parité
 * consomment. Le Markdown reste lisible ; il ne sert jamais de source de données.
 */
const artefact = {
  corpus: 'CORPUS_ANALYTIQUE_V1_POST_GEO',
  offresPubliables: corpus,
  seuilAffichage: SEUIL,
  marches: Object.fromEntries(marches.map((m) => [m.code, {
    localise: m.localise,
    total: m.total,
    totalProuve: m.totalProuve,
    dimensions: Object.fromEntries([...m.dims].map(([nom, e]) => [nom, {
      renseigne: e.n,
      /* La couverture BRUTE, non arrondie : c'est elle qui décide. */
      couverture: m.total ? e.n / m.total : 0,
      cardinalite: e.d,
      renseigneSurPaysProuve: e.p,
    }])),
  }])),
};
writeFileSync(new URL('../../../../../docs/audit-lot0/MATRICE-FILTRES-V1.json', import.meta.url),
  JSON.stringify(artefact, null, 1));

/* ── LE RÉSUMÉ PAR MARCHÉ : ce que le candidat verra réellement ─────────────────────────────── */
console.log(`\n# Filtres disponibles par marché\n`);
console.log(`| Marché | Offres | Facettes | Recherche | Toggles |`);
console.log(`|---|---:|---|---|---|`);
for (const m of marches) {
  const par: Record<string, string[]> = { FACETTE: [], RECHERCHE: [], TOGGLE: [] };
  for (const [nom] of DIMENSIONS) {
    const e = m.dims.get(nom)!;
    const couv = e.n / m.total;
    if (BOOLEENNES.has(nom)) { if (e.n > 0) par.TOGGLE.push(nom); continue; }
    if (e.n === 0 || e.d < 2 || couv < SEUIL) continue;
    par[e.d > CARDINALITE_FACETTE_MAX ? 'RECHERCHE' : 'FACETTE'].push(nom);
  }
  console.log(`| ${m.localise ? `**${m.code}**` : m.code} | ${m.total} | ${par.FACETTE.join(' · ') || '—'} | ${par.RECHERCHE.join(' · ') || '—'} | ${par.TOGGLE.join(' · ') || '—'} |`);
}
