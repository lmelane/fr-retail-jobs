/**
 * PASSE DE CURATION v3, ÉTAPE 6g : VÉRIFIER CE QU'UNE EXPRESSION CAPTE QUAND ON LA LIT DANS UN INTITULÉ PLUS LONG
 * (D-475 point 38 ; plan `docs/architecture/classification-metiers.md` §3.1).
 *
 * Les métiers lus dans l'intitulé (`titleRoles`) ajoutent aux candidats du moteur ceux que le résolveur de la recherche
 * lit dans l'intitulé. Lue sans preuve, toute expression du vocabulaire, la lecture était fausse pour 18,5 % des offres
 * selon l'assistant et 16,5 % selon le juge (étape 6f, tour 1) : elle reprenait les généralisations que l'étape 6c avait rejetées (« Commercial Controller » →
 * commercial, « Extra salle » → figurant, « Data Product Manager » → chef de produit). Même protocole que 6c, sur ce que
 * la LECTURE capte :
 *  - pour chaque expression lue dans un intitulé plus long (packages/db/occupation-title-roles.ts,
 *    `occupationTitleReadings`), les couples (intitulé, service) du corpus où elle AJOUTE un métier au moteur ;
 *  - une expression qui capte au moins `SEUIL_OFFRES` offres est jugée sur des intitulés captés tirés pour être
 *    REPRÉSENTATIFS : le plus fréquent, puis un tirage reproductible (empreinte), √n intitulés distincts bornés entre
 *    `ECHANTILLON` (`ECHANTILLON_MOT_SEUL` pour un mot seul, qui peut être un adjectif ou la tête de plusieurs métiers) et
 *    `ECHANTILLON_MAX`. Le premier passage prenait les intitulés les plus LONGS : les qualificatifs courts qui changent
 *    de métier (« IT Operations Manager », « Digital Product Manager ») n'y paraissaient jamais (mesure 6f, tour 2) ;
 *  - deux juges, avec la grille partagée avec la mesure 6f (`GRILLE_METIER_LU`) et la FAMILLE du métier (« Operations
 *    Manager » est celui des opérations de boutique) : un seul « autre métier » et elle ne vaut que pour l'intitulé
 *    exact ; sinon elle devient une expression lue (`titleReadingAliases`) ;
 *  - en dessous du seuil, sans preuve : intitulé exact.
 * Les juges ne sont pas celui de la mesure (6f), qui reste indépendant. Sortie : `curation-v3/6g-lectures.json`, que lit
 * l'assemblage (étape 6). L'étape échoue si un verdict manque.
 *
 *   node --import tsx apps/aggregator/scripts/taxonomie/curation/6g-lectures.mts --compter
 *   node --env-file=<.env portant GEMINI_API_KEY> --import tsx apps/aggregator/scripts/taxonomie/curation/6g-lectures.mts
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { compileOccupationManifest, occupationTitleReadings } from '../../../../../packages/db/occupations.ts';
import { DOSSIER_SORTIE as D, GRILLE_METIER_LU, lireEtape } from './commun.mts';

const SEUIL_OFFRES = 5, ECHANTILLON = 4, ECHANTILLON_MOT_SEUL = 6, ECHANTILLON_MAX = 15;
const m = lireEtape('6-manifeste-v3.json'), v3 = compileOccupationManifest(m);
const { couples } = JSON.parse(gunzipSync(readFileSync(`${D}entrees/offres-preview-2026-09-29.json.gz`)).toString('utf8'));
const metier = new Map(m.occupations.map((o: any) => [o.key, o]));
const famille = new Map<string, string>(m.families.map((f: any) => [f.key, f.labels.fr]));

type Capture = { phrase: string; occupation: string; titres: Map<string, { offres: number; service: string | null }> };
const captures = new Map<string, Capture>();
for (const c of couples) {
  const d = v3.classify(c.titre, c.service), candidats = d.occupationEvidence.candidates;
  for (const l of occupationTitleReadings(v3, c.titre, d)) {
    if (candidats.includes(l.role)) continue;
    const k = `${l.phrase}|${l.role}`;
    const x = captures.get(k) ?? { phrase: l.phrase, occupation: l.role, titres: new Map() };
    const t = x.titres.get(c.titre) ?? { offres: 0, service: c.service };
    t.offres += c.offres;
    x.titres.set(c.titre, t);
    captures.set(k, x);
  }
}
const offresDe = (x: Capture) => [...x.titres.values()].reduce((n, t) => n + t.offres, 0);
const toutes = [...captures.values()];
const aJuger = toutes.filter((x) => offresDe(x) >= SEUIL_OFFRES);
const total = toutes.reduce((n, x) => n + offresDe(x), 0);

if (process.argv.includes('--compter')) {
  for (const s of [3, 5, 10]) {
    const l = toutes.filter((x) => offresDe(x) >= s);
    console.log(`seuil ${s} : ${l.length} expressions (${l.filter((x) => !x.phrase.includes(' ')).length} mots seuls), ${l.reduce((n, x) => n + offresDe(x), 0)} offres sur ${total}`);
  }
  process.exit(0);
}

const { JUGES, MODELE_CHOIX, repondre } = await import('./ia.mts');
const JUGES_6G = [MODELE_CHOIX, JUGES.j2];
const echantillons = aJuger.map((x) => {
  const titres = [...x.titres].sort((a, b) => b[1].offres - a[1].offres || a[0].localeCompare(b[0]));
  const alea = (t: string) => createHash('sha256').update(`6g|${x.phrase}|${x.occupation}|${t}`).digest('hex');
  const n = Math.min(titres.length, ECHANTILLON_MAX, Math.max(x.phrase.includes(' ') ? ECHANTILLON : ECHANTILLON_MOT_SEUL, Math.ceil(Math.sqrt(titres.length))));
  const choisis = [titres[0], ...titres.slice(1).sort((a, b) => alea(a[0]).localeCompare(alea(b[0])))].slice(0, n);
  return { x, titres: choisis.map(([titre, v]) => ({ titre, service: v.service })) };
});
const paires = echantillons.flatMap((e) => e.titres.map((t) => ({ e, t })));
const CONSIGNE = GRILLE_METIER_LU;
const SCHEMA = { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, verdict: { type: 'STRING', enum: ['C', 'P', 'F'] } }, required: ['i', 'verdict'] };
const rendu = (lot: typeof paires) => lot.map((p, j) => {
  const o: any = metier.get(p.e.x.occupation);
  return `[${j}] « ${p.t.titre} »${p.t.service ? ` (service : ${p.t.service})` : ''} → métier lu : ${o.labels.fr} / ${o.labels.en ?? o.labels.fr} (famille : ${famille.get(o.family)})`;
}).join('\n');
const [v1, v2] = [await repondre(JUGES_6G[0], CONSIGNE, paires, 25, rendu, SCHEMA), await repondre(JUGES_6G[1], CONSIGNE, paires, 25, rendu, SCHEMA)];
const decisions = echantillons.map((e) => {
  const juges = paires.map((p, n) => ({ p, j1: v1[n]?.verdict ?? null, j2: v2[n]?.verdict ?? null })).filter((x) => x.p.e === e)
    .map(({ p, j1, j2 }) => ({ titre: p.t.titre, j1, j2 }));
  // Un seul « autre métier » ramène l'expression à l'intitulé exact. Un métier voisin (P) ne la retire pas : exiger une
  // capture « le métier lui-même » retirait sans le dire les expressions captées seulement par des assistants
  // (« Stage - Assistant(e) chef de projet digital »), question posée au CEO (audit du 29/09/2026).
  const mode = juges.some((j) => j.j1 === 'F' || j.j2 === 'F') ? 'exacte' : juges.every((j) => j.j1 && j.j2) ? 'lue' : 'indetermine';
  return { phrase: e.x.phrase, occupation: e.x.occupation, mode, offres: offresDe(e.x), juges };
});
const sousSeuil = toutes.filter((x) => offresDe(x) < SEUIL_OFFRES).map((x) => ({ phrase: x.phrase, occupation: x.occupation, mode: 'exacte', offres: offresDe(x) }));
const offresPar = (mode: string) => decisions.filter((d) => d.mode === mode).reduce((n, d) => n + d.offres, 0);
const bilan = { expressionsLues: toutes.length, offresCaptees: total, jugees: decisions.length,
  lues: decisions.filter((d) => d.mode === 'lue').length, exactes: decisions.filter((d) => d.mode === 'exacte').length,
  indeterminees: decisions.filter((d) => d.mode === 'indetermine').length, sousSeuil: sousSeuil.length,
  offresLues: offresPar('lue'), offresRameneesALExact: offresPar('exacte') + sousSeuil.reduce((n, x) => n + x.offres, 0),
  seuils: { SEUIL_OFFRES, ECHANTILLON, ECHANTILLON_MOT_SEUL, ECHANTILLON_MAX }, paires: paires.length };
writeFileSync(`${D}6g-lectures.json`, JSON.stringify({ calculeLe: new Date().toISOString(), manifeste: m.id,
  empreinteManifeste: createHash('sha256').update(readFileSync(`${D}6-manifeste-v3.json`)).digest('hex'),
  juges: JUGES_6G, bilan, decisions, sousSeuil }, null, 1));
console.log(JSON.stringify(bilan, null, 1));
for (const d of decisions.filter((x) => x.mode === 'exacte').sort((a, b) => b.offres - a.offres).slice(0, 20))
  console.log(` exacte : ${d.phrase} → ${d.occupation} (${d.offres} offres) ; autre métier : ${d.juges.filter((j) => j.j1 === 'F' || j.j2 === 'F').map((j) => j.titre).join(' · ')}`);
if (bilan.indeterminees) { console.error(`ÉTAPE INCOMPLÈTE : ${bilan.indeterminees} expression(s) sans verdict complet`); process.exitCode = 1; }
