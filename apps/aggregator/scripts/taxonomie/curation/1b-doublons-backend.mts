/**
 * PASSE DE CURATION v3, ÉTAPE 1b : LES DOUBLONS À L'INTÉRIEUR DU RÉFÉRENTIEL DU BACKEND (D-475 §29-§31 ; plan
 * `docs/architecture/classification-metiers.md` §3.1 : « les vrais métiers du backend, fusionnés quand c'est le
 * même métier »).
 *
 * L'étape 1 compare chaque métier du backend aux métiers servis, jamais le backend à lui-même : « Conseiller
 * immobilier » et « Négociateur immobilier » y deviennent deux métiers nouveaux. Ici, parmi les métiers « nouveau » :
 *  1. chaque métier reçoit ses `VOISINS` plus proches (vecteurs, similarité ≥ `SEUIL_VOISIN`) ; les deux modèles, chacun
 *     de son côté, désignent ceux qui sont EXACTEMENT le même métier (même fonction, même niveau) ;
 *  2. toute paire proposée par l'un ou l'autre passe au consensus des deux juges de D-127 (R-66 §2 : une fusion est
 *     une écriture partagée) ;
 *  3. les groupes se forment par cliques : deux groupes ne s'unissent que si CHAQUE paire de leurs membres est
 *     confirmée (les paires manquantes sont jugées), pour qu'une chaîne A = B, B = C ne fusionne jamais A et C sans
 *     preuve ; le représentant est le membre qui porte la plus grande population, les autres en deviennent des
 *     variantes.
 *
 * Entrée : `curation-v3/1-correspondance-backend.json`. Sortie : `curation-v3/1b-doublons-backend.json`. Aucune
 * écriture en base. L'étape échoue si une paire reste sans verdict.
 *
 *   node --env-file=<fichier .env portant GEMINI_API_KEY> --import tsx \
 *     apps/aggregator/scripts/taxonomie/curation/1b-doublons-backend.mts
 */
import { writeFileSync } from 'node:fs';
import { backend, CACHE_VECTEURS, DOSSIER_SORTIE, lireEtape, texteBackend } from './commun.mts';
import { consensus, cosinus, JUGES, MODELE_CHOIX, repondre, vecteurs, type Verdict } from './ia.mts';

/** Seuils de départ, à recalibrer (plan §3.2) : au-delà de 5 voisins, la liste noie la consigne. */
const VOISINS = 5;
const SEUIL_VOISIN = 0.85;

const etape1 = lireEtape('1-correspondance-backend.json');
const parId = new Map(backend.metiers.map((b: any) => [b.id, b]));
const nouveaux = etape1.decisions.filter((d: any) => d.decision === 'nouveau').map((d: any) => ({ ...d, b: parId.get(d.id) as any }));
const vec = await vecteurs(nouveaux.map((n: any) => texteBackend(n.b)), CACHE_VECTEURS);
const V = nouveaux.map((n: any) => vec.get(texteBackend(n.b))!);
const sim = (a: number, b: number) => cosinus(V[a], V[b]);
const voisins = nouveaux.map((_: any, a: number) => nouveaux.map((__: any, b: number) => b).filter((b: number) => b !== a && sim(a, b) >= SEUIL_VOISIN)
  .sort((x: number, y: number) => sim(a, y) - sim(a, x)).slice(0, VOISINS));

// 1. Propositions des deux modèles.
const CONSIGNE = `Tu construis la taxonomie des métiers de Catwalks (luxe, mode, beauté, retail, sièges des Maisons, 41 pays).
Pour chaque métier du référentiel, on te donne des métiers VOISINS du même référentiel. Donne dans "memes" les numéros des voisins qui désignent EXACTEMENT le même métier : même fonction, même niveau de responsabilité. Un synonyme, une traduction, un féminin ou une variante d'intitulé comptent comme le même métier.
Ne sont PAS le même métier : un autre niveau (assistant, chargé, responsable, directeur), un poste d'encadrement et le poste qu'il encadre, une spécialisation qui change la fonction. Liste vide si aucun voisin n'est le même métier.`;
const SCHEMA = { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, memes: { type: 'ARRAY', items: { type: 'INTEGER' } } }, required: ['i', 'memes'] };
const etiquette = (n: any) => `« ${n.label} »${n.b?.aliases?.length ? ` (alias : ${n.b.aliases.slice(0, 5).join(', ')})` : ''}`;
const aProposer = nouveaux.map((_: any, a: number) => a).filter((a: number) => voisins[a].length);
const rendu = (lot: number[]) => lot.map((a, j) => `[${j}] ${etiquette(nouveaux[a])}\n  VOISINS : ${voisins[a].map((b: number, k: number) => `${k}: ${etiquette(nouveaux[b])}`).join(' · ')}`).join('\n');
const cle = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const proposees = new Set<string>();
for (const modele of [MODELE_CHOIX, JUGES.j2]) {
  const reps = await repondre(modele, CONSIGNE, aProposer, 15, rendu, SCHEMA, (r) => Array.isArray(r.memes));
  aProposer.forEach((a: number, k: number) => {
    for (const x of reps[k]?.memes ?? []) if (Number.isInteger(x) && voisins[a][x] !== undefined) proposees.add(cle(a, voisins[a][x]));
  });
}

