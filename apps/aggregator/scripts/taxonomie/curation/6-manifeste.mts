/**
 * PASSE DE CURATION v3, ÉTAPE 6 : ASSEMBLAGE DU MANIFESTE v3 (D-475 §29-§34 ; plan
 * `docs/architecture/classification-metiers.md` §3.1). Aucun appel de modèle, aucune écriture en base.
 *
 * Forme additive, dans le format que le moteur accepte (`packages/db/occupation-engine.ts`) :
 *  - les clés servies restent, avec leur famille ; leurs libellés français et anglais validés restent, sauf ceux qui
 *    violent la forme courte (D-475 §31 c : barre ou double nom), remplacés par le libellé relu de l'étape 5b ;
 *  - les métiers absorbés par la garde d'unicité (étape 5c, fusion confirmée par les deux juges) disparaissent : leurs
 *    libellés et variantes deviennent des expressions du métier qui les absorbe ;
 *  - un métier nouveau reçoit une clé STABLE, tirée de son identifiant (slug du backend, clé du groupe d'offres), jamais
 *    d'un libellé écrit par l'IA (audit technique du 29/09/2026 : la clé changeait avec le libellé) ;
 *  - un libellé qui désigne encore un autre métier dans une langue (renommage demandé par 5c et non obtenu) est retiré de
 *    cette langue : pas de nom plutôt qu'un nom qui en désigne un autre (défaut connu, listé) ;
 *  - les expressions de chaque métier viennent des sources BRUTES validées (libellés, variantes jugées aux étapes 1 à 4,
 *    alias servis et du backend, alias de recherche de l'API), normalisées UNE fois comme le moteur (`phraseMoteur`,
 *    idempotence vérifiée ici) ; les formes interdites et les attributions de 5c s'appliquent, puis une garde finale
 *    déterministe (une forme servie reste au métier servi ; sinon au seul métier qui la nomme ; sinon retirée) ;
 *  - chaque expression devient une règle `v3-<clé>~<empreinte>` en mode EXACT (l'intitulé entier), sauf celles que les
 *    juges ont vérifiées sur ce qu'elles captent (étape 6c) : mode phrase. Sans preuve, pas de généralisation (R-66 §2) ;
 *    avec l'option `--base`, toutes sont en mode phrase : c'est le manifeste que juge l'étape 6c ;
 *  - préséance : une règle dont la valeur contient strictement (mots entiers, découpe du moteur) l'expression d'une
 *    règle en mode phrase d'un autre métier passe devant elle, sans cycle : l'expression la plus longue l'emporte
 *    (D-475 §32 a) ; une règle exacte y participe (l'intitulé entier est la portée la plus longue) ;
 *  - une règle v3 d'un métier servi hérite des exclusions revues de ses règles servies ; les exclusions d'encadrement
 *    de l'étape 4 s'appliquent à toutes les règles du métier encadré ;
 *  - la famille « Autres secteurs » porte `sansElargissement` (D-143 §5, D-475 §33 : elle range, elle ne rapproche pas) ;
 *    le métier de contrôle de gestion porte `titleOnlyAliases` (alias qui ne valent que pour un intitulé) ;
 *  - les patrons exécutables hérités restent tels quels (le moteur les veut immuables).
 * Le manifeste est compilé par le moteur et comparé à la version servie (`validateOccupationSuccessor`).
 *
 * Sorties : `6-manifeste-v3.json` (ou `6-manifeste-base.json` avec `--base`) et `6-correspondances.json`.
 *
 *   node --import tsx apps/aggregator/scripts/taxonomie/curation/6-manifeste.mts [--base]
 */
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { compileOccupationManifest, occupationExactKey, occupationMatchKey, type OccupationManifest } from '../../../../../packages/db/occupation-engine.ts';
import { manifestVocabularyCollisions, vocabularyCollisions } from '../../../../../packages/db/occupation-vocabulary.ts';
import releaseDecidee from '../../../../../packages/db/data/occupations-v1.json' with { type: 'json' };
import secteurs from '../../../../../packages/db/data/sectors-v1.json' with { type: 'json' };
import { FAMILY_ALIASES, SEARCH_VOCABULARY_VERSION, searchConcepts } from '../../../../../packages/db/search-vocabulary.ts';
import { searchWords } from '../../../../../packages/db/search-intent.ts';
import { validateOccupationSuccessor } from '../../../src/occupation/release.ts';
import { conceptsV3, DOSSIER_SORTIE, estVague, EXCLUS_RAYON, familles, libellesEtFormes, lireEtape, niveauSeul, phraseMoteur, servie, VAGUES } from './commun.mts';

const BASE = process.argv.includes('--base');
const ID = 'catwalks-occupations-20260929-v3';
const slug = (v: string) => v.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const e1 = lireEtape('1-correspondance-backend.json'), e2 = lireEtape('2-familles.json'), e3 = lireEtape('3-intitules-offres.json');
const e3b = lireEtape('3b-garde-unicite.json'), e4 = lireEtape('4-encadrement.json'), e5 = lireEtape('5-libelles.json');
const e5b = lireEtape('5b-libelles-corrections.json'), e5c = lireEtape('5c-garde.json');
const e5ParCle = new Map<string, any>(e5.metiers.map((m: any) => [m.cle, m]));
const servis = new Map<string, any>(servie.occupations.map((o: any) => [o.key, o]));
const tous = conceptsV3({ avecOffres: true, avecEncadrement: true });

