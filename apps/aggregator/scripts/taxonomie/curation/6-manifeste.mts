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
import { compileOccupationManifest, type OccupationManifest } from '../../../../../packages/db/occupation-engine.ts';
import { validateOccupationSuccessor } from '../../../src/occupation/release.ts';
import { conceptsV3, DOSSIER_SORTIE, familles, libellesEtFormes, lireEtape, phraseMoteur, servie } from './commun.mts';

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
const interdites = new Set<string>(e5c.attributions.filter((a: any) => a.motif === 'forme vague interdite').map((a: any) => a.forme));

// Familles.
const cleFamille = (k: string) => k;
const famillesV3 = [
  ...servie.families.map((f: any) => ({ ...f, labels: { ...(e5b.libelles[f.key] ?? {}), fr: f.labels.fr } })),
  ...e2.nouvellesFamilles.map((f: any) => ({ key: cleFamille(f.key), group: f.group, labels: e5b.libelles[f.key] ?? f.labels,
    ...(f.horsSecteur ? { sansElargissement: true } : {}) })),
];

// Métiers.
const metiersV3 = concepts.map((c) => {
  const s = servis.get(c.cle);
  const labels = libellesDe(c.cle);
  const aliases = [...new Set([...(s?.aliases ?? []), ...Object.values(labels), ...Object.values(libellesEtFormes(c.cle, e5ParCle, e5b).formes).flat(), ...(e5c.aliasRecherche[c.cle] ?? [])])]
    .filter((x) => x && x !== labels.fr && !interdites.has(phraseMoteur(x)) && (!attribution.get(phraseMoteur(x)) || attribution.get(phraseMoteur(x))!.garde === c.cle || !attribution.get(phraseMoteur(x))!.retires.includes(c.cle)));
  const ancre = e5ParCle.get(c.cle)?.ancreEsco;
  return { key: cleMetier.get(c.cle)!, family: s ? s.family : cleFamille(c.famille), labels, aliases,
    ...(ancre ? { externalRefs: [ancre] } : {}),
    ...(c.cle === 'financial-controller' && e5c.aliasRecherche[c.cle] ? { titleOnlyAliases: e5c.aliasRecherche[c.cle] } : {}) };
});

// Règles.
const exclusions: Record<string, string[]> = e4.bilan.exclusions;
const exclure = (occupation: string) => (exclusions[occupation]?.length ? [{ field: 'title' as const, any: exclusions[occupation] }] : []);
const exclusionsServies = (occupation: string) => servie.rules.filter((r: any) => r.occupation === occupation && r.all.every((c: any) => c.field === 'title'))
  .flatMap((r: any) => (r.exclude ?? []).filter((c: any) => c.field === 'title'));
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
  all: r.all.map((c: any) => (c.field === 'title' ? { ...c, any: c.any.filter((v: string) => !interdites.has(phraseMoteur(v)) && garderServie(r.occupation, v)) } : c)),
  exclude: [...(r.exclude ?? []), ...exclure(r.occupation)] })).filter((r: any) => r.all.every((c: any) => c.any.length));
const dejaServie = (occupation: string, f: string) => servie.rules.some((r: any) => r.occupation === occupation && r.all.length === 1 && r.all[0].field === 'title' && r.all[0].any.some((v: string) => phraseMoteur(v) === f));
const generalisables = new Set<string>(!BASE && existsSync(`${DOSSIER_SORTIE}6c-generalisations.json`)
  ? lireEtape('6c-generalisations.json').decisions.filter((d: any) => d.mode === 'generalisable').map((d: any) => `${d.occupation}|${d.expression}`) : []);
