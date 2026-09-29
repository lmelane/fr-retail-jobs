/**
 * PASSE DE CURATION v3, ÉTAPE 2 : LES FAMILLES (D-475 §29-§31 ; plan `docs/architecture/classification-metiers.md`
 * §3.1-§3.2).
 *
 * Toute entrée de la taxonomie a une famille (plan §3.2 : « famille obligatoire, aucun orphelin »). L'étape 1 laisse
 * ouvertes les entrées sur lesquelles ses deux modèles ne s'accordent pas, et celles qu'ils rangent dans une famille
 * nouvelle (« nouvelle:<nom> », sous plusieurs orthographes). Ici :
 *  0. les métiers hors luxe vont dans une seule famille « Autres secteurs » (D-475 §33) : ceux dont les deux modèles
 *     disent qu'ils ne s'exercent ni dans une Maison ni dans une entreprise du luxe, de la mode, de la beauté, du
 *     retail ou de l'hôtellerie, fonctions support comprises, ET que le backend ne rangeait dans aucune famille (un
 *     métier sans famille y est « hors périmètre », D-143 §5 ; une famille du luxe donnée à la main l'emporte sur
 *     l'accord des modèles : « Journaliste », « Praticien·ne en médecine esthétique », 29/09/2026) ; cette famille
 *     n'est jamais proposée au rangement ;
 *  1. les propositions de familles nouvelles sont ramenées à des familles canoniques : clé stable Catwalks (jamais
 *     l'ESCO), libellés français et anglais, groupe parmi les quatre du catalogue ;
 *  2. chaque entrée ouverte est rangée par les deux modèles, indépendamment, dans UNE famille parmi celles du
 *     catalogue et les canoniques : accord → retenue ; désaccord → celle des deux propositions qui contient le
 *     métier déjà rangé le plus proche (vecteurs), départage reproductible sans troisième avis ;
 *  3. une famille nouvelle qui ne reçoit aucun métier est dissoute (les familles servies en portent souvent un seul) :
 *     ses entrées vont à l'autre proposition de l'étape 2, sinon à une famille proposée à l'étape 1, sinon, en dernier
 *     recours, à la famille du métier rangé le plus proche (première passe du 28/09/2026 : ce dernier recours, pris
 *     d'emblée, rangeait « Mannequin » dans l'atelier) ;
 *  4. les 13 familles du backend reçoivent leur correspondance : la répartition réelle de leurs métiers dans les
 *     familles du catalogue (en nombre de métiers et en population), sans modèle.
 *
 * Entrées : `curation-v3/1-correspondance-backend.json`, `curation-v3/1b-doublons-backend.json` et celles de
 * `commun.mts`.
 * Sortie : `audits/2026-09-28/curation-v3/2-familles.json`. Aucune écriture en base. L'étape échoue si un
 * métier ou un domaine reste sans famille.
 *
 *   node --env-file=<fichier .env portant GEMINI_API_KEY> --import tsx \
 *     apps/aggregator/scripts/taxonomie/curation/2-familles.mts
 */
import { writeFileSync } from 'node:fs';
import { backend, CACHE_VECTEURS, DOSSIER_SORTIE, escoMetiers, familles, groupes, lireEtape, metiersServis, texteBackend, texteServi } from './commun.mts';
import { cosinus, JUGES, MODELE_CHOIX, repondre, vecteurs } from './ia.mts';

/** Une famille nouvelle existe dès qu'elle range un métier : 11 des 27 familles servies en portent 0 ou 1. */
const MIN_METIERS_FAMILLE_NOUVELLE = 1;
/** D-475 §33 : la famille des métiers hors luxe (groupe `services`, le plus proche parmi les quatre du catalogue). */
const AUTRES_SECTEURS = { key: 'autres-secteurs', labels: { fr: 'Autres secteurs', en: 'Other sectors' }, group: 'services', horsSecteur: true };
const etape1 = lireEtape('1-correspondance-backend.json');
// Un métier absorbé par un doublon (étape 1b) n'est pas rangé : il prend la famille de son représentant.
const absorbes = new Map<string, string>(lireEtape('1b-doublons-backend.json').groupes
  .flatMap((g: any) => g.variantes.map((v: any) => [v.id, g.representant.id] as [string, string])));
const CLES = new Set(familles.map((f) => f.key));
const escoParUri = new Map(escoMetiers.map((m: any) => [m.uri, m]));
const servisParCle = new Map(metiersServis.map((m) => [m.key, m]));

// Les entrées : métiers nouveaux et domaines. Une variante prend la famille du métier servi qu'elle rejoint.
type Entree = { id: string; slug: string; label: string; type: 'metier' | 'domaine'; b: any; ancre: string | null;
  propositions: (string | null)[]; famille: string | null; methode: string | null };
