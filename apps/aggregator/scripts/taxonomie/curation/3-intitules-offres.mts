/**
 * PASSE DE CURATION v3, ÉTAPE 3 : LES MÉTIERS QUE NOS OFFRES PORTENT (D-475 §29-§32 ; plan
 * `docs/architecture/classification-metiers.md` §3.1-§3.2).
 *
 * La v3 contient « les métiers génériques que nos offres portent vraiment » (plan §3.1). Moins de la moitié des offres
 * publiables ont aujourd'hui un métier ; les autres n'ont que leur famille ou aucune règle (export du 28/09/2026). On
 * prend la TÊTE de ces intitulés : ceux qui portent au moins `SEUIL_OFFRES` offres sans métier. La traîne reste à la
 * table apprise (sous-lot 2C) et aux passes suivantes ; son volume est écrit dans le bilan. Pour chaque intitulé de la
 * tête, les deux modèles décident indépendamment, parmi les métiers de la v3 et de l'ESCO les plus proches :
 *  - « meme » : un métier de la v3 (servi ou venu du backend) → l'intitulé en devient une variante ; toute proposition
 *    de l'un ou l'autre modèle passe au consensus des deux juges (un intitulé d'offre appris vaut pour toutes les
 *    offres qui le portent : R-66 §2) ;
 *  - « nouveau » : un métier que la v3 n'a pas, sur l'accord des deux modèles ;
 *  - « vague » : l'intitulé ne désigne pas un seul métier (« Seasonal associate ») → aucun métier, sa famille quand
 *    les deux modèles s'accordent (D-475 §32 c). C'est aussi l'issue sans accord : on ne crée rien sur un doute ;
 *  - « non_metier » (R-66) : sur l'accord des deux.
 * Les « nouveau » sont regroupés en métiers (un modèle propose le regroupement et la forme courte du libellé, D-475
 * §31 c), puis chaque rattachement d'un intitulé à son métier passe au consensus des deux juges (la garde d'unicité
 * contre les métiers existants est l'étape 3b). Un métier nouveau
 * n'entre dans la v3 que s'il porte au moins `MIN_OFFRES_METIER` offres venues d'au moins `MIN_EMPLOYEURS`
 * employeurs distincts ; sinon ses intitulés restent « vague » et il est listé en attente de volume.
 *
 * Entrées : l'export des intitulés (dont l'empreinte est recopiée dans la sortie), les étapes 1, 1b et 2, et celles de
 * `commun.mts`. Sortie : `curation-v3/3-intitules-offres.json`. Aucune écriture en base. L'étape échoue si un
 * intitulé de la tête reste sans décision.
 *
 *   node --env-file=<fichier .env portant GEMINI_API_KEY> --import tsx \
 *     apps/aggregator/scripts/taxonomie/curation/3-intitules-offres.mts
 */
import { writeFileSync } from 'node:fs';
import { CACHE_VECTEURS, conceptsV3, contexte, courte, DOSSIER_SORTIE, escoMetiers, famillesV3, lireIntitulesOffres, MIN_EMPLOYEURS, MIN_OFFRES_METIER, texteEsco } from './commun.mts';
import { consensus, cosinus, JUGES, MODELE_CHOIX, regrouper, repondre, vecteurs } from './ia.mts';

/** Seuil de départ, à recalibrer (plan §3.1) : la tête des intitulés sans métier. */
const SEUIL_OFFRES = 3;
const { intitules, sha256 } = lireIntitulesOffres();
const concepts = conceptsV3({ avecOffres: false });
const familleCles = famillesV3();

// La tête : les intitulés qui portent au moins SEUIL_OFFRES offres sans métier.
const sansMetier = (x: any) => (x.statuts.FAMILY_ONLY ?? 0) + (x.statuts.NO_RULE ?? 0) + (x.statuts.AMBIGUOUS ?? 0);
const ecart = intitules.filter((x) => sansMetier(x) > 0);
const tete = ecart.filter((x) => sansMetier(x) >= SEUIL_OFFRES).sort((a, b) => sansMetier(b) - sansMetier(a));
const traine = { intitules: ecart.length - tete.length, offres: ecart.reduce((n, x) => n + sansMetier(x), 0) - tete.reduce((n, x) => n + sansMetier(x), 0) };

const vec = await vecteurs([...concepts.map((c) => c.texte), ...escoMetiers.map(texteEsco), ...tete.map((x) => x.intitule)], CACHE_VECTEURS);
const top = <T,>(v: number[], liste: T[], texte: (x: T) => string, n: number) =>
  liste.map((x, k) => ({ k, s: cosinus(v, vec.get(texte(x))!) })).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.k);
const candidats = tete.map((x) => { const v = vec.get(x.intitule)!; return { concepts: top(v, concepts, (c) => c.texte, 8), escos: top(v, escoMetiers, texteEsco, 6) }; });

