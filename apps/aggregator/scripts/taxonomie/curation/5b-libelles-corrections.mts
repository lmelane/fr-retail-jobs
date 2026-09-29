/**
 * PASSE DE CURATION v3, ÉTAPE 5b : CORRECTION CIBLÉE DES LIBELLÉS (D-475 §31 c ; plan
 * `docs/architecture/classification-metiers.md` §3.1).
 *
 * L'étape 5 laisse des défauts OBJECTIFS, mesurés sans modèle, qu'on corrige seuls (sans rejouer ses ~75 appels) :
 *  - un libellé qui n'est pas UN nom court (barre, parenthèse : « Barista / Serveur café ») ;
 *  - un libellé en alphabet latin là où l'offre s'écrit toujours dans l'écriture locale (japonais, coréen, chinois,
 *    thaï : « VMD ») ; en grec et en arabe, le titre anglais est un usage courant, pas un défaut ;
 *  - deux métiers affichés sous le même libellé dans une langue (« Tailleur » et « Couturier », « Barista » et « Employé
 *    de café ») : le candidat ne saurait lequel choisir ; le modèle réécrit en voyant les métiers qui se partagent le nom.
 * L'autre modèle relit chaque correction et type ses objections : « sens » (mot faux ou inventé : « Syder » pour une
 * couturière en danois, 29/09/2026) et « forme » repartent en correction, jusqu'à trois tours (davantage fait osciller les deux modèles sur les paires indiscernables : 5 défauts après trois tours, 47 après cinq, 29/09/2026) ; « usage » (un autre terme
 * serait plus courant) est listé sans bloquer. Les signalements de l'étape 5 opposaient surtout l'usage anglais d'un pays
 * (« Community manager » en français) au terme local : la règle est la forme d'usage du pays, anglais compris (D-475
 * §31 c, lecture de l'assistant du 29/09/2026) ; ils sont recopiés au bilan, sans effet sur le classement des offres, qui
 * ne dépend pas du libellé affiché.
 *
 * Entrée : `5-libelles.json`. Sortie : `5b-libelles-corrections.json` (les libellés finaux). L'étape échoue si un défaut
 * objectif, une faute de sens ou de forme reste après trois tours, hors défauts connus.
 *
 *   node --env-file=<fichier .env portant GEMINI_API_KEY> --import tsx \
 *     apps/aggregator/scripts/taxonomie/curation/5b-libelles-corrections.mts
 */
import { writeFileSync } from 'node:fs';
import { normalizeOccupationTitle } from '../../../../../packages/db/occupation-engine.ts';
import { DOSSIER_SORTIE, LANGUES_SITE, lireEtape } from './commun.mts';
import { JUGES, MODELE_CHOIX, repondre } from './ia.mts';

// Seules les langues où l'offre d'emploi s'écrit toujours dans l'écriture locale (translittération comprise) : en grec
// et en arabe, le titre anglais en alphabet latin est un usage courant (relecture du 29/09/2026), il n'est pas un défaut.
const ECRITURE: Record<string, RegExp> = { 'zh-CN': /\p{Script=Han}/u, 'zh-Hant': /\p{Script=Han}/u, ja: /[\p{Script=Katakana}\p{Script=Hiragana}\p{Script=Han}]/u,
  ko: /\p{Script=Hangul}/u, th: /\p{Script=Thai}/u };
const norme = (v: string) => normalizeOccupationTitle(v).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const e5 = lireEtape('5-libelles.json');
type Element = { cle: string; type: 'metier' | 'famille'; libelles: Record<string, string> };
const elements: Element[] = [...e5.metiers.map((m: any) => ({ cle: m.cle, type: 'metier', libelles: { ...m.libelles } })),
  ...e5.familles.map((f: any) => ({ cle: f.cle, type: 'famille', libelles: { ...f.libelles } }))];

