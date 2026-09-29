/**
 * PASSE DE CURATION v3, ÉTAPE 5c : GARDE D'UNICITÉ COMPLÈTE (R-20 et R-140 §6 : « un synonyme n'appartient qu'à un
 * seul métier » ; plan `docs/architecture/classification-metiers.md` §3.1).
 *
 * Les gardes des étapes 5 et 5b comparaient les libellés entre eux et les expressions entre elles, jamais le libellé d'un
 * métier aux expressions d'un autre, ni d'une langue à l'autre : « Verkäufer » était le libellé allemand d'« Employé de
 * commerce » et une expression servie de « Conseiller de vente », « Tailor » le libellé de « Tailleur » et un alias servi
 * de « Couturier » (audits du 29/09/2026). Ici, chaque forme (celle du moteur, `phraseMoteur`) est rapportée à tous les
 * métiers qui la revendiquent, à quel titre (libellé, variante validée, alias ou expression servis) :
 *  - formes INTERDITES : les intitulés d'offres que les deux modèles ont jugés vagues à l'étape 3 (« sales manager »)
 *    et les mots vagues seuls (§32 c) ne rattachent aucun métier ;
 *  - deux métiers dont l'un au moins nomme la forme : les deux juges disent s'ils sont le MÊME métier ; oui, le métier
 *    nouveau est absorbé (ses libellés et variantes deviennent des variantes de l'autre ; entre deux nouveaux, le moins
 *    peuplé est absorbé) ;
 *  - sinon, une forme que la version SERVIE porte (libellé, alias ou expression, validés en production) reste à son
 *    métier servi, et le métier nouveau qui la nomme est renommé dans cette langue : « Verkäufer », expression servie de
 *    « Conseiller de vente » (438 offres allemandes bien classées), ne passe pas à « Employé de commerce » parce que
 *    l'IA l'a pris pour libellé ; entre métiers nouveaux, la forme reste à celui qui la nomme, le moins peuplé des
 *    deux nommeurs est renommé ; revendiquée sans être nommée ni servie, elle est retirée de tous (ambiguë). L'étape 5b
 *    relit ce fichier (métiers absorbés écartés, renommages).
 * Entrées : étapes 1 à 5b, la version servie, le vocabulaire de recherche de l'API (`apps/api/lib/search-vocabulary.ts`,
 * versé dans le manifeste, plan §3.1). Sortie : `curation-v3/5c-garde.json`, que lisent 5b (renommages) et 6.
 *
 *   node --env-file=<fichier .env portant GEMINI_API_KEY> --import tsx \
 *     apps/aggregator/scripts/taxonomie/curation/5c-garde.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { conceptsV3, DOSSIER_SORTIE, libellesEtFormes, lireEtape, phraseMoteur, servie, VAGUES } from './commun.mts';
import { consensus, JUGES } from './ia.mts';

const concepts = conceptsV3({ avecOffres: true, avecEncadrement: true });
const parCle = new Map(concepts.map((c) => [c.cle, c]));
const e1 = lireEtape('1-correspondance-backend.json'), e3 = lireEtape('3-intitules-offres.json'), e4 = lireEtape('4-encadrement.json');
const e5 = lireEtape('5-libelles.json'), e5b = lireEtape('5b-libelles-corrections.json');
const servis = new Set<string>([...servie.occupations.map((o: any) => o.key), 'optical-assistant']);

// Le vocabulaire de recherche de l'API : ses alias de métiers entrent dans le manifeste (une seule source de vocabulaire).
const SOURCE_VOCABULAIRE = fileURLToPath(new URL('../../../../api/lib/search-vocabulary.ts', import.meta.url));
const bloc = readFileSync(SOURCE_VOCABULAIRE, 'utf8').match(/const ROLE_ALIASES[^{]*\{([\s\S]*?)\n\};/)?.[1] ?? '';
export const aliasRecherche = Object.fromEntries([...bloc.matchAll(/^\s*'?([a-z0-9-]+)'?:\s*\[([^\]]*)\]/gm)]
  .map((m) => [m[1], [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])]));
if (Object.keys(aliasRecherche).length !== 4) throw new Error(`vocabulaire de recherche : 4 entrées attendues, ${Object.keys(aliasRecherche).length} lues`);

// Population d'un métier, pour choisir lequel absorber ou renommer entre deux métiers nouveaux.
const population = new Map<string, number>();
for (const d of e1.decisions) population.set(`backend:${d.slug}`, d.population.sources + d.population.profilsRecherche + d.population.profilsPosteActuel + d.population.offres);
for (const m of lireEtape('3b-garde-unicite.json').nouveauxMetiers) population.set(`offres:${m.cle}`, m.offres);
for (const m of e4.nouveauxMetiers) population.set(`encadrement:${m.cle}`, m.offres);

// Formes interdites.
const vaguesEtape3 = e3.intitules.filter((t: any) => t.preuve?.choix?.decision === 'vague' && t.preuve?.second?.decision === 'vague').map((t: any) => phraseMoteur(t.intitule));
const interdites = new Set<string>([...VAGUES, ...vaguesEtape3].filter(Boolean));

// Revendications.
type Titre = { libelle: string[]; autre: string[] };
const revendications = new Map<string, Map<string, Titre>>();
const revendiquer = (v: string, cle: string, libelle: string | null, autre: string | null) => {
  const f = phraseMoteur(v);
  if (!f) return;
  const m = revendications.get(f) ?? new Map<string, Titre>();
  const t = m.get(cle) ?? { libelle: [], autre: [] };
  if (libelle) t.libelle.push(libelle); if (autre) t.autre.push(autre);
  m.set(cle, t);
  revendications.set(f, m);
};
const e5ParCle = new Map<string, any>(e5.metiers.map((m: any) => [m.cle, m]));
for (const c of concepts) {
  // Un métier absorbé n'a plus de libellés en 5b : ceux de l'étape 5 gardent la paire, donc la fusion, stable.
  const { libelles, formes } = libellesEtFormes(c.cle, e5ParCle, e5b);
  for (const [l, v] of Object.entries<string>(libelles)) if (v) revendiquer(v, c.cle, l, null);
  for (const [l, fs] of Object.entries<string[]>(formes)) for (const f of fs) revendiquer(f, c.cle, l, null);
  for (const v of e5ParCle.get(c.cle)?.variantes ?? []) revendiquer(v, c.cle, null, 'variante');
  for (const v of aliasRecherche[c.cle] ?? []) revendiquer(v, c.cle, null, 'recherche');
}
for (const o of servie.occupations) {
  for (const l of ['fr', 'en']) if (o.labels[l]) revendiquer(o.labels[l], o.key, l, null);
  for (const v of o.aliases ?? []) revendiquer(v, o.key, null, 'alias servi');
}
for (const r of servie.rules) for (const c of r.all) if (c.field === 'title') for (const v of c.any) revendiquer(v, r.occupation, null, 'expression servie');

// Conflits nommés : les deux juges disent si les deux métiers sont le même.
const conflits = [...revendications].filter(([f, m]) => m.size > 1 && !interdites.has(f));
const nommes = (m: Map<string, Titre>) => [...m].filter(([, t]) => t.libelle.length).map(([k]) => k);
const paires = [...new Set(conflits.filter(([, m]) => nommes(m).length).flatMap(([, m]) => {
  const ks = [...m.keys()];
  return ks.flatMap((a, i) => ks.slice(i + 1).map((b) => [a, b].sort().join('|')));
}))].map((p) => p.split('|')).filter(([a, b]) => !(servis.has(a) && servis.has(b)));
const nomDe = (k: string) => { const l = e5b.libelles[k] ?? e5ParCle.get(k)?.libelles ?? {}; return `${l.fr ?? parCle.get(k)?.fr} / ${l.en ?? parCle.get(k)?.en}`; };
const verdicts = await consensus(paires.map(([a, b]) => {
  const [nouveau, autre] = servis.has(a) ? [b, a] : [a, b];
  return { intitule: nomDe(nouveau), contexte: `variantes : ${(parCle.get(nouveau)?.variantes ?? []).slice(0, 6).join(', ')}`, metier: nomDe(autre), alias: parCle.get(autre)?.variantes };
}));
const absorbe = new Map<string, string>();
paires.forEach(([a, b], n) => {
  if (verdicts[n] !== 'confirme') return;
  const [perdant, gagnant] = servis.has(a) ? [b, a] : servis.has(b) ? [a, b] : (population.get(a) ?? 0) < (population.get(b) ?? 0) ? [a, b] : [b, a];
  if (!absorbe.has(perdant)) absorbe.set(perdant, gagnant);
});
const racine = (k: string): string => (absorbe.has(k) ? racine(absorbe.get(k)!) : k);

// Attributions et renommages, après fusion.
const attributions: { forme: string; garde: string | null; retires: string[]; motif: string }[] = [];
const renommages: { cle: string; langue: string; raison: string }[] = [];
for (const [f, m] of revendications) {
  const metiers = [...new Set([...m.keys()].map(racine))];
  if (interdites.has(f)) { attributions.push({ forme: f, garde: null, retires: metiers, motif: 'forme vague interdite' }); continue; }
  if (metiers.length < 2) continue;
  const nommeurs = [...new Set(nommes(m).map(racine))];
  const servisPorteurs = metiers.filter((k) => servis.has(k));
  if (servisPorteurs.length === 1) {
    const garde = servisPorteurs[0];
    attributions.push({ forme: f, garde, retires: metiers.filter((k) => k !== garde), motif: 'version servie' });
    for (const k of nommeurs.filter((x) => x !== garde)) for (const [cle, t] of m) if (racine(cle) === k) for (const l of t.libelle)
      renommages.push({ cle, langue: l, raison: `libellé « ${f} » déjà employé en production pour ${nomDe(garde)} : donner à ce métier un nom distinct` });
    continue;
  }
  if (nommeurs.length === 1) { attributions.push({ forme: f, garde: nommeurs[0], retires: metiers.filter((k) => k !== nommeurs[0]), motif: 'libellé' }); continue; }
  if (!nommeurs.length) { attributions.push({ forme: f, garde: null, retires: metiers, motif: 'ambiguë' }); continue; }
  // Nommée par plusieurs : le métier servi, sinon le plus peuplé, garde son libellé ; les autres sont renommés.
  const garde = nommeurs.find((k) => servis.has(k)) ?? [...nommeurs].sort((a, b) => (population.get(b) ?? 0) - (population.get(a) ?? 0))[0];
  attributions.push({ forme: f, garde, retires: metiers.filter((k) => k !== garde), motif: 'libellé partagé' });
  for (const k of nommeurs.filter((x) => x !== garde)) for (const [cle, t] of m) if (racine(cle) === k) for (const l of t.libelle)
    renommages.push({ cle, langue: l, raison: `libellé « ${f} » aussi porté par ${nomDe(garde)} : donner à ce métier un nom distinct` });
}
const sansVerdict = paires.filter((_, n) => verdicts[n] === 'indetermine').map((p) => p.join(' = '));
const bilan = { formesRevendiquees: revendications.size, interdites: attributions.filter((a) => a.motif === 'forme vague interdite').length,
  conflits: conflits.length, pairesJugees: paires.length, fusions: absorbe.size, renommages: renommages.length, sansVerdict: sansVerdict.length };
writeFileSync(`${DOSSIER_SORTIE}5c-garde.json`, JSON.stringify({ calculeLe: new Date().toISOString(), juges: JUGES, bilan, aliasRecherche,
  fusions: [...absorbe].map(([perdant, gagnant]) => ({ absorbe: perdant, dans: racine(gagnant) })),
  paires: paires.map(([a, b], n) => ({ a, b, verdict: verdicts[n] })), attributions, renommages }, null, 1));
console.log(JSON.stringify(bilan, null, 1));
for (const [p, g] of absorbe) console.log(` fusion : ${nomDe(p)} → ${nomDe(racine(g))}`);
for (const r of renommages) console.log(` renommer : ${r.cle} ${r.langue} — ${r.raison}`);
if (sansVerdict.length) { console.error(`ÉTAPE INCOMPLÈTE : ${sansVerdict.length} paire(s) sans verdict`); process.exitCode = 1; }
