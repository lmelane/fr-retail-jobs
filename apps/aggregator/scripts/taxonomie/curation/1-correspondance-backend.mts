/**
 * PASSE DE CURATION v3, ÉTAPE 1 : LES MÉTIERS DU BACKEND FACE À LA VERSION SERVIE (D-475 §29-§31 ; plan §3.1-§3.2).
 *
 * Pour chaque métier du backend (axe METIER, tous statuts ; un métier remplacé suit son successeur), l'IA décide :
 *  - « même métier » qu'un des 61 métiers servis → il en devient une variante (fusion). Toute fusion proposée par
 *    l'un OU l'autre des deux modèles passe au consensus des deux juges de D-127 (une fusion est une écriture
 *    partagée, R-66 §2) ; rejetée, le métier reste à part ; sans verdict, il reste « indetermine » et l'étape échoue ;
 *  - « nouveau métier » Catwalks, ancré à un métier ESCO (URI) quand l'un convient ;
 *  - « pas un métier » au sens de R-66 (statut, passion, univers seul : « Auto-entrepreneur »…), sur l'accord des deux
 *    modèles ; un métier d'un autre secteur que le luxe reste un métier.
 * Chaque métier nouveau reçoit une famille, choisie par deux modèles indépendants : accord → retenue ; désaccord →
 * laissée à l'étape des familles, avec les deux propositions. Les 32 « domaines » du backend (un axe fonctionnel)
 * reçoivent de même une famille.
 *
 * Entrées : `audits/2026-09-28/curation-v3/entrees/{catwalks-occupations-20260909-v1.json, backend-referentiel-2026-09-28.json}`,
 * `data/reference/esco-v1.2.1.json.gz`, `packages/db/data/occupations-v1.json` (pour `optical-assistant`).
 * Sortie : `audits/2026-09-28/curation-v3/1-correspondance-backend.json`. Aucune écriture en base.
 *
 *   node --env-file=<fichier .env portant GEMINI_API_KEY> --import tsx \
 *     apps/aggregator/scripts/taxonomie/curation/1-correspondance-backend.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { backend, CACHE_VECTEURS as CACHE, courte, DOSSIER_SORTIE as SORTIE, escoMetiers, esco, familles, metiersServis, texteBackend, texteEsco, texteServi } from './commun.mts';
import { consensus, cosinus, JUGES, MODELE_CHOIX, repondre, vecteurs } from './ia.mts';

const actifs = backend.metiers.filter((b: any) => b.axe === 'METIER' && (b.statut === 'ACTIVE' || !b.remplacePar));
const domaines = backend.metiers.filter((b: any) => b.axe === 'DOMAINE');

console.log(`métiers servis ${metiersServis.length} · familles ${familles.length} · backend à trancher ${actifs.length} · domaines ${domaines.length} · ESCO ${escoMetiers.length}`);
const vec = await vecteurs([...metiersServis.map(texteServi), ...escoMetiers.map(texteEsco), ...actifs.map(texteBackend), ...domaines.map(texteBackend)], CACHE);
const top = <T,>(v: number[], liste: T[], texte: (x: T) => string, n: number) =>
  liste.map((x, k) => ({ k, s: cosinus(v, vec.get(texte(x))!) })).sort((a, b) => b.s - a.s).slice(0, n);

const CONSIGNE = `Tu construis la taxonomie des métiers de Catwalks (luxe, mode, beauté, retail, sièges des Maisons, dans 41 pays).
Pour chaque métier du référentiel actuel, décide :
- "meme" : c'est EXACTEMENT le même métier (même fonction, même niveau de responsabilité) qu'un des MÉTIERS CATWALKS proposés → donne son numéro dans "metier" ;
- "nouveau" : c'est un métier distinct des métiers Catwalks proposés (plus précis, ou autre fonction, ou autre niveau : un poste d'encadrement n'est jamais le même métier que le poste encadré) ;
- "non_metier" : ce n'est pas un métier (R-66) : un statut ou une forme d'emploi seuls (« Auto-entrepreneur », « Étudiant », « CDI »), une passion, un secteur ou un univers seuls (« Luxe »), un niveau d'études. Un métier d'un autre secteur que le luxe ou le retail (banque, immobilier, éducation, santé…) RESTE un métier. Une forme de contrat ou de mission accolée à un métier (« Manager de transition commercial », « Vendeur intérimaire ») ne compte pas : juge le métier qui reste.
Donne aussi, dans "ancre", le numéro du MÉTIER ESCO proposé qui décrit le mieux ce métier (null si aucun ne convient), et, dans "famille", la clé de la famille Catwalks qui lui convient parmi la liste, ou "nouvelle:<nom court en français>" si aucune ne convient.`;
const LISTE_FAMILLES = familles.map((f) => `${f.key} (${f.labels.fr})`).join(' · ');
const SCHEMA = { type: 'OBJECT', properties: {
  i: { type: 'INTEGER' }, decision: { type: 'STRING', enum: ['meme', 'nouveau', 'non_metier'] },
  metier: { type: 'INTEGER', nullable: true }, ancre: { type: 'INTEGER', nullable: true },
  famille: { type: 'STRING' }, confiance: { type: 'STRING', enum: ['haute', 'moyenne', 'basse'] },
}, required: ['i', 'decision', 'metier', 'ancre', 'famille', 'confiance'] };

async function trancher(elements: any[], modele: string) {
  const avecCandidats = elements.map((b) => {
    const v = vec.get(texteBackend(b))!;
    return { b, servis: top(v, metiersServis, texteServi, 6).map((x) => x.k), escos: top(v, escoMetiers, texteEsco, 6).map((x) => x.k) };
  });
  const rendu = (lot: typeof avecCandidats) => lot.map(({ b, servis, escos }, j) =>
    `[${j}] « ${b.label} »${b.aliases?.length ? ` (alias : ${b.aliases.slice(0, 6).join(', ')})` : ''}\n  MÉTIERS CATWALKS : ${servis.map((k, n) => `${n}: ${metiersServis[k].labels.fr}`).join(' · ')}\n  MÉTIERS ESCO : ${escos.map((k, n) => `${n}: ${courte(escoMetiers[k].libelles.fr) || courte(escoMetiers[k].libelles.en)}`).join(' · ')}`).join('\n');
  const reps = await repondre(modele, `${CONSIGNE}\n\nFAMILLES CATWALKS : ${LISTE_FAMILLES}`, avecCandidats, 15, rendu, SCHEMA);
  return reps.map((r, k) => r && { ...r,
    metier: r.metier === null || r.metier === undefined ? null : metiersServis[avecCandidats[k].servis[r.metier]]?.key ?? null,
    ancre: r.ancre === null || r.ancre === undefined ? null : escoMetiers[avecCandidats[k].escos[r.ancre]]?.uri ?? null });
}

// 1. Choix, par deux modèles indépendants (le second sert à la famille et au contrôle de la décision).
const choix = await trancher(actifs, MODELE_CHOIX);
const second = await trancher(actifs, JUGES.j2);

// 2. Les fusions : toute proposition « meme », de l'UN OU L'AUTRE modèle, passe au consensus des deux juges.
type Proposee = { b: any; i: number; metier: string };
const proposees: Proposee[] = [...new Map<string, Proposee>(actifs.flatMap((b: any, i: number) => [choix[i], second[i]]
  .filter((r: any) => r?.decision === 'meme' && r.metier).map((r: any): [string, Proposee] => [`${i}|${r.metier}`, { b, i, metier: r.metier }]))).values()];
const verdicts = await consensus(proposees.map(({ b, metier }) => {
  const m = metiersServis.find((x) => x.key === metier)!;
  return { intitule: b.label, metier: `${m.labels.fr} / ${m.labels.en}`, alias: m.aliases };
}));
const fusions = new Map<number, { metier: string; verdict: string }[]>();
proposees.forEach(({ i, metier }, n) => { fusions.set(i, [...(fusions.get(i) ?? []), { metier, verdict: verdicts[n] }]); });

const decisions = actifs.map((b: any, i: number) => {
  const c = choix[i], s = second[i], f = fusions.get(i) ?? [];
  const confirmees = f.filter((x) => x.verdict === 'confirme');
  const metierFusion = confirmees.find((x) => x.metier === c?.metier)?.metier ?? confirmees[0]?.metier ?? null;
  // Sans les deux réponses, ou avec une fusion sans verdict, rien n'est tranché : en faire un « nouveau » métier
  // créerait un doublon. Une exclusion (« pas un métier ») exige l'accord des deux modèles.
  const decision = !c || !s ? 'indetermine' : metierFusion ? 'variante' : f.some((x) => x.verdict === 'indetermine') ? 'indetermine'
    : c.decision === 'non_metier' && s.decision === 'non_metier' ? 'non_metier' : 'nouveau';
  const familleAccord = c && s && c.famille === s.famille;
  return { id: b.id, slug: b.slug, label: b.label, statut: b.statut, population: { sources: b.sources, profilsRecherche: b.profilsRecherche, profilsPosteActuel: b.profilsPosteActuel, offres: b.offres },
    decision, metierServi: decision === 'variante' ? metierFusion : null, ancreEsco: c?.ancre ?? null,
    famille: decision === 'nouveau' ? (familleAccord ? c.famille : null) : null,
    famillesProposees: decision === 'nouveau' && !familleAccord ? [c?.famille, s?.famille] : undefined,
    preuve: { choix: c ?? null, second: s ?? null, fusions: f } };
});

// 3. Les métiers remplacés suivent leur successeur.
const parId = new Map(decisions.map((d: any) => [d.id, d]));
const remplaces = backend.metiers.filter((b: any) => b.axe === 'METIER' && b.statut !== 'ACTIVE' && b.remplacePar).map((b: any) => {
  let cible = b.remplacePar, pas = 0;
  while (cible && !parId.has(cible) && pas++ < 10) cible = backend.metiers.find((x: any) => x.id === cible)?.remplacePar;
  return { id: b.id, slug: b.slug, label: b.label, statut: b.statut, decision: 'successeur', successeur: cible ?? null,
    population: { sources: b.sources, profilsRecherche: b.profilsRecherche, profilsPosteActuel: b.profilsPosteActuel, offres: b.offres } };
});

// 4. Les domaines du backend vers une famille.
const CONSIGNE_DOMAINE = `Chaque élément est un DOMAINE fonctionnel du référentiel actuel de Catwalks (ex. « CRM & fidélisation »). Donne, dans "famille", la clé de la famille Catwalks qui lui correspond, ou "nouvelle:<nom court en français>". Réponds "decision":"nouveau", "metier":null, "ancre":null.`;
const domainesTranches = [] as any[];
for (const modele of [MODELE_CHOIX, JUGES.j2]) {
  const reps = await repondre(modele, `${CONSIGNE_DOMAINE}\n\nFAMILLES CATWALKS : ${LISTE_FAMILLES}`, domaines, 16,
    (lot: any[]) => lot.map((b, j) => `[${j}] « ${b.label} »`).join('\n'), SCHEMA);
  domainesTranches.push(reps.map((r) => r?.famille));
}
const domainesDecisions = domaines.map((b: any, i: number) => ({ id: b.id, slug: b.slug, label: b.label,
  famille: domainesTranches[0][i] && domainesTranches[0][i] === domainesTranches[1][i] ? domainesTranches[0][i] : null,
  famillesProposees: domainesTranches[0][i] === domainesTranches[1][i] ? undefined : [domainesTranches[0][i], domainesTranches[1][i]] }));

const compte = (l: any[], cle: string) => l.reduce((a, x) => ({ ...a, [x[cle] ?? 'null']: (a[x[cle] ?? 'null'] ?? 0) + 1 }), {} as Record<string, number>);
const bilan = { decisions: compte(decisions, 'decision'), fusionsProposees: proposees.length, consensusFusions: compte(verdicts.map((v) => ({ v })), 'v'),
  famillesSansAccord: decisions.filter((d: any) => d.famillesProposees).length, remplaces: remplaces.length,
  domainesSansAccord: domainesDecisions.filter((d: any) => d.famillesProposees).length };
mkdirSync(SORTIE, { recursive: true });
writeFileSync(`${SORTIE}1-correspondance-backend.json`, JSON.stringify({ calculeLe: new Date().toISOString(), modeles: { choix: MODELE_CHOIX, ...JUGES },
  esco: esco.version, bilan, decisions, remplaces, domaines: domainesDecisions }, null, 1));
console.log(JSON.stringify(bilan, null, 1));
// Un métier sans décision complète n'est pas un résultat : l'étape échoue, pour qu'on la relance au lieu de s'appuyer dessus.
const incomplets = decisions.filter((d: any) => d.decision === 'indetermine').length + domainesDecisions.filter((d: any) => !d.famillesProposees && !d.famille).length;
if (incomplets) { console.error(`ÉTAPE INCOMPLÈTE : ${incomplets} élément(s) sans décision complète`); process.exitCode = 1; }