/** Les défauts objectifs d'un jeu de libellés : forme (barre, parenthèse), écriture, même libellé pour deux éléments. */
function defauts(liste: Element[]) {
  const out: { cle: string; langue: string; raison: string }[] = [];
  for (const e of liste) for (const l of LANGUES_SITE) if (e.libelles[l] && /[/()]/.test(e.libelles[l]))
    out.push({ cle: e.cle, langue: l, raison: `forme non courte (« ${e.libelles[l]} » : barre ou parenthèse), un seul nom` });
  for (const e of liste) for (const [l, re] of Object.entries(ECRITURE)) if (e.libelles[l] && !re.test(e.libelles[l]))
    out.push({ cle: e.cle, langue: l, raison: `écrit en alphabet latin (« ${e.libelles[l]} ») dans une langue qui s'écrit autrement` });
  for (const type of ['metier', 'famille']) for (const l of LANGUES_SITE) {
    const parForme = new Map<string, Element[]>();
    for (const e of liste.filter((x) => x.type === type)) if (e.libelles[l]) parForme.set(norme(e.libelles[l]), [...(parForme.get(norme(e.libelles[l])) ?? []), e]);
    for (const [, es] of parForme) if (es.length > 1) for (const e of es)
      out.push({ cle: e.cle, langue: l, raison: `même libellé (« ${e.libelles[l]} ») que ${es.filter((x) => x !== e).map((x) => `${x.libelles.fr} / ${x.libelles.en}`).join(', ')}` });
  }
  return out;
}

const avant = defauts(elements);
const cleSchema = (l: string) => l.replace('-', '_');
const CONSIGNE = `Tu corriges les noms des métiers et familles de Catwalks (luxe, mode, beauté, retail) dans certaines langues du site. Pour chaque élément, les langues fautives et la raison sont données. Donne pour chacune un libellé corrigé : UN seul nom, la forme COURTE d'usage dans les offres d'emploi du pays (un terme anglais s'il est l'usage courant), sans barre ni parenthèse, un vrai mot de la langue (jamais un mot inventé), et DISTINCT du libellé des autres métiers cités quand la raison en cite (un autre métier = un autre nom, au besoin précisé : « Tailleur » et « Couturière », « Barista » et « Serveur en café »).`;
const SCHEMA = { type: 'OBJECT', required: ['i', 'corrections'], properties: { i: { type: 'INTEGER' }, corrections: { type: 'ARRAY', items: { type: 'OBJECT',
  required: ['langue', 'libelle'], properties: { langue: { type: 'STRING', enum: LANGUES_SITE.map(cleSchema) }, libelle: { type: 'STRING' } } } } } };
const RELECTURE = `Tu relis des noms de métiers et de familles de Catwalks (luxe, mode, beauté, retail) corrigés dans certaines langues. Pour chaque élément, liste dans "fautes" les langues dont le libellé corrigé est fautif, avec la raison et son "type" : "sens" (sens faux, mot inexistant, confondu avec l'autre métier cité, mauvaise langue), "forme" (plusieurs noms, barre, parenthèse, forme longue ou administrative) ou "usage" (juste, mais un autre terme serait plus courant dans le pays). Liste vide si tout est juste.`;
const SCHEMA_RELECTURE = { type: 'OBJECT', required: ['i', 'fautes'], properties: { i: { type: 'INTEGER' }, fautes: { type: 'ARRAY', items: { type: 'OBJECT',
  required: ['langue', 'raison', 'type'], properties: { langue: { type: 'STRING', enum: LANGUES_SITE.map(cleSchema) }, raison: { type: 'STRING' },
    type: { type: 'STRING', enum: ['sens', 'forme', 'usage'] } } } } } };
type Faute = { cle: string; langue: string; raison: string };
const renduCorrection = (fautes: Faute[]) => (lot: Element[]) => lot.map((e, j) => `[${j}] « ${e.libelles.fr} / ${e.libelles.en} »\n  FAUTES : ${fautes.filter((d) => d.cle === e.cle).map((d) => `${cleSchema(d.langue)} (${e.libelles[d.langue]}) : ${d.raison}`).join(' ; ')}`).join('\n');
const renduRelecture = (fautes: Faute[]) => (lot: Element[]) => lot.map((e, j) => `[${j}] « ${e.libelles.fr} / ${e.libelles.en} » — CORRIGÉS : ${fautes.filter((d) => d.cle === e.cle)
  .map((d) => `${cleSchema(d.langue)}: ${e.libelles[d.langue]}${d.raison.includes('même libellé') ? ` (à distinguer de ${d.raison.split(' que ')[1]})` : ''}`).join(' · ')}`).join('\n');

