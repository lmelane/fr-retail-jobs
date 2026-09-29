/**
 * PASSE DE CURATION v3, ÉTAPE 6 : ASSEMBLAGE DU MANIFESTE v3 (D-475 §29-§33 ; plan
 * `docs/architecture/classification-metiers.md` §3.1). Aucun appel de modèle, aucune écriture en base.
 *
 * Forme additive, dans le format que le moteur accepte (`packages/db/occupation-engine.ts`) :
 *  - les 61 clés servies (et `optical-assistant`) restent, avec leur famille et leurs noms français et anglais validés ;
 *    les 23 autres langues viennent de l'étape 5b ; leurs alias servis restent, les formes des libellés s'y ajoutent ;
 *  - chaque métier nouveau reçoit une clé Catwalks stable, en anglais comme les clés servies, tirée de son libellé
 *    anglais (jamais de l'ESCO, dont l'URI va dans `externalRefs`) ; les familles nouvelles de même ;
 *  - chaque expression d'un métier (variantes validées de l'étape 5, libellés) devient une règle littérale
 *    `v3-<clé>~<empreinte>`, et une règle dont l'expression en contient strictement une autre, d'un autre métier, passe
 *    devant elle (préséance du moteur, sans cycle) : l'expression la plus longue l'emporte (D-475 §32 a) ;
 *  - une expression dont les juges ont rejeté une capture, ou non vérifiée faute de volume (étape 6c), ne vaut que pour
 *    l'intitulé exact (règle en mode « exact ») ; sans le fichier de 6c, toutes sont des expressions (manifeste de base) ;
 *  - une règle v3 d'un métier servi hérite des exclusions revues de ses règles servies ; les exclusions d'encadrement
 *    de l'étape 4 s'appliquent à TOUTES les règles du métier encadré ;
 *  - les patrons exécutables hérités restent tels quels (le moteur les veut immuables).
 * Garde d'unicité finale : une expression portée par les règles de deux métiers reste à celui dont une règle SERVIE la
 * porte, sinon à celui dont elle est le libellé ; ambiguë, elle est retirée des règles nouvelles (« Demand Planner »,
 * sur deux métiers en v1, reste au seul métier qui s'appelle ainsi). Le manifeste est compilé par le moteur et comparé à
 * la version servie par la règle de succession (`validateOccupationSuccessor` : aucune clé retirée ni déplacée).
 *
 * Sorties : `curation-v3/6-manifeste-v3.json` (le manifeste) et `curation-v3/6-correspondances.json` (métiers du
 * backend et familles → clés v3, arbitrages de la garde).
 *
 *   node --import tsx apps/aggregator/scripts/taxonomie/curation/6-manifeste.mts
 */
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { compileOccupationManifest, normalizeOccupationTitle, type OccupationManifest } from '../../../../../packages/db/occupation-engine.ts';
import { validateOccupationSuccessor } from '../../../src/occupation/release.ts';
import { conceptsV3, DOSSIER_SORTIE, familles, lireEtape, servie } from './commun.mts';

const norme = (v: string) => normalizeOccupationTitle(v).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const slug = (v: string) => v.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const e2 = lireEtape('2-familles.json'), e4 = lireEtape('4-encadrement.json'), e5 = lireEtape('5-libelles.json'), e5b = lireEtape('5b-libelles-corrections.json');
const concepts = conceptsV3({ avecOffres: true, avecEncadrement: true });
const libelles5b: Record<string, Record<string, string>> = e5b.libelles;
const e5ParCle = new Map<string, any>(e5.metiers.map((m: any) => [m.cle, m]));
const servis = new Map<string, any>(servie.occupations.map((o: any) => [o.key, o]));

// Clés : une clé servie ne bouge pas ; une clé nouvelle vient du libellé anglais, unique parmi métiers, familles, groupes.
const prises = new Set<string>([...servie.groups.map((g: any) => g.key), ...familles.map((f) => f.key), ...servie.occupations.map((o: any) => o.key), 'optical-assistant']);
const cleNeuve = (base: string, precision: string) => {
  let k = slug(base) || slug(precision);
  if (prises.has(k)) k = `${k}-${slug(precision)}`;
  for (let n = 2; prises.has(k); n++) k = `${k.replace(/-\d+$/, '')}-${n}`;
  prises.add(k);
  return k;
};
const cleFamille = new Map<string, string>(familles.map((f) => [f.key, f.key]));
for (const f of e2.nouvellesFamilles) cleFamille.set(f.key, cleNeuve(libelles5b[f.key]?.en ?? f.labels.en, 'family'));
const cleMetier = new Map<string, string>();
for (const c of concepts) cleMetier.set(c.cle, servis.has(c.cle) || c.cle === 'optical-assistant' ? c.cle
  : cleNeuve(libelles5b[c.cle]?.en ?? c.en, cleFamille.get(c.famille) ?? 'metier'));