// Fusions de 5c : le métier absorbé disparaît au profit de sa racine.
const dans = new Map<string, string>(e5c.fusions.map((f: any) => [f.absorbe, f.dans]));
const racine = (k: string): string => (dans.has(k) ? racine(dans.get(k)!) : k);
const concepts = tous.filter((c) => !dans.has(c.cle));

// Clés stables.
const prises = new Set<string>([...servie.groups.map((g: any) => g.key), ...familles.map((f) => f.key), ...e2.nouvellesFamilles.map((f: any) => f.key), ...servis.keys()]);
const cleStable = (cle: string) => {
  if (servis.has(cle) || cle === 'optical-assistant') return cle;
  let k = slug(cle.replace(/^(backend|offres|encadrement):/, ''));
  if (prises.has(k)) k = `${k}-metier`;
  for (let n = 2; prises.has(k); n++) k = `${k.replace(/-\d+$/, '')}-${n}`;
  prises.add(k);
  return k;
};
const cleMetier = new Map<string, string>(concepts.map((c) => [c.cle, cleStable(c.cle)]));
const cleDe = (cle: string) => cleMetier.get(racine(cle))!;

// Libellés : 5b (formes valides comprises) ; servis gardés sauf forme longue ; retirés là où ils désignent un autre métier.
const formeLongue = (v?: string) => !!v && (/\s\/\s|\//.test(v) || /\s+et\s+/.test(v));
const renommages = new Set<string>(e5c.renommages.map((r: any) => `${r.cle}|${r.langue}`));
const libellesRetires: { cle: string; langue: string; libelle: string }[] = [];
const libellesCalcules = new Map<string, Record<string, string>>();
const libellesDe = (cle: string) => libellesCalcules.get(cle) ?? libellesCalcules.set(cle, calculerLibelles(cle)).get(cle)!;
function calculerLibelles(cle: string) {
  const { libelles } = libellesEtFormes(cle, e5ParCle, e5b);
  const s = servis.get(cle);
  const l: Record<string, string> = { ...libelles };
  if (s) for (const langue of ['fr', 'en']) if (s.labels[langue] && !formeLongue(s.labels[langue])) l[langue] = s.labels[langue];
  for (const langue of Object.keys(l)) if (langue !== 'fr' && renommages.has(`${cle}|${langue}`)) { libellesRetires.push({ cle, langue, libelle: l[langue] }); delete l[langue]; }
  return Object.fromEntries(Object.entries(l).filter(([, v]) => v?.trim()));
}

// Expressions brutes validées de chaque métier (absorbés compris), normalisées une fois.
const brutes = new Map<string, Set<string>>(concepts.map((c) => [c.cle, new Set<string>()]));
const ajouter = (cle: string | null | undefined, v: string | null | undefined) => { if (cle && v && brutes.has(racine(cle))) brutes.get(racine(cle))!.add(v); };
for (const c of tous) {
  for (const v of [c.fr, c.en, ...c.variantes]) ajouter(c.cle, v);
  const { libelles, formes } = libellesEtFormes(c.cle, e5ParCle, e5b);
  for (const v of Object.values(libelles)) ajouter(c.cle, v);
  for (const v of Object.values(formes).flat()) ajouter(c.cle, v);
  for (const v of e5c.aliasRecherche[c.cle] ?? []) ajouter(c.cle, v);
}
for (const t of e3.intitules) if (t.decision === 'variante') ajouter(t.concept, t.intitule);
for (const v of e3b.variantesAjoutees) ajouter(v.concept, v.intitule);
for (const t of e4.intitules) if (t.cible) ajouter(t.cible, t.intitule);
// D-475 §37 a (arbitrage du CEO) : « Supervisor », « Superviseur » et « Lead » seuls reçoivent le Floor manager,
// intitulé exact seulement (des mots de niveau : jamais généralisés).
const FLOOR_MANAGER = concepts.find((c) => cleMetier.get(c.cle) === 'manager-floor')?.cle;
if (!FLOOR_MANAGER) throw new Error('métier Floor manager absent');
const DECIDES_37 = ['Supervisor', 'Superviseur', 'Superviseure', 'Superviseuse', 'Lead'];
for (const v of DECIDES_37) ajouter(FLOOR_MANAGER, v);
// D-475 §35 : l'étape 3c décide, pour chaque intitulé et chaque ancien nom d'« Employé de commerce » : vente, rayon, ou
// aucun métier sans accord des juges ; les formes grammaticales d'un nom suivent son verdict. Elle fait autorité sur tout
// ce qu'elle a jugé, anciens noms compris (retirés des libellés par le renommage).
const scission = lireEtape('3c-scission-vente.json');
const [deRayon, deVente] = [racine(scission.source), racine(scission.cible)];
if (!brutes.has(deRayon) || !brutes.has(deVente)) throw new Error(`scission 3c : métier absent (${deRayon} ou ${deVente})`);
const textesDe = (d: any): string[] => [d.intitule, ...(d.formes ?? [])];
const decide = new Map<string, string>();
for (const d of scission.decisions) for (const t of textesDe(d)) decide.set(phraseMoteur(t), d.metier);
for (const v of [...brutes.get(deRayon)!]) if (decide.has(phraseMoteur(v)) && decide.get(phraseMoteur(v)) !== 'rayon') brutes.get(deRayon)!.delete(v);
for (const d of scission.decisions) for (const t of textesDe(d)) { if (d.metier === 'vente') brutes.get(deVente)!.add(t); if (d.metier === 'rayon') brutes.get(deRayon)!.add(t); }
// Les NOMS jugés (pas les intitulés d'offre, avec leurs horaires et leurs lieux) deviennent le vocabulaire de recherche.
const nomsJuges = (m: string) => scission.decisions.filter((d: any) => d.origine === 'nom' && d.metier === m).flatMap(textesDe);
// Dans la séparation, la mise en rayon quitte le conseil de vente pour les opérations de boutique (D-475 §35).
const FAMILLE_RAYON = 'retail-operations';
// Intitulés jugés sur de vraies offres (étapes 3, 3b, 4, 3c) : ils priment sur une variante ou une forme d'un autre métier
// (« general manager » d'une boutique, jugé directeur de magasin avec son employeur, n'est pas la « Direction »). À l'étape 3,
// seulement quand les deux juges ont choisi le même métier (« product manager » : Chef de produit pour l'un, Product
// Owner pour l'autre, n'a pas cette force).
const juge = new Map<string, string>();
for (const t of e3.intitules) if (t.decision === 'variante' && t.preuve?.choix?.concept === t.concept && t.preuve?.second?.concept === t.concept) juge.set(phraseMoteur(t.intitule), racine(t.concept));
for (const v of e3b.variantesAjoutees) juge.set(phraseMoteur(v.intitule), racine(v.concept));
for (const t of e4.intitules) if (t.cible) juge.set(phraseMoteur(t.intitule), racine(t.cible));
for (const d of scission.decisions) if (d.metier !== 'aucun') for (const t of textesDe(d)) juge.set(phraseMoteur(t), d.metier === 'vente' ? deVente : deRayon);
// La règle garde l'expression BRUTE (le moteur la normalise une fois ; normalisée deux fois, « e-commerce » perdait son
// « e », audit technique du 29/09/2026) ; la garde compare les formes normalisées.
const brute = new Map<string, string>();
const expressions = new Map<string, Set<string>>([...brutes].map(([cle, s]) => [cle, new Set([...s].map((v) => {
  const f = phraseMoteur(v);
  if (f && !brute.has(f)) brute.set(f, v.trim());
  return f;
}).filter(Boolean))]));

// Attributions de 5c, puis garde finale déterministe (les formes que 5c n'a pas vues sous cette normalisation).
const attribution = new Map<string, { garde: string | null; retires: string[] }>(e5c.attributions.map((a: any) => [a.forme, a]));
const servieParForme = new Map<string, Set<string>>();
for (const r of servie.rules) for (const c of r.all) if (c.field === 'title') for (const v of c.any) servieParForme.set(phraseMoteur(v), new Set([...(servieParForme.get(phraseMoteur(v)) ?? []), r.occupation]));
for (const o of servie.occupations) for (const v of [o.labels.fr, o.labels.en, ...(o.aliases ?? [])]) if (v) servieParForme.set(phraseMoteur(v), new Set([...(servieParForme.get(phraseMoteur(v)) ?? []), o.key]));
const nommePar = (f: string) => concepts.filter((c) => Object.values(libellesDe(c.cle)).some((v) => phraseMoteur(v) === f)).map((c) => c.cle);
const arbitragesFinaux: { forme: string; metiers: string[]; garde: string | null; motif: string }[] = [];
const porteurs = new Map<string, string[]>();
for (const [cle, s] of expressions) for (const f of s) porteurs.set(f, [...(porteurs.get(f) ?? []), cle]);
for (const [f, cles] of porteurs) {
  // Priorité : expression validée en production, puis intitulé jugé sur de vraies offres, puis attribution de 5c.
  const servisDeF = [...(servieParForme.get(f) ?? [])];
  // Jamais contre le NOM d'un autre métier : un libellé choisi dans la recherche doit rendre son métier (banc 6e).
  if (servisDeF.length !== 1 && juge.has(f) && cles.includes(juge.get(f)!) && cles.length > 1 && nommePar(f).every((k) => k === juge.get(f))) {
    const garde = juge.get(f)!;
    for (const k of cles) if (k !== garde) expressions.get(k)!.delete(f);
    arbitragesFinaux.push({ forme: f, metiers: cles, garde, motif: 'intitulé jugé' });
    continue;
  }
  const a = attribution.get(f);
  // Une forme attribuée par 5c n'appartient qu'à son gardien : tout autre métier la perd, même s'il la tient d'une source
  // que 5c ne voyait pas (« Demand Planner », variante d'un planificateur venue des offres, 29/09/2026).
  if (a) { for (const k of cles) if (a.garde === null || k !== racine(a.garde)) expressions.get(k)!.delete(f); continue; }
  const servisDe = [...(servieParForme.get(f) ?? [])];
  const metiers = [...new Set([...cles, ...servisDe])];
  if (metiers.length < 2) continue;
  const nommeurs = nommePar(f);
  const garde = servisDe.length === 1 ? servisDe[0] : nommeurs.length === 1 ? nommeurs[0] : null;
  for (const k of cles) if (k !== garde) expressions.get(k)!.delete(f);
  arbitragesFinaux.push({ forme: f, metiers, garde, motif: servisDe.length === 1 ? 'version servie' : nommeurs.length === 1 ? 'libellé' : 'ambiguë, retirée' });
}
// Formes vagues (§32 c), appliquées à TOUTES les expressions, pas seulement à celles que 5c a vues (« superviseur » restait).
const interdites = new Set<string>([...VAGUES, ...e3.intitules.filter((t: any) => t.preuve?.choix?.decision === 'vague' && t.preuve?.second?.decision === 'vague').map((t: any) => phraseMoteur(t.intitule)),
  ...e5c.attributions.filter((a: any) => a.motif === 'forme vague interdite').map((a: any) => a.forme)]);
// Une décision du CEO prime sur le jugement « vague » des juges de l'étape 3 (« lead », jugé vague, §37 a), pour le
// seul métier qu'elle désigne (audit de clôture du 29/09/2026 : sans ce métier, la primauté ouvrait la forme à tous).
const decidesCeo = new Set(DECIDES_37.map(phraseMoteur));
const interdite = (f: string, cle?: string) => !(cle === FLOOR_MANAGER && decidesCeo.has(f)) && (interdites.has(f) || estVague(f));

// Familles.
const cleFamille = (k: string) => k;
const famillesV3 = [
  ...servie.families.map((f: any) => ({ ...f, labels: { ...(e5b.libelles[f.key] ?? {}), fr: f.labels.fr } })),
  ...e2.nouvellesFamilles.map((f: any) => ({ key: cleFamille(f.key), group: f.group, labels: e5b.libelles[f.key] ?? f.labels,
    ...(f.horsSecteur ? { sansElargissement: true } : {}) })),
];

if (!famillesV3.some((f: any) => f.key === FAMILLE_RAYON)) throw new Error(`famille absente : ${FAMILLE_RAYON}`);

// Métiers.
// §31 c : une forme remplacée reste une variante de recherche. Les libellés de la version servie (« Spécialiste
// sourcils et épilation », forme longue remplacée par la forme courte) et le vocabulaire de la release décidée le
// 14/09/2026 mais pas encore servie (`catwalks-occupations-20260914-v2`, optique et pharmacie : « Dispenser »,
// « Optical Advisor ») restent donc des alias (audit du lot 2B-2 : 23 recherches trouvées en v1 et perdues en v3).
const decideeParCle = new Map<string, any>((releaseDecidee as any).occupations.map((o: any) => [o.key, o]));
// Un ancien nom cède devant une expression qu'un AUTRE métier porte (« Relief Dispenser », alias de l'assistant en
// pharmacie dans la release du 14/09, jugé préparateur en pharmacie sur les offres) : l'intitulé jugé passe avant.
const porteursParCleV2 = new Map<string, Set<string>>();
for (const [cle, s] of expressions) for (const f of s) { const k = occupationExactKey(brute.get(f) ?? f, 2); porteursParCleV2.set(k, new Set([...(porteursParCleV2.get(k) ?? []), cle])); }
const anciensNoms = (cle: string, cleV3: string, s: any) => [...Object.values<string>(s?.labels ?? {}),
  ...Object.values<string>(decideeParCle.get(cleV3)?.labels ?? {}), ...(decideeParCle.get(cleV3)?.aliases ?? [])]
  .filter((v) => [...(porteursParCleV2.get(occupationExactKey(v, 2)) ?? [])].every((k) => k === cle));
const exclusions: Record<string, string[]> = e4.bilan.exclusions;
// 3c : une forme décidée pour l'un des deux métiers est exclue des règles de l'autre, une forme sans métier des deux
// (audit du 29/09/2026 : « Retail Assistant - Night Shift », décidé sans métier, restait Conseiller de vente par la règle
// « retail assistant »). Le contrôle d'assemblage plus bas vérifie que chaque décision de 3c tient dans le moteur.
const exclusScission = (occupation: string): string[] => (occupation !== deVente && occupation !== deRayon ? []
  : [...scission.decisions.filter((d: any) => d.metier === 'aucun' || d.metier === (occupation === deVente ? 'rayon' : 'vente')).flatMap(textesDe),
    ...(occupation === deRayon ? EXCLUS_RAYON : [])]);
const exclure = (occupation: string) => {
  const l = [...(exclusions[occupation] ?? []), ...exclusScission(occupation)];
  return l.length ? [{ field: 'title' as const, any: l }] : [];
};
const exclusionsServies = (occupation: string) => servie.rules.filter((r: any) => r.occupation === occupation && r.all.every((c: any) => c.field === 'title'))
  .flatMap((r: any) => (r.exclude ?? []).filter((c: any) => c.field === 'title'));
// Ce qui empêche la lecture (point 38) : les frontières servies entre métiers (« adjoint », « deputy », « beauty »,
// « stockroom ») et les décisions v3 (§32 a, §35, §37), sauf « formation » et « training », que l'exemple même de la
// décision montre faux (« Conseiller(ère) de Vente – Poste avec formation avant embauche », « Training Provided »).
const ROUTAGE_FAUX = new Set(['FORMATION', 'TRAINING']);
const exclusionsDeLecture = (occupation: string) => [...new Set([...exclusionsServies(occupation).flatMap((c: any) => c.any), ...exclure(occupation).flatMap((c) => c.any)])]
  .filter((v: string) => !ROUTAGE_FAUX.has(phraseMoteur(v)));
const cleRecherche = (v: string) => searchWords(v).join(' ');
// Expressions lues dans un intitulé plus long (`titleRoles`, D-475 point 38) : seulement celles que l'étape 6g a vérifiées
// sur ce qu'elles y captent (R-66 §2) ; un métier les porte parmi ses libellés et alias.
const lues: { phrase: string; occupation: string }[] = !BASE && existsSync(`${DOSSIER_SORTIE}6g-lectures.json`)
  ? lireEtape('6g-lectures.json').decisions.filter((d: any) => d.mode === 'lue') : [];
const luesDe = (cle: string, noms: string[]) => { const p = new Set(lues.filter((d) => d.occupation === cle).map((d) => d.phrase)); return [...new Set(noms)].filter((x) => p.has(cleRecherche(x))).sort(); };
const metiersV3 = concepts.map((c) => {
  const s = servis.get(c.cle);
  const labels = libellesDe(c.cle);
  const vente = c.cle === deVente ? nomsJuges('vente') : c.cle === deRayon ? nomsJuges('rayon') : [];
  const aliases = [...new Set([...(s?.aliases ?? []), ...Object.values(labels), ...Object.values(libellesEtFormes(c.cle, e5ParCle, e5b).formes).flat(), ...(e5c.aliasRecherche[c.cle] ?? []), ...vente,
    ...anciensNoms(c.cle, cleMetier.get(c.cle)!, s)])]
    .filter((x) => x && x !== labels.fr && !interdite(phraseMoteur(x), c.cle) && !(c.cle === deRayon && decide.has(phraseMoteur(x)) && decide.get(phraseMoteur(x)) !== 'rayon') && (!attribution.get(phraseMoteur(x)) || attribution.get(phraseMoteur(x))!.garde === c.cle || !attribution.get(phraseMoteur(x))!.retires.includes(c.cle)));
  const ancre = e5ParCle.get(c.cle)?.ancreEsco;
  const lu = luesDe(cleMetier.get(c.cle)!, [...Object.values(labels), ...aliases]);
  return { key: cleMetier.get(c.cle)!, family: s ? s.family : c.cle === deRayon ? FAMILLE_RAYON : cleFamille(c.famille), labels, aliases,
    ...(lu.length ? { titleReadingAliases: lu } : {}),
    ...(exclusionsDeLecture(c.cle).length ? { titleReadingExclusions: exclusionsDeLecture(c.cle) } : {}),
    ...(ancre ? { externalRefs: [ancre] } : {}),
    ...(c.cle === 'financial-controller' && e5c.aliasRecherche[c.cle] ? { titleOnlyAliases: e5c.aliasRecherche[c.cle] } : {}) };
});

// Règles.
// Une forme servie portée par les règles de DEUX métiers servis reste au seul qui la nomme (« Demand Planner », ambigu en
// v1 entre prévisionniste de la demande et planificateur merchandising, reste au premier : plan §3.1).
const garderServie = (occupation: string, v: string) => {
  const f = phraseMoteur(v), porteursServis = [...(servieParForme.get(f) ?? [])];
  if (porteursServis.length < 2) return true;
  const nommeurs = porteursServis.filter((k) => [servis.get(k)?.labels.fr, servis.get(k)?.labels.en].some((x) => x && phraseMoteur(x) === f));
  return nommeurs.length !== 1 || nommeurs[0] === occupation;
};
const reglesServies = servie.rules.map((r: any) => ({ ...r,
  // Une forme vague interdite (§32 c) ne classe plus rien, même servie.
  all: r.all.map((c: any) => (c.field === 'title' ? { ...c, any: c.any.filter((v: string) => !interdite(phraseMoteur(v)) && garderServie(r.occupation, v)) } : c)),
  exclude: [...(r.exclude ?? []), ...exclure(r.occupation)] })).filter((r: any) => r.all.every((c: any) => c.any.length));
const dejaServie = (occupation: string, f: string) => servie.rules.some((r: any) => r.occupation === occupation && r.all.length === 1 && r.all[0].field === 'title' && r.all[0].any.some((v: string) => phraseMoteur(v) === f));
const generalisables = new Set<string>(!BASE && existsSync(`${DOSSIER_SORTIE}6c-generalisations.json`)
  ? lireEtape('6c-generalisations.json').decisions.filter((d: any) => d.mode === 'generalisable').map((d: any) => `${d.occupation}|${d.expression}`) : []);
const reglesV3Brutes = concepts.flatMap((c) => [...expressions.get(c.cle)!].filter((f) => !interdite(f, c.cle) && !dejaServie(c.cle, f)).sort().map((f) => {
  const key = cleMetier.get(c.cle)!;
  const exclude = [...exclusionsServies(c.cle), ...exclure(c.cle)];
  return { id: `v3-${key}~${createHash('sha256').update(f).digest('hex').slice(0, 10)}`, occupation: key,
    all: [{ field: 'title' as const, any: [brute.get(f)!], mode: BASE || (generalisables.has(`${key}|${f}`) && !niveauSeul(f)) ? 'phrase' as const : 'exact' as const }],
    ...(exclude.length ? { exclude } : {}),
    evidence: 'Passe de curation v3 du 28-29/09/2026 (D-475 §30-§34) : variante validée par consensus de deux juges ou déjà servie, ou libellé relu ; audits/2026-09-28/curation-v3.' };
}));

// Garde d'unicité sous les clés v2 (lot 2B) : en ramenant le féminin au masculin et en retirant les marques de genre et
// de contrat, deux expressions de métiers différents peuvent devenir la même clé (« Magasinier H/F » du stock en boutique
// et « Magasinier » de l'entrepôt). Même priorité que la garde finale : version servie, puis intitulé jugé sur de vraies
// offres, sinon l'expression est retirée des deux côtés. Les règles servies ne sont jamais modifiées.
const clesV2 = (c: any, v: string) => [c.mode === 'exact' ? `exact ${occupationExactKey(v, 2)}` : `phrase ${occupationMatchKey(v, 2)}`,
  ...(c.mode === 'exact' ? [] : [`exact ${occupationExactKey(v, 2)}`])];
const porteursV2 = new Map<string, { servis: Set<string>; v3: Set<string>; juges: Set<string> }>();
const noter = (occupation: string, c: any, v: string, servi: boolean) => { for (const k of clesV2(c, v)) {
  const x = porteursV2.get(k) ?? { servis: new Set(), v3: new Set(), juges: new Set() };
  (servi ? x.servis : x.v3).add(occupation);
  const j = juge.get(phraseMoteur(v)); if (j) x.juges.add(cleMetier.get(j) ?? j);
  porteursV2.set(k, x);
} };
for (const r of reglesServies) for (const c of r.all) if (c.field === 'title') for (const v of c.any) noter(r.occupation, c, v, true);
for (const r of reglesV3Brutes) for (const c of r.all) for (const v of c.any) noter(r.occupation, c, v, false);
// Le métier dont c'est le libellé, quand ni la version servie ni un intitulé jugé ne tranchent (même ordre que la garde finale).
const nommeursV2 = new Map<string, Set<string>>();
for (const o of metiersV3) for (const l of Object.values<string>(o.labels)) for (const k of [`exact ${occupationExactKey(l, 2)}`, `phrase ${occupationMatchKey(l, 2)}`])
  nommeursV2.set(k, new Set([...(nommeursV2.get(k) ?? []), o.key]));
const arbitragesV2: { cle: string; metiers: string[]; garde: string | null; motif: string }[] = [];
const gardeV2 = new Map<string, string | null>();
for (const [k, x] of porteursV2) {
  const metiers = new Set([...x.servis, ...x.v3]);
  if (metiers.size < 2) continue;
  const nommeurs = [...(nommeursV2.get(k) ?? [])].filter((o) => metiers.has(o));
  const [garde, motif] = x.servis.size === 1 ? [[...x.servis][0], 'version servie']
    : x.servis.size === 0 && x.juges.size === 1 && metiers.has([...x.juges][0]) ? [[...x.juges][0], 'intitulé jugé']
    : x.servis.size === 0 && nommeurs.length === 1 ? [nommeurs[0], 'libellé'] : [null, 'ambiguë, retirée'];
  gardeV2.set(k, garde);
  arbitragesV2.push({ cle: k, metiers: [...metiers], garde, motif });
}
const reglesV3 = reglesV3Brutes.flatMap((r) => {
  const any = r.all[0].any.filter((v: string) => clesV2(r.all[0], v).every((k) => !gardeV2.has(k) || gardeV2.get(k) === r.occupation));
  return any.length ? [{ ...r, all: [{ ...r.all[0], any }] }] : [];
});

// Préséance : la portée la plus longue l'emporte, sans cycle.
type Regle = { id: string; occupation: string; all: { field: string; any: string[]; mode?: string }[]; supersedes?: string[] };
const regles: Regle[] = [...reglesServies, ...reglesV3];
const phrases = new Map<string, Regle[]>();
// Sur les clés v2, celles que le moteur compare (« Visual Merchandising Managerin » y devient « … Manager », contenu
// dans « Assistant Visual Merchandising Manager »).
const cleMoteur = (v: string) => occupationMatchKey(v, 2);
for (const r of regles) for (const c of r.all) if (c.field === 'title' && c.mode !== 'exact') for (const v of c.any) phrases.set(cleMoteur(v), [...(phrases.get(cleMoteur(v)) ?? []), r]);
const suivants = new Map<string, Set<string>>(regles.map((r) => [r.id, new Set(r.supersedes ?? [])]));
const atteint = (de: string, vers: string) => {
  const pile = [de], vus = new Set<string>();
  while (pile.length) { const x = pile.pop()!; if (x === vers) return true; if (vus.has(x)) continue; vus.add(x); pile.push(...(suivants.get(x) ?? [])); }
  return false;
};
let arcs = 0, arcsRefuses = 0;
for (const a of regles) for (const c of a.all) if (c.field === 'title') for (const v of c.any) {
  const mots = cleMoteur(v).split(' ');
  for (let n = 1; n < mots.length; n++) for (let i = 0; i + n <= mots.length; i++) for (const b of phrases.get(mots.slice(i, i + n).join(' ')) ?? []) {
    if (b.occupation === a.occupation || suivants.get(a.id)!.has(b.id)) continue;
    if (atteint(b.id, a.id)) { arcsRefuses++; continue; }
    suivants.get(a.id)!.add(b.id);
    arcs++;
  }
}
for (const r of regles) { const s = [...suivants.get(r.id)!]; if (s.length) r.supersedes = s; }

// Contrôles d'assemblage : idempotence de la normalisation, unicité des libellés par langue.
// La forme compilée par le moteur de chaque valeur écrite doit être celle que la garde a jugée.
const nonIdempotentes = reglesV3.filter((r) => !expressions.get(concepts.find((c) => cleMetier.get(c.cle) === r.occupation)!.cle)!.has(phraseMoteur(r.all[0].any[0]))).map((r) => r.id);
const libellesPartages: string[] = [];
for (const langue of new Set(metiersV3.flatMap((m) => Object.keys(m.labels)))) {
  const vus = new Map<string, string>();
  for (const m of metiersV3) { const v = m.labels[langue]; if (!v) continue; const f = phraseMoteur(v); if (vus.has(f)) libellesPartages.push(`${langue} « ${v} » : ${vus.get(f)} / ${m.key}`); else vus.set(f, m.key); }
}

const nomsDeSecteur = new Set<string>((secteurs as any[]).flatMap((s) => Object.values<string>(s.labels).map(cleRecherche)));
const maintenant = new Date();
const manifeste = {
  ...servie, id: ID,
  // Correspondance v2 (lot 2B) : écritures japonaise et thaïe, formes féminines, marques ignorées en mode exact.
  matchingVersion: 2,
  // Le manifeste porte tout le vocabulaire de recherche : alias de métiers de l'API (versés par 5c) et de familles (ici).
  searchVocabularyVersion: SEARCH_VOCABULARY_VERSION,
  review: { author: 'Passe de curation v3 (IA seule, D-475 §30)', at: maintenant.toISOString(),
    basis: `Première passe de curation : ${concepts.length} métiers (servis, backend, offres), ${famillesV3.length} familles, 25 langues ; preuves : audits/2026-09-28/curation-v3.` },
  families: famillesV3.map((f: any) => {
    // Alias de famille : ceux de l'API et les noms remplacés de la version servie et de la release décidée (§31 c),
    // jamais le nom d'un secteur (« Hospitality » est le secteur : une famille qui le porte rend la recherche muette).
    const anciens = [...Object.values<string>(servie.families.find((x: any) => x.key === f.key)?.labels ?? {}),
      ...Object.values<string>((releaseDecidee as any).families.find((x: any) => x.key === f.key)?.labels ?? {})];
    const aliases = [...new Set([...(f.aliases ?? []), ...(FAMILY_ALIASES[f.key] ?? []), ...anciens])]
      .filter((a) => !Object.values<string>(f.labels).includes(a) && !nomsDeSecteur.has(cleRecherche(a)));
    return aliases.length ? { ...f, aliases } : f;
  }),
  occupations: metiersV3, rules: regles,
} as unknown as OccupationManifest;
const compile = compileOccupationManifest(manifeste);
// Garde d'unicité sous les clés v2 : une forme féminine ramenée au masculin, une marque retirée, ne doit jamais réunir
// deux métiers (« Directrice » et « Directeur » dans deux métiers différents deviendraient la même clé).
const parCle = new Map<string, Set<string>>();
for (const r of regles as any[]) for (const c of r.all) if (c.field === 'title') for (const v of c.any) {
  const k = c.mode === 'exact' ? `exact ${occupationExactKey(v, 2)}` : `phrase ${occupationMatchKey(v, 2)}`;
  parCle.set(k, new Set([...(parCle.get(k) ?? []), r.occupation]));
  if (c.mode !== 'exact') { const e = `exact ${occupationExactKey(v, 2)}`; parCle.set(e, new Set([...(parCle.get(e) ?? []), r.occupation])); }
}
// La garde partagée (packages/db/occupation-vocabulary.ts), sur ses deux surfaces : le moteur (les métiers, clé du
// moteur) et la recherche (métiers, familles et secteurs ensemble, clé de la recherche, comme le test de l'API).
const collisionsVocabulaire = [...manifestVocabularyCollisions(manifeste),
  ...vocabularyCollisions(searchConcepts(manifeste, secteurs as any).map((c) => ({ key: c.key, kind: c.kind, aliases: [...c.aliases, ...(c.titleOnlyAliases ?? [])] })), cleRecherche)];
const collisionsV2 = [...parCle].filter(([, occ]) => occ.size > 1).map(([k, occ]) => ({ cle: k, metiers: [...occ] }));
const [cleVente, cleRayon] = [cleMetier.get(deVente)!, cleMetier.get(deRayon)!];
const attendu = (m: string, rendu: string | null) => (m === 'vente' ? rendu === cleVente : m === 'rayon' ? rendu === cleRayon : rendu !== cleVente && rendu !== cleRayon);
const ecartsScission = scission.decisions.flatMap((d: any) => textesDe(d).map((t) => ({ texte: t, decision: d.metier, rendu: compile.classify(t, null).occupationCode })))
  .filter((x: any) => !attendu(x.decision, x.rendu));
validateOccupationSuccessor(servie, manifeste);
// Chaque lecture vérifiée par 6g doit trouver son expression chez son métier : sinon le vocabulaire a changé depuis 6g.
const luesPerdues = lues.filter((d) => !metiersV3.some((o: any) => o.key === d.occupation && (o.titleReadingAliases ?? []).some((a: string) => cleRecherche(a) === d.phrase)));

// Un manifeste refusé ne remplace jamais le bon : il s'écrit à part (audit du lot 2B-2).
const refuse = luesPerdues.length + nonIdempotentes.length + libellesPartages.length + ecartsScission.length + collisionsV2.length + collisionsVocabulaire.length > 0;
const fichier = `${BASE ? '6-manifeste-base' : '6-manifeste-v3'}${refuse ? '.refuse' : ''}.json`;
writeFileSync(`${DOSSIER_SORTIE}${fichier}`, JSON.stringify(manifeste, null, 1));
if (!BASE && !refuse) writeFileSync(`${DOSSIER_SORTIE}6-correspondances.json`, JSON.stringify({ calculeLe: maintenant.toISOString(), manifeste: ID,
  metiers: Object.fromEntries(tous.map((c) => [c.cle, cleDe(c.cle)])), absorbes: Object.fromEntries(dans), arbitragesV2,
  familles: Object.fromEntries(famillesV3.map((f: any) => [f.key, f.key])), libellesRetires, arbitragesFinaux }, null, 1));
const bilan = { fichier, id: ID, familles: famillesV3.length, metiers: metiersV3.length, absorbes: dans.size, regles: regles.length,
  reglesV3: reglesV3.length, reglesExactes: reglesV3.filter((r) => r.all[0].mode === 'exact').length, generalisables: generalisables.size,
  lues: lues.length, luesPerdues: luesPerdues.length, arbitragesFinaux: arbitragesFinaux.length, arbitragesV2: arbitragesV2.length, libellesRetires: libellesRetires.length, libellesPartages: libellesPartages.length,
  nonIdempotentes: nonIdempotentes.length, ecartsScission: ecartsScission.length, collisionsV2: collisionsV2.length, collisionsVocabulaire: collisionsVocabulaire.length, preseances: arcs, preseancesRefuseesPourCycle: arcsRefuses, compile: compile.occupations.size, succession: 'conforme' };
console.log(JSON.stringify(bilan, null, 1));
for (const x of libellesPartages.slice(0, 10)) console.log(` libellé partagé : ${x}`);
for (const x of collisionsVocabulaire.slice(0, 15)) console.log(` vocabulaire : ${x.kind} « ${x.key} » → ${x.concepts.join(', ')}`);
if (collisionsVocabulaire.length) { console.error(`ASSEMBLAGE REFUSÉ : ${collisionsVocabulaire.length} variante(s) pour plusieurs concepts`); process.exitCode = 1; }
for (const x of collisionsV2.slice(0, 15)) console.log(` collision v2 : « ${x.cle} » → ${x.metiers.join(', ')}`);
if (collisionsV2.length) { console.error(`ASSEMBLAGE REFUSÉ : ${collisionsV2.length} clé(s) v2 pour plusieurs métiers`); process.exitCode = 1; }
for (const x of ecartsScission.slice(0, 10)) console.log(` 3c non tenu : « ${x.texte} » décidé ${x.decision}, rendu ${x.rendu ?? 'aucun'}`);
if (ecartsScission.length) { console.error(`ASSEMBLAGE REFUSÉ : ${ecartsScission.length} décision(s) de 3c non tenue(s) par le moteur`); process.exitCode = 1; }
for (const x of luesPerdues.slice(0, 10)) console.log(` lecture perdue : « ${x.phrase} » → ${x.occupation}`);
if (luesPerdues.length) { console.error(`ASSEMBLAGE REFUSÉ : ${luesPerdues.length} lecture(s) de 6g sans expression chez leur métier`); process.exitCode = 1; }
if (nonIdempotentes.length || libellesPartages.length) { console.error(`ASSEMBLAGE REFUSÉ : ${nonIdempotentes.length} expression(s) non idempotente(s), ${libellesPartages.length} libellé(s) partagé(s)`); process.exitCode = 1; }