// Jusqu'à trois tours : on corrige les défauts objectifs et les fautes de sens ou de forme relevées au tour précédent ;
// les préférences d'usage du relecteur sont listées sans bloquer.
let corriges = elements.map((e) => ({ ...e, libelles: { ...e.libelles } }));
let fautes: Faute[] = avant;
const usage: (Faute & { libelle: string })[] = [];
let tours = 0, elementsCorriges = 0;
while (fautes.length && tours < 3) {
  tours++;
  const cibles = [...new Set(fautes.map((d) => d.cle))].map((cle) => corriges.find((e) => e.cle === cle)!);
  elementsCorriges += cibles.length;
  const reponses = await repondre(MODELE_CHOIX, CONSIGNE, cibles, 8, renduCorrection(fautes), SCHEMA, (r) => Array.isArray(r.corrections));
  corriges = corriges.map((e) => {
    const n = cibles.indexOf(e);
    if (n < 0 || !reponses[n]) return e;
    const faux = new Set(fautes.filter((d) => d.cle === e.cle).map((d) => cleSchema(d.langue)));
    const nouveaux = Object.fromEntries(reponses[n].corrections.filter((c: any) => faux.has(c.langue) && c.libelle?.trim()).map((c: any) => [c.langue.replace('_', '-'), c.libelle.trim()]));
    return { ...e, libelles: { ...e.libelles, ...nouveaux } };
  });
  const relire = corriges.filter((e) => fautes.some((d) => d.cle === e.cle));
  const relus = await repondre(JUGES.j2, RELECTURE, relire, 8, renduRelecture(fautes), SCHEMA_RELECTURE, (r) => Array.isArray(r.fautes));
  const relevees = relire.flatMap((e, n) => (relus[n]?.fautes ?? []).map((f: any) => ({ cle: e.cle, langue: f.langue.replace('_', '-'), raison: f.raison, type: f.type })));
  usage.push(...relevees.filter((f) => f.type === 'usage').map((f) => ({ ...f, libelle: corriges.find((e) => e.cle === f.cle)!.libelles[f.langue] })));
  fautes = [...defauts(corriges), ...relevees.filter((f) => f.type !== 'usage').map(({ cle, langue, raison }) => ({ cle, langue, raison }))];
}

// Après les tours : les parenthèses et seconds noms sont retirés mécaniquement (le premier nom reste) ; ce qui demeure
// est un défaut CONNU, listé : deux métiers que la langue ne distingue pas (« Krejčí » pour tailleur et couturier en
// tchèque), ou une objection de sens que trois tours n'ont pas levée. Il ne touche que le libellé affiché.
corriges = corriges.map((e) => ({ ...e, libelles: Object.fromEntries(Object.entries(e.libelles).map(([l, v]) =>
  [l, v ? v.replace(/\s*\([^)]*\)/g, '').split(/\s*\/\s*/)[0].trim() : v])) }));
const connus = [...defauts(corriges), ...fautes.filter((f) => !f.raison.includes('parenthèse') && !f.raison.includes('barre') && !f.raison.includes('même libellé'))];
const apres = connus.filter((f) => /alphabet latin|forme non courte/.test(f.raison));
const bilan = { defautsAvant: avant.length, tours, elementsCorriges, defautsConnus: connus.length, fautesBloquantes: apres.length, preferencesUsage: usage.length,
  signalementsEtape5NonBloquants: e5.fautesRestantes.length };
writeFileSync(`${DOSSIER_SORTIE}5b-libelles-corrections.json`, JSON.stringify({ calculeLe: new Date().toISOString(), modeles: { correction: MODELE_CHOIX, relecture: JUGES.j2 },
  bilan, defautsConnus: connus, preferencesUsage: usage, signalementsEtape5: e5.fautesRestantes,
  libelles: Object.fromEntries(corriges.map((e) => [e.cle, e.libelles])) }, null, 1));
console.log(JSON.stringify(bilan, null, 1));
for (const d of connus) console.log(` connu : ${d.cle} ${d.langue} — ${d.raison}`);
if (apres.length) { console.error(`ÉTAPE INCOMPLÈTE : ${apres.length} libellé(s) de forme ou d'écriture fautive après ${tours} tours`); process.exitCode = 1; }