// Familles.
const LANGUES = Object.keys(libelles5b[concepts[0].cle] ?? {});
const avecServis = (libelles: Record<string, string>, fr: string, en?: string) => ({ ...libelles, fr, ...(en ? { en } : {}) });
const famillesV3 = [
  ...servie.families.map((f: any) => ({ ...f, labels: avecServis(libelles5b[f.key] ?? {}, f.labels.fr, f.labels.en) })),
  ...e2.nouvellesFamilles.map((f: any) => ({ key: cleFamille.get(f.key)!, group: f.group, labels: libelles5b[f.key] })),
];

// Expressions de chaque métier : variantes validées de l'étape 5, libellés et formes finaux.
const expressions = new Map<string, Set<string>>();
for (const c of concepts) {
  const s = new Set<string>(e5ParCle.get(c.cle)?.variantes ?? []);
  for (const l of LANGUES) { const v = libelles5b[c.cle]?.[l]; if (v) s.add(norme(v)); }
  for (const f of Object.values<string[]>(e5ParCle.get(c.cle)?.formes ?? {}).flat()) s.add(norme(f));
  s.delete('');
  expressions.set(c.cle, s);
}
// Garde d'unicité finale, contre les règles servies comprises.
const servieParExpression = new Map<string, Set<string>>();
for (const r of servie.rules) for (const c of r.all) if (c.field === 'title') for (const v of c.any)
  servieParExpression.set(norme(v), new Set([...(servieParExpression.get(norme(v)) ?? []), r.occupation]));
const porteurs = new Map<string, string[]>();
for (const [cle, s] of expressions) for (const v of s) porteurs.set(v, [...(porteurs.get(v) ?? []), cle]);
const arbitrages: { expression: string; metiers: string[]; garde: string | null; motif: string }[] = [];
for (const [v, cles] of porteurs) {
  const servisQuiLaPortent = [...(servieParExpression.get(v) ?? [])];
  const tous = [...new Set([...cles, ...servisQuiLaPortent])];
  if (tous.length < 2) continue;
  const nommes = tous.filter((k) => Object.values(libelles5b[k] ?? {}).some((x) => norme(x) === v) || [servis.get(k)?.labels?.fr, servis.get(k)?.labels?.en].some((x) => x && norme(x) === v));
  const garde = servisQuiLaPortent.length === 1 ? servisQuiLaPortent[0] : nommes.length === 1 ? nommes[0] : null;
  for (const k of cles) if (k !== garde) expressions.get(k)!.delete(v);
  arbitrages.push({ expression: v, metiers: tous, garde, motif: servisQuiLaPortent.length === 1 ? 'règle servie' : nommes.length === 1 ? 'libellé' : 'ambiguë, retirée' });
}

// Métiers et règles.
const exclusions: Record<string, string[]> = e4.bilan.exclusions;
const exclure = (occupation: string) => (exclusions[occupation]?.length ? [{ field: 'title' as const, any: exclusions[occupation] }] : []);
const metiersV3 = concepts.map((c) => {
  const s = servis.get(c.cle) as any;
  const labels = s ? avecServis(libelles5b[c.cle] ?? {}, s.labels.fr, s.labels.en) : libelles5b[c.cle];
  const formes = Object.values<string[]>(e5ParCle.get(c.cle)?.formes ?? {}).flat();
  const aliases = [...new Set([...(s?.aliases ?? []), ...Object.values<string>(labels), ...formes])].filter((x) => x && x !== labels.fr);
  const ancre = e5ParCle.get(c.cle)?.ancreEsco;
  return { key: cleMetier.get(c.cle)!, family: s ? s.family : cleFamille.get(c.famille)!, labels, aliases, ...(ancre ? { externalRefs: [ancre] } : {}) };
});
// Les règles servies gardent leurs exclusions et reçoivent celles de l'encadrement. Une règle v3 d'un métier servi hérite
// des exclusions revues de ses règles servies (« Customer Service Associate (Cashier) » restait caissier en v1 parce que la
// règle du service client exclut « cashier » ; sans cet héritage, la v3 l'aurait rendu ambigu, preview du 29/09/2026).
const reglesServies = servie.rules.map((r: any) => ({ ...r, exclude: [...(r.exclude ?? []), ...exclure(r.occupation)] }));
const exclusionsServies = (occupation: string) => servie.rules.filter((r: any) => r.occupation === occupation && r.all.every((c: any) => c.field === 'title'))
  .flatMap((r: any) => (r.exclude ?? []).filter((c: any) => c.field === 'title'));
// Une règle par expression, pour que l'expression la plus longue l'emporte (D-475 §32 a, lecture de l'assistant : le
// métier contenu dans un intitulé est celui qu'on y lit à la portée la plus longue) : « assistant store manager » passe
// devant « store manager », « visual merchandiser » devant « merchandiser ».
// Étape 6c : une expression dont les juges ont rejeté une capture (ou non vérifiée) ne vaut que pour l'intitulé exact.
const generalisations = existsSync(`${DOSSIER_SORTIE}6c-generalisations.json`) ? lireEtape('6c-generalisations.json') : null;
const exactes = new Set<string>(generalisations ? [...generalisations.decisions, ...generalisations.sousSeuil]
  .filter((d: any) => d.mode === 'exacte').map((d: any) => `${d.occupation}|${d.expression}`) : []);
