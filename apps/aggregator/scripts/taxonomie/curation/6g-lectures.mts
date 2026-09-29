/**
 * PASSE DE CURATION v3, ÉTAPE 6g : VÉRIFIER CE QU'UNE EXPRESSION CAPTE QUAND ON LA LIT DANS UN INTITULÉ PLUS LONG
 * (D-475 point 38, R-66 §2 ; plan `docs/architecture/classification-metiers.md` §3.3).
 *
 * Les métiers lus dans l'intitulé (`titleRoles`) ajoutent aux candidats du moteur ceux que le résolveur de la recherche
 * lit dans l'intitulé. Lue sans preuve, toute expression du vocabulaire, la lecture était fausse pour 17 % des offres
 * (étape 6f, tour 1) : elle reprenait les généralisations que l'étape 6c avait rejetées (« Commercial Controller » →
 * commercial, « Extra salle » → figurant, « Data Product Manager » → chef de produit). Même protocole que 6c, sur ce que
 * la LECTURE capte :
 *  - pour chaque expression lue dans un intitulé plus long (packages/db/occupation-title-roles.ts,
 *    `occupationTitleReadings`), les couples (intitulé, service) du corpus où elle AJOUTE un métier au moteur ;
 *  - une expression qui capte au moins `SEUIL_OFFRES` offres est jugée sur ses intitulés captés (le plus fréquent, puis
 *    ceux qui ajoutent le plus de mots, les plus susceptibles de dévier ; davantage pour un mot seul, qui peut être un
 *    adjectif ou la tête de plusieurs métiers) par deux juges, avec la grille de la mesure 6f : un seul « autre métier »
 *    et elle ne vaut que pour l'intitulé exact ; sinon elle devient une expression lue (`titleReadingAliases`) ;
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
import { compileOccupationManifest, normalizeOccupationTitle, occupationTitleReadings } from '../../../../../packages/db/occupations.ts';
import { DOSSIER_SORTIE as D, lireEtape } from './commun.mts';

const SEUIL_OFFRES = 5, ECHANTILLON = 4, ECHANTILLON_MOT_SEUL = 6;
const m = lireEtape('6-manifeste-v3.json'), v3 = compileOccupationManifest(m);
const { couples } = JSON.parse(gunzipSync(readFileSync(`${D}entrees/offres-preview-2026-09-29.json.gz`)).toString('utf8'));
const metier = new Map(m.occupations.map((o: any) => [o.key, o]));

type Capture = { phrase: string; occupation: string; titres: Map<string, { offres: number; service: string | null }> };
const captures = new Map<string, Capture>();
for (const c of couples) {
  const candidats = v3.classify(c.titre, c.service).occupationEvidence.candidates;
  for (const l of occupationTitleReadings(v3, c.titre)) {
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
  const extra = (t: string) => normalizeOccupationTitle(t).split(/\s+/).length;
  const n = x.phrase.includes(' ') ? ECHANTILLON : ECHANTILLON_MOT_SEUL;
  const choisis = [titres[0], ...titres.slice(1).sort((a, b) => extra(b[0]) - extra(a[0]) || b[1].offres - a[1].offres || a[0].localeCompare(b[0]))].slice(0, n);
  return { x, titres: choisis.map(([titre, v]) => ({ titre, service: v.service })) };
});
const paires = echantillons.flatMap((e) => e.titres.map((t) => ({ e, t })));
const CONSIGNE = `Tu évalues, pour un job board du luxe, de la mode et de la beauté, le métier qu'on lit dans l'intitulé d'une offre pour qu'une recherche par ce métier la retrouve. Pour chaque offre (intitulé, service), note le métier lu : "C" l'offre est bien un poste de ce métier ; "P" métier voisin (niveau ou spécialité proche) ; "F" un autre métier (règle du produit : un poste d'encadrement est un autre métier que celui qu'il encadre ; un mot du métier employé dans un autre sens, comme un adjectif ou un nom de lieu, est un autre métier).`;
const SCHEMA = { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, verdict: { type: 'STRING', enum: ['C', 'P', 'F'] } }, required: ['i', 'verdict'] };
const rendu = (lot: typeof paires) => lot.map((p, j) => {
  const o: any = metier.get(p.e.x.occupation);
  return `[${j}] « ${p.t.titre} »${p.t.service ? ` (service : ${p.t.service})` : ''} → métier lu : ${o.labels.fr} / ${o.labels.en ?? o.labels.fr}`;
}).join('\n');
const [v1, v2] = [await repondre(JUGES_6G[0], CONSIGNE, paires, 25, rendu, SCHEMA), await repondre(JUGES_6G[1], CONSIGNE, paires, 25, rendu, SCHEMA)];
const decisions = echantillons.map((e) => {
  const juges = paires.map((p, n) => ({ p, j1: v1[n]?.verdict ?? null, j2: v2[n]?.verdict ?? null })).filter((x) => x.p.e === e)
    .map(({ p, j1, j2 }) => ({ titre: p.t.titre, j1, j2 }));
  const mode = juges.some((j) => j.j1 === 'F' || j.j2 === 'F') ? 'exacte' : juges.every((j) => j.j1 && j.j2) ? 'lue' : 'indetermine';
  return { phrase: e.x.phrase, occupation: e.x.occupation, mode, offres: offresDe(e.x), juges };
});
const sousSeuil = toutes.filter((x) => offresDe(x) < SEUIL_OFFRES).map((x) => ({ phrase: x.phrase, occupation: x.occupation, mode: 'exacte', offres: offresDe(x) }));
const offresPar = (mode: string) => decisions.filter((d) => d.mode === mode).reduce((n, d) => n + d.offres, 0);
const bilan = { expressionsLues: toutes.length, offresCaptees: total, jugees: decisions.length,
  lues: decisions.filter((d) => d.mode === 'lue').length, exactes: decisions.filter((d) => d.mode === 'exacte').length,
  indeterminees: decisions.filter((d) => d.mode === 'indetermine').length, sousSeuil: sousSeuil.length,
  offresLues: offresPar('lue'), offresRameneesALExact: offresPar('exacte') + sousSeuil.reduce((n, x) => n + x.offres, 0),
  seuils: { SEUIL_OFFRES, ECHANTILLON, ECHANTILLON_MOT_SEUL } };
writeFileSync(`${D}6g-lectures.json`, JSON.stringify({ calculeLe: new Date().toISOString(), manifeste: m.id,
  empreinteManifeste: createHash('sha256').update(readFileSync(`${D}6-manifeste-v3.json`)).digest('hex'),
  juges: JUGES_6G, bilan, decisions, sousSeuil }, null, 1));
console.log(JSON.stringify(bilan, null, 1));
for (const d of decisions.filter((x) => x.mode === 'exacte').sort((a, b) => b.offres - a.offres).slice(0, 20))
  console.log(` exacte : ${d.phrase} → ${d.occupation} (${d.offres} offres) ; autre métier : ${d.juges.filter((j) => j.j1 === 'F' || j.j2 === 'F').map((j) => j.titre).join(' · ')}`);
if (bilan.indeterminees) { console.error(`ÉTAPE INCOMPLÈTE : ${bilan.indeterminees} expression(s) sans verdict complet`); process.exitCode = 1; }