const parId = new Map(backend.metiers.map((b: any) => [b.id, b]));
const entrees: Entree[] = [
  ...etape1.decisions.filter((d: any) => d.decision === 'nouveau' && !absorbes.has(d.id)).map((d: any) => ({ id: d.id, slug: d.slug, label: d.label, type: 'metier' as const,
    b: parId.get(d.id), ancre: d.ancreEsco, propositions: [d.preuve.choix?.famille ?? null, d.preuve.second?.famille ?? null], famille: null, methode: null })),
  ...etape1.domaines.map((d: any) => ({ id: d.id, slug: d.slug, label: d.label, type: 'domaine' as const, b: parId.get(d.id), ancre: null,
    propositions: d.famillesProposees ?? [d.famille, d.famille], famille: null, methode: null })),
];
for (const e of entrees) if (e.propositions[0] && e.propositions[0] === e.propositions[1] && CLES.has(e.propositions[0])) {
  e.famille = e.propositions[0]; e.methode = 'accord-etape-1';
}

// 0. Hors secteur (D-475 §33), sur l'accord des deux modèles.
const CONSIGNE_SECTEUR = `Catwalks est la plateforme de recrutement du luxe, de la mode, de la beauté, du retail et de l'hôtellerie (41 pays).
Pour chaque MÉTIER, dis dans "hors_secteur" s'il ne s'exerce NI dans une Maison NI dans une entreprise de ces secteurs. Les fonctions support d'une Maison (finance, ressources humaines, juridique, informatique, logistique, communication, services généraux…) sont DANS le secteur, comme TOUT commerce de détail et toute boutique, quel que soit ce qu'elle vend (une libraire ou un vendeur de boutique sont dans le secteur). Hors secteur, par exemple : agent immobilier, conseiller bancaire, garde d'enfants.`;
const SCHEMA_SECTEUR = { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, hors_secteur: { type: 'BOOLEAN' } }, required: ['i', 'hors_secteur'] };
const metiersEntrees = entrees.filter((e) => e.type === 'metier');
const renduMetier = (lot: Entree[]) => lot.map((e, j) => `[${j}] « ${e.label} »${e.b?.aliases?.length ? ` (alias : ${e.b.aliases.slice(0, 6).join(', ')})` : ''}`).join('\n');
const [s1, s2] = [await repondre(MODELE_CHOIX, CONSIGNE_SECTEUR, metiersEntrees, 20, renduMetier, SCHEMA_SECTEUR),
  await repondre(JUGES.j2, CONSIGNE_SECTEUR, metiersEntrees, 20, renduMetier, SCHEMA_SECTEUR)];
const secteurSansAvis = metiersEntrees.filter((_, k) => !s1[k] || !s2[k]).length;
metiersEntrees.forEach((e, k) => {
  (e as any).horsSecteur = [s1[k]?.hors_secteur ?? null, s2[k]?.hors_secteur ?? null];
  if (s1[k]?.hors_secteur && s2[k]?.hors_secteur && !e.b?.familleId) { e.famille = AUTRES_SECTEURS.key; e.methode = 'hors-secteur'; }
});

// 1. Familles canoniques à partir des propositions « nouvelle:<nom> » des entrées du secteur.
const propositionsNouvelles = [...new Set(entrees.filter((e) => e.methode !== 'hors-secteur').flatMap((e) => e.propositions).filter((p): p is string => !!p && p.startsWith('nouvelle:')))].sort();
const porteurs = (p: string) => entrees.filter((e) => e.methode !== 'hors-secteur' && e.propositions.includes(p)).map((e) => e.label);
const CONSIGNE_CANON = `Tu ranges la taxonomie des métiers de Catwalks (luxe, mode, beauté, retail, sièges des Maisons, 41 pays).
Des modèles ont proposé des FAMILLES NOUVELLES de métiers, sous des orthographes différentes. Pour chaque proposition, donne la famille canonique qui la représente : deux propositions qui désignent le même domaine d'activité reçoivent EXACTEMENT la même "cle". Une famille couvre un domaine d'activité entier, avec les métiers qui le servent (un agent, un assistant ou un coordinateur du domaine en fait partie).
"cle" : identifiant en minuscules, mots français sans accents séparés par des tirets (ex. "services-a-la-personne") ; "fr" et "en" : libellé court de la famille ; "groupe" : un des groupes ${groupes.join(', ')}.
Si une proposition correspond en fait à une famille qui existe déjà, donne la clé de celle-ci. Familles existantes : ${familles.map((f) => `${f.key} (${f.labels.fr})`).join(' · ')}.`;
const SCHEMA_CANON = { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, cle: { type: 'STRING' }, fr: { type: 'STRING' }, en: { type: 'STRING' },
  groupe: { type: 'STRING', enum: groupes } }, required: ['i', 'cle', 'fr', 'en', 'groupe'] };