const idRegle = (key: string, v: string) => `v3-${key}~${createHash('sha256').update(v).digest('hex').slice(0, 10)}`;
const reglesV3 = concepts.flatMap((c) => [...expressions.get(c.cle)!].sort().map((v) => {
  const exclude = [...exclusionsServies(c.cle), ...exclure(c.cle)];
  return { id: idRegle(cleMetier.get(c.cle)!, v), occupation: cleMetier.get(c.cle)!,
    all: [{ field: 'title' as const, any: [v], mode: exactes.has(`${cleMetier.get(c.cle)}|${v}`) ? 'exact' as const : 'phrase' as const }], ...(exclude.length ? { exclude } : {}),
    evidence: 'Passe de curation v3 du 28-29/09/2026 (D-475 §30-§33) : variante validée par consensus de deux juges ou déjà servie, ou libellé relu ; audits/2026-09-28/curation-v3.' };
}));
// Préséance : A passe devant B quand une expression de A contient strictement (mots entiers) une expression de B, pour
// deux métiers différents. Un arc qui fermerait une boucle n'est pas posé (le moteur exige un graphe sans cycle).
type Regle = { id: string; occupation: string; all: { field: string; any: string[] }[]; supersedes?: string[] };
const regles: Regle[] = [...reglesServies, ...reglesV3];
const parExpression = new Map<string, Regle[]>();
// Une règle exacte ne capte que son intitulé : elle n'entre pas dans les préséances d'expressions contenues.
const expressionsDe = (r: Regle) => r.all.filter((c: any) => c.field === 'title' && c.mode !== 'exact').flatMap((c) => c.any.map(norme));
for (const r of regles) for (const v of expressionsDe(r)) parExpression.set(v, [...(parExpression.get(v) ?? []), r]);
const suivants = new Map<string, Set<string>>(regles.map((r) => [r.id, new Set(r.supersedes ?? [])]));
const atteint = (de: string, vers: string) => {
  const pile = [de], vus = new Set<string>();
  while (pile.length) { const x = pile.pop()!; if (x === vers) return true; if (vus.has(x)) continue; vus.add(x); pile.push(...(suivants.get(x) ?? [])); }
  return false;
};
let arcs = 0, arcsRefuses = 0;
for (const a of regles) for (const v of expressionsDe(a)) {
  const mots = v.split(' ');
  for (let n = 1; n < mots.length; n++) for (let i = 0; i + n <= mots.length; i++) for (const b of parExpression.get(mots.slice(i, i + n).join(' ')) ?? []) {
    if (b.occupation === a.occupation || suivants.get(a.id)!.has(b.id)) continue;
    if (atteint(b.id, a.id)) { arcsRefuses++; continue; }
    suivants.get(a.id)!.add(b.id);
    arcs++;
  }
}
for (const r of regles) { const s = [...suivants.get(r.id)!]; if (s.length) r.supersedes = s; }

const maintenant = new Date();
const manifeste: OccupationManifest = {
  ...servie,
  id: `catwalks-occupations-${maintenant.toISOString().slice(0, 10).replace(/-/g, '')}-v3`,
  review: { author: 'Passe de curation v3 (IA seule, D-475 §30)', at: maintenant.toISOString(),
    basis: `Première passe de curation : ${concepts.length} métiers (servis, backend, offres), ${famillesV3.length} familles, 25 langues ; preuves : audits/2026-09-28/curation-v3.` },
  families: famillesV3, occupations: metiersV3, rules: regles as OccupationManifest['rules'],
};
const compile = compileOccupationManifest(manifeste);
validateOccupationSuccessor(servie, manifeste);

writeFileSync(`${DOSSIER_SORTIE}6-manifeste-v3.json`, JSON.stringify(manifeste, null, 1));
writeFileSync(`${DOSSIER_SORTIE}6-correspondances.json`, JSON.stringify({ calculeLe: maintenant.toISOString(), manifeste: manifeste.id,
  metiers: Object.fromEntries(cleMetier), familles: Object.fromEntries(cleFamille), arbitrages }, null, 1));
const bilan = { id: manifeste.id, groupes: manifeste.groups.length, familles: famillesV3.length, metiers: metiersV3.length, regles: manifeste.rules.length,
  expressions: [...expressions.values()].reduce((n, s) => n + s.size, 0), arbitrages: arbitrages.length,
  retirees: arbitrages.filter((a) => !a.garde).length, reglesExactes: exactes.size, preseances: arcs, preseancesRefuseesPourCycle: arcsRefuses, compile: compile.occupations.size, succession: 'conforme' };
console.log(JSON.stringify(bilan, null, 1));
