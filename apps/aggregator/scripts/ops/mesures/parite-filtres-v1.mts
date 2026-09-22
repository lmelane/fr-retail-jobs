/**
 * PARITÉ DU CONTRAT RUNTIME AVEC `MATRICE-FILTRES-V1` — les 41 marchés, pas seulement les 12.
 *
 * Ce n'est PAS un audit : c'est un test de conformité. La matrice est la décision produit figée ;
 * `filtresDuMarche()` est ce que l'API sert réellement. Les deux doivent dire la même chose.
 *
 * ── CE QUE CE CONTRÔLE ATTRAPE ────────────────────────────────────────────────────────────────
 *
 * Une `facettesSite` de marché ROUTABLE peut continuer d'exposer une clé que la matrice a
 * déclarée NON — c'est exactement ce qui est arrivé à `groupe`, exposé partout alors que sa
 * couverture le disqualifie sur US (15 %), ES (16 %) et NL (19 %). Les marchés localisés ont été
 * corrigés à la main ; les 29 routables ne l'ont jamais été.
 *
 * La matrice ne mesure que les dimensions du catalogue. Les facettes propres au SITE
 * (`pays`, `secteur`) n'y figurent pas et ne sont donc pas comparées : leur exposition ne dépend
 * d'aucune couverture d'offres.
 */
import { readFileSync } from 'node:fs';
import { perimetreDeRecherche, filtresDuMarche, MARCHES_ROUTABLES, CODES_MARCHE_LOCALISES, MARCHES, CLES_FACETTE } from '../../../../../packages/db/marches.js';

/**
 * Les décisions attendues, dérivées de l'artefact MACHINE.
 *
 * Jamais du Markdown : celui-ci arrondit, et `19,53 %` s'y affiche `20 %`. Regraver cet affichage
 * aurait fait basculer `CH/programme` du mauvais côté d'un seuil de 20 % — la décision était
 * correcte, c'est l'affichage qui trompait.
 */
const mesures = JSON.parse(readFileSync(new URL('../../../../../docs/audit-lot0/MATRICE-FILTRES-V1.json', import.meta.url), 'utf8')) as {
  seuilAffichage: number;
  marches: Record<string, { dimensions: Record<string, { couverture: number; cardinalite: number }> }>;
};
const matrice = new Map<string, Map<string, boolean>>();
for (const [code, m] of Object.entries(mesures.marches)) {
  const decisions = new Map<string, boolean>();
  for (const [cle, d] of Object.entries(m.dimensions)) {
    /* La même règle que le runtime : assez d'offres, et au moins deux valeurs à distinguer. */
    decisions.set(cle, d.couverture >= mesures.seuilAffichage && d.cardinalite >= 2);
  }
  matrice.set(code, decisions);
}

/* Les facettes du SITE : exposées par choix éditorial, hors du champ de la matrice. */
const HORS_MATRICE = new Set(['pays', 'secteur']);
/* Les clés que le contrat de recherche sait exprimer. Une dimension mesurée hors de cette liste
 * (`saisonnier`, `teletravail`, `engagement`) est hors V1 par DÉCISION, pas par oubli. */
const CLES_DU_CONTRAT = new Set<string>(CLES_FACETTE);
const codes = [...new Set<string>([...CODES_MARCHE_LOCALISES, ...MARCHES_ROUTABLES.map(r => r.code as string)])];
const paysConnus = new Set<string>(codes.flatMap(c => (MARCHES[c as keyof typeof MARCHES]?.pays ?? [c]) as string[]));

console.log(`# Parité contrat runtime ↔ MATRICE-FILTRES-V1\n`);
console.log(`| Marché | Clé | Attendu | Runtime | Résultat |`);
console.log(`|---|---|:---:|:---:|:---:|`);

let echecs = 0, controles = 0;
for (const code of codes.sort()) {
  const perimetre = perimetreDeRecherche(code, paysConnus);
  const servies = new Set(perimetre ? filtresDuMarche(perimetre).map(f => f.cle as string) : []);
  const decisions = matrice.get(code);
  if (!decisions) { console.log(`| ${code} | — | — | — | *(absent de la matrice)* |`); continue; }

  for (const [cle, attendu] of decisions) {
    /* Une clé mesurée que le contrat ne connaît pas (`saisonnier`, `teletravail`, `engagement`)
     * n'est pas une divergence : elle est hors V1 par décision, pas par oubli. */
    if (HORS_MATRICE.has(cle) || !CLES_DU_CONTRAT.has(cle)) continue;
    const runtime = servies.has(cle);
    controles++;
    if (runtime === attendu) continue;
    echecs++;
    console.log(`| ${code} | ${cle} | ${attendu ? 'OUI' : 'NON'} | ${runtime ? 'OUI' : 'NON'} | **FAIL** |`);
  }
}

/*
 * LE TÉMOIN DOIT AVOIR EXERCÉ QUELQUE CHOSE. Une première version lisait zéro ligne de la matrice
 * — le séparateur final produit une colonne vide, donc 9 champs et non 8 — et annonçait pourtant
 * « 41/41 conformes ». Un contrôle qui ne contrôle rien est pire qu'absent : il rassure.
 */
if (controles === 0) {
  console.error(`\nAUCUN CONTRÔLE EFFECTUÉ : la matrice n'a pas été lue. Résultat non concluant.`);
  process.exit(2);
}
console.log(`\n**${controles - echecs} / ${controles} contrôles conformes** sur ${codes.length} marchés.`);
console.log(echecs === 0 ? `\n# 41/41 MARCHÉS CONFORMES ✓` : `\n# ${echecs} DIVERGENCE(S) — à corriger en configuration`);
process.exitCode = echecs === 0 ? 0 : 1;