// 2. Consensus des deux juges sur les paires proposées.
const verdicts = new Map<string, Verdict>();
async function juger(paires: string[]) {
  const aFaire = paires.filter((p) => !verdicts.has(p));
  const v = await consensus(aFaire.map((p) => {
    const [a, b] = p.split('|').map(Number);
    return { intitule: nouveaux[a].label, metier: nouveaux[b].label, alias: nouveaux[b].b?.aliases };
  }));
  aFaire.forEach((p, k) => verdicts.set(p, v[k]));
}
await juger([...proposees]);

// 3. Cliques : composantes des paires confirmées, paires internes manquantes jugées, puis union gloutonne.
const confirmees = () => [...verdicts].filter(([, v]) => v === 'confirme').map(([p]) => p.split('|').map(Number) as [number, number]);
const composantes = new Map<number, Set<number>>();
for (const [a, b] of confirmees()) {
  const ca = composantes.get(a) ?? new Set([a]), cb = composantes.get(b) ?? new Set([b]);
  const union = new Set([...ca, ...cb]);
  for (const x of union) composantes.set(x, union);
}
const internes = [...new Set(composantes.values())].filter((c) => c.size >= 3)
  .flatMap((c) => [...c].flatMap((a) => [...c].filter((b) => a < b).map((b) => cle(a, b))));
await juger(internes);

const groupe = new Map<number, number[]>(nouveaux.map((_: any, a: number) => [a, [a]]));
for (const [a, b] of confirmees().sort(([a1, b1], [a2, b2]) => sim(a2, b2) - sim(a1, b1))) {
  const ga = groupe.get(a)!, gb = groupe.get(b)!;
  if (ga === gb) continue;
  if (!ga.every((x) => gb.every((y) => verdicts.get(cle(x, y)) === 'confirme'))) continue;
  const union = [...ga, ...gb];
  for (const x of union) groupe.set(x, union);
}
const populationDe = (n: any) => n.population.sources + n.population.profilsRecherche + n.population.profilsPosteActuel + n.population.offres;
const groupes = [...new Set(groupe.values())].filter((g) => g.length > 1).map((g) => {
  const tries = [...g].sort((x, y) => populationDe(nouveaux[y]) - populationDe(nouveaux[x]) || nouveaux[x].label.length - nouveaux[y].label.length);
  return { representant: { id: nouveaux[tries[0]].id, label: nouveaux[tries[0]].label, population: populationDe(nouveaux[tries[0]]) },
    variantes: tries.slice(1).map((x) => ({ id: nouveaux[x].id, label: nouveaux[x].label, population: populationDe(nouveaux[x]) })) };
});

const sansVerdict = [...verdicts.values()].filter((v) => v === 'indetermine').length;
const compte = (l: string[]) => l.reduce((a, x) => ({ ...a, [x]: (a[x] ?? 0) + 1 }), {} as Record<string, number>);
const bilan = { nouveaux: nouveaux.length, avecVoisins: aProposer.length, pairesProposees: proposees.size, pairesInternesAjoutees: internes.filter((p) => !proposees.has(p)).length,
  verdicts: compte([...verdicts.values()]), groupes: groupes.length, metiersAbsorbes: groupes.reduce((s, g) => s + g.variantes.length, 0) };
writeFileSync(`${DOSSIER_SORTIE}1b-doublons-backend.json`, JSON.stringify({ calculeLe: new Date().toISOString(), modeles: { choix: MODELE_CHOIX, ...JUGES },
  seuils: { VOISINS, SEUIL_VOISIN }, bilan, groupes,
  paires: [...verdicts].map(([p, v]) => { const [a, b] = p.split('|').map(Number); return { a: nouveaux[a].label, b: nouveaux[b].label, similarite: +sim(a, b).toFixed(3), proposee: proposees.has(p), verdict: v }; }) }, null, 1));
console.log(JSON.stringify(bilan, null, 1));
for (const g of groupes) console.log(` ${g.representant.label} ⟵ ${g.variantes.map((v) => v.label).join(', ')}`);
if (sansVerdict) { console.error(`ÉTAPE INCOMPLÈTE : ${sansVerdict} paire(s) sans verdict`); process.exitCode = 1; }