const canon = await repondre(MODELE_CHOIX, CONSIGNE_CANON, propositionsNouvelles, 40,
  (lot: string[]) => lot.map((p, j) => `[${j}] ${p.slice('nouvelle:'.length)} — métiers : ${porteurs(p).slice(0, 5).join(', ')}`).join('\n'), SCHEMA_CANON,
  (r) => /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(r.cle));
const nouvelles = new Map<string, { key: string; labels: { fr: string; en: string }; group: string; propositions: string[] }>();
propositionsNouvelles.forEach((p, k) => {
  const c = canon[k];
  if (!c || CLES.has(c.cle)) return;
  const f = nouvelles.get(c.cle) ?? { key: c.cle, labels: { fr: c.fr, en: c.en }, group: c.groupe, propositions: [] as string[] };
  f.propositions.push(p);
  nouvelles.set(c.cle, f);
});
const canonSansReponse = propositionsNouvelles.filter((_, k) => !canon[k]);
const versCanon = new Map(propositionsNouvelles.flatMap((p, k) => (canon[k] ? [[p, canon[k].cle] as const] : [])));

// 2. Rangement des entrées ouvertes par les deux modèles, parmi toutes les familles.
const toutes = [...familles.map((f) => ({ key: f.key, fr: f.labels.fr, group: f.group })), ...[...nouvelles.values()].map((f) => ({ key: f.key, fr: f.labels.fr, group: f.group }))];
const CONSIGNE_RANGER = `Tu ranges la taxonomie des métiers de Catwalks (luxe, mode, beauté, retail, sièges des Maisons, 41 pays).
Pour chaque entrée (un métier, ou un domaine fonctionnel du référentiel actuel), donne dans "famille" la clé de LA famille qui lui convient le mieux, au sens de la fonction exercée.
FAMILLES : ${toutes.map((f) => `${f.key} (${f.fr} ; ${f.group})`).join(' · ')}`;
const SCHEMA_RANGER = { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, famille: { type: 'STRING', enum: toutes.map((f) => f.key) } }, required: ['i', 'famille'] };
const rendu = (lot: Entree[]) => lot.map((e, j) => {
  const a = e.ancre ? escoParUri.get(e.ancre) as any : null;
  const desc = a ? ` ; métier ESCO proche : ${a.libelles.fr ?? a.libelles.en} — ${(a.description?.fr ?? a.description?.en ?? '').slice(0, 160)}` : '';
  return `[${j}] ${e.type === 'domaine' ? 'DOMAINE' : 'MÉTIER'} « ${e.label} »${e.b?.aliases?.length ? ` (alias : ${e.b.aliases.slice(0, 6).join(', ')})` : ''}${desc}`;
}).join('\n');
const ouvertes = entrees.filter((e) => !e.famille);
const [r1, r2] = [await repondre(MODELE_CHOIX, CONSIGNE_RANGER, ouvertes, 20, rendu, SCHEMA_RANGER),
  await repondre(JUGES.j2, CONSIGNE_RANGER, ouvertes, 20, rendu, SCHEMA_RANGER)];

// Le voisinage : les métiers déjà rangés (servis, variantes, nouveaux en accord), avec leurs vecteurs.
const variantes = etape1.decisions.filter((d: any) => d.decision === 'variante');
const vec = await vecteurs([...metiersServis.map(texteServi), ...entrees.filter((e) => e.b).map((e) => texteBackend(e.b)),
  ...variantes.map((d: any) => texteBackend(parId.get(d.id)))], CACHE_VECTEURS);
const ranges = () => [
  ...metiersServis.map((m) => ({ famille: m.family, v: vec.get(texteServi(m))! })),
  ...variantes.map((d: any) => ({ famille: servisParCle.get(d.metierServi)!.family, v: vec.get(texteBackend(parId.get(d.id)))! })),
  ...entrees.filter((e) => e.type === 'metier' && e.famille && (e.methode ?? '').startsWith('accord')).map((e) => ({ famille: e.famille!, v: vec.get(texteBackend(e.b))! })),
];
/** Parmi `candidates`, la famille qui contient le métier rangé le plus proche de l'entrée. */
function plusProche(e: Entree, candidates: string[], voisins: { famille: string; v: number[] }[]) {
  const v = vec.get(texteBackend(e.b))!;
  let meilleure: string | null = null, score = -Infinity;
  for (const x of voisins) if (candidates.includes(x.famille)) { const s = cosinus(v, x.v); if (s > score) { score = s; meilleure = x.famille; } }
  return meilleure;
}