const reglesV3 = concepts.flatMap((c) => [...expressions.get(c.cle)!].filter((f) => !interdites.has(f) && !dejaServie(c.cle, f)).sort().map((f) => {
  const key = cleMetier.get(c.cle)!;
  const exclude = [...exclusionsServies(c.cle), ...exclure(c.cle)];
  return { id: `v3-${key}~${createHash('sha256').update(f).digest('hex').slice(0, 10)}`, occupation: key,
    all: [{ field: 'title' as const, any: [brute.get(f)!], mode: BASE || generalisables.has(`${key}|${f}`) ? 'phrase' as const : 'exact' as const }],
    ...(exclude.length ? { exclude } : {}),
    evidence: 'Passe de curation v3 du 28-29/09/2026 (D-475 §30-§34) : variante validée par consensus de deux juges ou déjà servie, ou libellé relu ; audits/2026-09-28/curation-v3.' };
}));

// Préséance : la portée la plus longue l'emporte, sans cycle.
type Regle = { id: string; occupation: string; all: { field: string; any: string[]; mode?: string }[]; supersedes?: string[] };
const regles: Regle[] = [...reglesServies, ...reglesV3];
const phrases = new Map<string, Regle[]>();
for (const r of regles) for (const c of r.all) if (c.field === 'title' && c.mode !== 'exact') for (const v of c.any) phrases.set(phraseMoteur(v), [...(phrases.get(phraseMoteur(v)) ?? []), r]);
const suivants = new Map<string, Set<string>>(regles.map((r) => [r.id, new Set(r.supersedes ?? [])]));
const atteint = (de: string, vers: string) => {
  const pile = [de], vus = new Set<string>();
  while (pile.length) { const x = pile.pop()!; if (x === vers) return true; if (vus.has(x)) continue; vus.add(x); pile.push(...(suivants.get(x) ?? [])); }
  return false;
};
let arcs = 0, arcsRefuses = 0;
for (const a of regles) for (const c of a.all) if (c.field === 'title') for (const v of c.any) {
  const mots = phraseMoteur(v).split(' ');
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

const maintenant = new Date();
const manifeste = {
  ...servie, id: ID,
  review: { author: 'Passe de curation v3 (IA seule, D-475 §30)', at: maintenant.toISOString(),
    basis: `Première passe de curation : ${concepts.length} métiers (servis, backend, offres), ${famillesV3.length} familles, 25 langues ; preuves : audits/2026-09-28/curation-v3.` },
  families: famillesV3, occupations: metiersV3, rules: regles,
} as unknown as OccupationManifest;
const compile = compileOccupationManifest(manifeste);
validateOccupationSuccessor(servie, manifeste);

const fichier = BASE ? '6-manifeste-base.json' : '6-manifeste-v3.json';
writeFileSync(`${DOSSIER_SORTIE}${fichier}`, JSON.stringify(manifeste, null, 1));
if (!BASE) writeFileSync(`${DOSSIER_SORTIE}6-correspondances.json`, JSON.stringify({ calculeLe: maintenant.toISOString(), manifeste: ID,
  metiers: Object.fromEntries(tous.map((c) => [c.cle, cleDe(c.cle)])), absorbes: Object.fromEntries(dans),
  familles: Object.fromEntries(famillesV3.map((f: any) => [f.key, f.key])), libellesRetires, arbitragesFinaux }, null, 1));
const bilan = { fichier, id: ID, familles: famillesV3.length, metiers: metiersV3.length, absorbes: dans.size, regles: regles.length,
  reglesV3: reglesV3.length, reglesExactes: reglesV3.filter((r) => r.all[0].mode === 'exact').length, generalisables: generalisables.size,
  arbitragesFinaux: arbitragesFinaux.length, libellesRetires: libellesRetires.length, libellesPartages: libellesPartages.length,
  nonIdempotentes: nonIdempotentes.length, preseances: arcs, preseancesRefuseesPourCycle: arcsRefuses, compile: compile.occupations.size, succession: 'conforme' };
console.log(JSON.stringify(bilan, null, 1));
for (const x of libellesPartages.slice(0, 10)) console.log(` libellé partagé : ${x}`);
if (nonIdempotentes.length || libellesPartages.length) { console.error(`ASSEMBLAGE REFUSÉ : ${nonIdempotentes.length} expression(s) non idempotente(s), ${libellesPartages.length} libellé(s) partagé(s)`); process.exitCode = 1; }