// 1. Décision des deux modèles.
const CONSIGNE = `Tu construis la taxonomie des métiers de Catwalks (luxe, mode, beauté, retail, sièges des Maisons, 41 pays).
Chaque élément est un intitulé d'OFFRE D'EMPLOI réel (en minuscules, toutes langues), avec ses employeurs et ses services quand on les connaît (ils lèvent l'ambiguïté : « dispenser » chez une chaîne de pharmacies n'est pas un opticien), et les MÉTIERS CATWALKS et les MÉTIERS ESCO les plus proches. Décide :
- "meme" : l'intitulé désigne EXACTEMENT un des MÉTIERS CATWALKS proposés (même fonction, même niveau de responsabilité) → son numéro dans "concept" ;
- "nouveau" : l'intitulé désigne UN métier précis, absent des métiers Catwalks proposés (autre fonction, ou autre niveau : un poste d'encadrement n'est jamais le poste qu'il encadre) → dans "libelle_fr" et "libelle_en", le nom court de ce métier (sans H/F, contrat, marque, secteur ni lieu) ;
- "vague" : l'intitulé ne désigne pas un seul métier (« Seasonal associate », « Team member », « Stage ») ;
- "non_metier" : ce n'est pas un intitulé de poste (R-66 : statut, passion, univers seul).
IGNORE ce qui n'est pas la fonction : contrat, horaire, saison, niveau numéroté (« III »), marque, lieu. Donne aussi dans "ancre" le numéro du MÉTIER ESCO qui décrit le mieux l'intitulé (null si aucun), et dans "famille" la clé de la famille qui lui convient (null si l'intitulé est trop vague pour la savoir).
FAMILLES : ${familleCles.join(' · ')}`;
const SCHEMA = { type: 'OBJECT', properties: {
  i: { type: 'INTEGER' }, decision: { type: 'STRING', enum: ['meme', 'nouveau', 'vague', 'non_metier'] },
  concept: { type: 'INTEGER', nullable: true }, ancre: { type: 'INTEGER', nullable: true },
  famille: { type: 'STRING', enum: familleCles, nullable: true }, libelle_fr: { type: 'STRING', nullable: true }, libelle_en: { type: 'STRING', nullable: true },
}, required: ['i', 'decision', 'concept', 'ancre', 'famille', 'libelle_fr', 'libelle_en'] };
const numeros = tete.map((_, k) => k);
const rendu = (lot: number[]) => lot.map((k, j) => {
  const x = tete[k], c = candidats[k];
  return `[${j}] « ${x.intitule} » (${x.offres} offres, ${x.employeurs} employeurs, ${x.pays.slice(0, 6).join(' ')}${contexte(x) ? ` ; ${contexte(x)}` : ''})\n  MÉTIERS CATWALKS : ${c.concepts.map((q, n) => `${n}: ${concepts[q].fr}`).join(' · ')}\n  MÉTIERS ESCO : ${c.escos.map((q, n) => `${n}: ${courte(escoMetiers[q].libelles.fr) || courte(escoMetiers[q].libelles.en)}`).join(' · ')}`;
}).join('\n');
const traduire = (r: any, k: number) => r && { ...r,
  concept: r.concept === null || r.concept === undefined ? null : concepts[candidats[k].concepts[r.concept]]?.cle ?? null,
  ancre: r.ancre === null || r.ancre === undefined ? null : escoMetiers[candidats[k].escos[r.ancre]]?.uri ?? null };
const choix = (await repondre(MODELE_CHOIX, CONSIGNE, numeros, 20, rendu, SCHEMA)).map(traduire);
const second = (await repondre(JUGES.j2, CONSIGNE, numeros, 20, rendu, SCHEMA)).map(traduire);

// 2. Les « meme » proposés par l'un ou l'autre passent au consensus des deux juges.
const parCle = new Map(concepts.map((c) => [c.cle, c]));
type Proposee = { k: number; cle: string };
const proposees: Proposee[] = [...new Map<string, Proposee>(numeros.flatMap((k) => [choix[k], second[k]]
  .filter((r: any) => r?.decision === 'meme' && r.concept).map((r: any): [string, Proposee] => [`${k}|${r.concept}`, { k, cle: r.concept }]))).values()];
const verdicts = await consensus(proposees.map(({ k, cle }) => {
  const c = parCle.get(cle)!;
  return { intitule: tete[k].intitule, metier: `${c.fr} / ${c.en}`, alias: c.variantes, contexte: contexte(tete[k]) };
}));
const fusions = new Map<number, { cle: string; verdict: string }[]>();
proposees.forEach(({ k, cle }, n) => { fusions.set(k, [...(fusions.get(k) ?? []), { cle, verdict: verdicts[n] }]); });

type Decision = { decision: string; concept: string | null; famille: string | null };
const decisions: Decision[] = numeros.map((k) => {
  const c = choix[k], s = second[k], f = fusions.get(k) ?? [];
  const confirmees = f.filter((x) => x.verdict === 'confirme');
  const concept = confirmees.find((x) => x.cle === c?.concept)?.cle ?? confirmees[0]?.cle ?? null;
  const familleAccord = c?.famille && c.famille === s?.famille ? c.famille : null;
  if (!c || !s || (!concept && f.some((x) => x.verdict === 'indetermine'))) return { decision: 'indetermine', concept: null, famille: null };
  if (concept) return { decision: 'variante', concept, famille: parCle.get(concept)!.famille };
  if (c.decision === 'nouveau' && s.decision === 'nouveau') return { decision: 'nouveau', concept: null, famille: familleAccord };
  if (c.decision === 'non_metier' && s.decision === 'non_metier') return { decision: 'non_metier', concept: null, famille: null };
  return { decision: 'vague', concept: null, famille: familleAccord };
});