// Sans la réponse des deux modèles, rien n'est rangé : l'étape échoue (audit technique du 29/09/2026 : l'avis d'un seul
// modèle était retenu).
const rangementSansAvis = ouvertes.filter((_, k) => !r1[k] || !r2[k]).map((e) => e.label);
ouvertes.forEach((e, k) => { if (r1[k] && r2[k] && r1[k].famille === r2[k].famille) { e.famille = r1[k].famille; e.methode = 'accord-etape-2'; } });
const voisinsAccord = ranges();
ouvertes.forEach((e, k) => {
  if (e.famille || !r1[k] || !r2[k]) return;
  const props = [...new Set([r1[k]?.famille, r2[k]?.famille].filter(Boolean))] as string[];
  e.famille = plusProche(e, props, voisinsAccord) ?? props[0] ?? null;
  e.methode = 'voisinage';
  (e as any).propositionsEtape2 = props;
});

// 3. Dissolution des familles nouvelles trop petites.
const metiersParFamille = (cle: string) => entrees.filter((e) => e.type === 'metier' && e.famille === cle).length;
const dissoutes = [...nouvelles.keys()].filter((k) => metiersParFamille(k) < MIN_METIERS_FAMILLE_NOUVELLE);
const voisinsFinal = ranges().filter((x) => !dissoutes.includes(x.famille));
const valides = [...CLES, ...[...nouvelles.keys()].filter((k) => !dissoutes.includes(k))];
for (const e of entrees) if (e.famille && dissoutes.includes(e.famille)) {
  const autre = ((e as any).propositionsEtape2 ?? []).find((p: string) => valides.includes(p))
    ?? e.propositions.find((p) => p && valides.includes(p));
  e.famille = autre ?? plusProche(e, valides, voisinsFinal);
  e.methode = `dissolution:${e.methode}`;
}
for (const k of dissoutes) nouvelles.delete(k);

// 4. Correspondance des familles du backend.
const familleFinale = new Map<string, string | null>();
for (const d of etape1.decisions) familleFinale.set(d.id, d.decision === 'variante' ? servisParCle.get(d.metierServi)!.family : null);
for (const e of entrees) familleFinale.set(e.id, e.famille);
for (const [id, representant] of absorbes) familleFinale.set(id, familleFinale.get(representant) ?? null);
const populationDe = (b: any) => b.sources + b.profilsRecherche + b.profilsPosteActuel;
const correspondance = backend.familles.map((f: any) => {
  const metiers = backend.metiers.filter((b: any) => b.axe === 'METIER' && b.statut === 'ACTIVE' && b.familleId === f.id);
  const nombre: Record<string, number> = {}, population: Record<string, number> = {};
  for (const b of metiers) {
    const c = familleFinale.get(b.id) ?? 'sans-famille';
    nombre[c] = (nombre[c] ?? 0) + 1; population[c] = (population[c] ?? 0) + populationDe(b);
  }
  const principale = Object.entries(population).filter(([c]) => c !== 'sans-famille').sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { slug: f.slug, label: f.label, metiers: metiers.length, principale, nombre, population };
});

const sansFamille = entrees.filter((e) => !e.famille);
const horsSecteur = entrees.filter((e) => e.famille === AUTRES_SECTEURS.key);
const compte = (l: any[], f: (x: any) => string) => l.reduce((a, x) => ({ ...a, [f(x)]: (a[f(x)] ?? 0) + 1 }), {} as Record<string, number>);
const bilan = { entrees: entrees.length, methodes: compte(entrees, (e) => e.methode ?? 'aucune'), propositionsNouvelles: propositionsNouvelles.length,
  canoniques: [...versCanon.values()].filter((v, k, t) => t.indexOf(v) === k).length, nouvellesRetenues: [...nouvelles.keys()], dissoutes,
  horsSecteur: horsSecteur.length, secteurSansAvis, rangementSansAvis: rangementSansAvis.length, canonSansReponse: canonSansReponse.length, sansFamille: sansFamille.length };
writeFileSync(`${DOSSIER_SORTIE}2-familles.json`, JSON.stringify({ calculeLe: new Date().toISOString(), modeles: { choix: MODELE_CHOIX, second: JUGES.j2 },
  seuils: { MIN_METIERS_FAMILLE_NOUVELLE }, bilan, nouvellesFamilles: [...nouvelles.values(), ...(horsSecteur.length ? [AUTRES_SECTEURS] : [])], canon: Object.fromEntries(versCanon),
  attributions: entrees.map(({ b, ...e }) => e), correspondanceFamillesBackend: correspondance }, null, 1));
console.log(JSON.stringify(bilan, null, 1));
console.log(`hors secteur : ${horsSecteur.map((e) => e.label).join(', ')}`);
if (sansFamille.length || secteurSansAvis || rangementSansAvis.length || canonSansReponse.length) { console.error(`ÉTAPE INCOMPLÈTE : ${sansFamille.length} entrée(s) sans famille, ${secteurSansAvis} sans avis de secteur`); process.exitCode = 1; }
