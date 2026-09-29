/**
 * PASSE DE CURATION v3, ÉTAPE 5d : LES FORMES GRAMMATICALES DES LIBELLÉS CORRIGÉS (D-475 §31 c : toutes les formes
 * d'un nom sont reconnues).
 *
 * L'étape 5 donne pour chaque libellé ses formes de genre (« Vendeuse » pour « Vendeur ») ; quand 5b corrige un libellé,
 * les formes de l'ancien nom ne valent plus (`libellesEtFormes`, commun.mts) et le nouveau nom n'en avait aucune (audit
 * du 29/09/2026 : « Employée de rayon » ne classait plus rien, 30 couples métier et langue sans leurs formes). Ici, pour
 * chaque libellé corrigé par 5b dans une langue où l'étape 5 donne des formes, le modèle de choix donne ses autres formes
 * de genre telles qu'elles s'écrivent dans les offres ; une forme vide, identique au libellé, à barre ou à parenthèse est
 * écartée. La garde d'unicité (5c) et l'assemblage les traitent ensuite comme les formes de l'étape 5.
 * Entrées : étapes 5, 5b, fusions de 5c. Sortie : `curation-v3/5d-formes.json`, lue par `libellesEtFormes`.
 *
 *   node --env-file=<fichier .env portant GEMINI_API_KEY> --import tsx \
 *     apps/aggregator/scripts/taxonomie/curation/5d-formes.mts
 */
import { existsSync, writeFileSync } from 'node:fs';
import { DOSSIER_SORTIE, lireEtape, phraseMoteur } from './commun.mts';
import { MODELE_CHOIX, repondre } from './ia.mts';

const e5 = lireEtape('5-libelles.json'), e5b = lireEtape('5b-libelles-corrections.json');
const absorbes = new Set<string>(existsSync(`${DOSSIER_SORTIE}5c-garde.json`) ? lireEtape('5c-garde.json').fusions.map((f: any) => f.absorbe) : []);
// Les langues où l'étape 5 a trouvé des formes de genre : là seulement un nom de métier varie.
const GENRE = new Set<string>(e5.metiers.flatMap((m: any) => Object.entries<string[]>(m.formes ?? {}).filter(([, f]) => f?.length).map(([l]) => l)));

type Element = { cle: string; noms: { langue: string; libelle: string }[] };
const elements: Element[] = e5.metiers.filter((m: any) => !absorbes.has(m.cle)).map((m: any) => ({ cle: m.cle,
  noms: Object.entries<string>(e5b.libelles[m.cle] ?? {}).filter(([l, v]) => GENRE.has(l) && v && v !== m.libelles?.[l]).map(([langue, libelle]) => ({ langue, libelle })) }))
  .filter((e: Element) => e.noms.length);

const CONSIGNE = `Pour chaque métier, voici des noms de métier dans plusieurs langues. Donne pour chaque nom ses AUTRES formes de genre telles qu'elles s'écrivent dans les offres d'emploi du pays : le féminin d'un nom au masculin, le masculin d'un nom au féminin (« Employé de rayon » → « Employée de rayon » ; « Verkäufer » → « Verkäuferin »). Une forme par entrée, sans barre ni parenthèse ni point médian. Liste vide si le nom ne varie pas en genre (nom épicène, langue sans genre).`;
const SCHEMA = { type: 'OBJECT', required: ['i', 'noms'], properties: { i: { type: 'INTEGER' }, noms: { type: 'ARRAY', items: { type: 'OBJECT',
  required: ['langue', 'formes'], properties: { langue: { type: 'STRING' }, formes: { type: 'ARRAY', items: { type: 'STRING' } } } } } } };
const rendu = (lot: Element[]) => lot.map((e, j) => `[${j}] ${e.noms.map((n) => `${n.langue} : « ${n.libelle} »`).join(' ; ')}`).join('\n');
const reponses = await repondre(MODELE_CHOIX, CONSIGNE, elements, 20, rendu, SCHEMA, (r) => Array.isArray(r.noms));

const formes: Record<string, Record<string, string[]>> = {};
let proposees = 0, ecartees = 0, sansReponse = 0;
elements.forEach((e, n) => {
  if (!reponses[n]) { sansReponse++; return; }
  for (const nom of e.noms) {
    const brutes: string[] = reponses[n].noms.find((x: any) => x.langue === nom.langue)?.formes ?? [];
    proposees += brutes.length;
    const bonnes = [...new Set(brutes.map((f) => f.trim()))].filter((f) => f && !/[/()·]/.test(f) && phraseMoteur(f) && phraseMoteur(f) !== phraseMoteur(nom.libelle));
    ecartees += brutes.length - bonnes.length;
    if (bonnes.length) (formes[e.cle] ??= {})[nom.langue] = bonnes;
  }
});
const bilan = { langues: [...GENRE], metiers: elements.length, noms: elements.reduce((s, e) => s + e.noms.length, 0), proposees, ecartees, sansReponse,
  nomsAvecFormes: Object.values(formes).reduce((s, x) => s + Object.keys(x).length, 0) };
writeFileSync(`${DOSSIER_SORTIE}5d-formes.json`, JSON.stringify({ calculeLe: new Date().toISOString(), modele: MODELE_CHOIX, bilan, formes }, null, 1));
console.log(JSON.stringify(bilan));
if (sansReponse) { console.error(`ÉTAPE INCOMPLÈTE : ${sansReponse} métier(s) sans réponse`); process.exitCode = 1; }