// 3. Regroupement des « nouveau » en métiers, puis consensus sur chaque rattachement.
const aGrouper = numeros.filter((k) => decisions[k].decision === 'nouveau');
const groupes = await regrouper(aGrouper.map((k) => ({ intitule: tete[k].intitule, fr: choix[k].libelle_fr, en: choix[k].libelle_en, contexte: contexte(tete[k]) })));
const membres = new Map<string, number[]>();
const nomDe = new Map<string, { fr: string; en: string }>();
aGrouper.forEach((k, n) => {
  const g = groupes[n];
  if (!g || g.verdict === 'indetermine') { decisions[k] = { ...decisions[k], decision: 'indetermine' }; return; }
  if (g.verdict !== 'confirme') { decisions[k] = { ...decisions[k], decision: 'vague' }; return; }
  nomDe.set(g.cle, { fr: g.fr, en: g.en });
  membres.set(g.cle, [...(membres.get(g.cle) ?? []), k]);
});

// 4. Volume : offres et employeurs DISTINCTS du groupe (identifiants, jamais la somme des comptes).
const majorite = (l: (string | null | undefined)[]) => {
  const n = l.filter(Boolean).reduce((a, x) => ({ ...a, [x!]: (a[x!] ?? 0) + 1 }), {} as Record<string, number>);
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
const nouveauxMetiers: any[] = [], enAttente: any[] = [];
for (const [cle, ks] of membres) {
  const offres = ks.reduce((n, k) => n + sansMetier(tete[k]), 0);
  const employeurs = new Set(ks.flatMap((k) => tete[k].employeursIds)).size;
  const v = vec.get(tete[ks[0]].intitule)!;
  const proche = top(v, concepts, (c) => c.texte, 1)[0];
  const metier = { cle, ...nomDe.get(cle)!, famille: majorite(ks.map((k) => choix[k].famille)) ?? majorite(ks.map((k) => second[k].famille)),
    ancre: majorite(ks.map((k) => choix[k].ancre)), offres, employeurs, titres: ks.map((k) => tete[k].intitule),
    procheExistant: { cle: concepts[proche].cle, similarite: +cosinus(v, vec.get(concepts[proche].texte)!).toFixed(3) } };
  if (offres >= MIN_OFFRES_METIER && employeurs >= MIN_EMPLOYEURS) {
    nouveauxMetiers.push(metier);
    for (const k of ks) decisions[k] = { decision: 'nouveau-metier', concept: `offres:${cle}`, famille: metier.famille };
  } else {
    enAttente.push(metier);
    for (const k of ks) decisions[k] = { ...decisions[k], decision: 'vague' };
  }
}

const compte = (l: string[]) => l.reduce((a, x) => ({ ...a, [x]: (a[x] ?? 0) + 1 }), {} as Record<string, number>);
const offresPar = (d: string) => numeros.filter((k) => decisions[k].decision === d).reduce((n, k) => n + sansMetier(tete[k]), 0);
const types = [...new Set(decisions.map((d) => d.decision))];
const bilan = { export: { sha256, intitules: intitules.length }, seuils: { SEUIL_OFFRES, MIN_OFFRES_METIER, MIN_EMPLOYEURS },
  tete: { intitules: tete.length, offres: tete.reduce((n, x) => n + sansMetier(x), 0) }, traine,
  decisions: compte(decisions.map((d) => d.decision)), offresParDecision: Object.fromEntries(types.map((d) => [d, offresPar(d)])),
  consensusVariantes: compte(verdicts), consensusRattachements: compte(groupes.map((g) => g?.verdict ?? 'sans-groupe')), nouveauxMetiers: nouveauxMetiers.length, enAttente: enAttente.length };
writeFileSync(`${DOSSIER_SORTIE}3-intitules-offres.json`, JSON.stringify({ calculeLe: new Date().toISOString(), modeles: { choix: MODELE_CHOIX, ...JUGES }, bilan,
  nouveauxMetiers, enAttente,
  intitules: numeros.map((k) => ({ intitule: tete[k].intitule, offresSansMetier: sansMetier(tete[k]), employeurs: tete[k].employeurs, ...decisions[k],
    preuve: { choix: choix[k] ?? null, second: second[k] ?? null, fusions: fusions.get(k) ?? [] } })) }, null, 1));
console.log(JSON.stringify(bilan, null, 1));
const indetermines = decisions.filter((d) => d.decision === 'indetermine').length;
if (indetermines) { console.error(`ÉTAPE INCOMPLÈTE : ${indetermines} intitulé(s) sans décision`); process.exitCode = 1; }
