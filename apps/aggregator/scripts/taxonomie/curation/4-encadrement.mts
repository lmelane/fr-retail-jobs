/**
 * PASSE DE CURATION v3, ÉTAPE 4 : L'ENCADREMENT (D-475 §32 a ; plan `docs/architecture/classification-metiers.md` §3.1).
 *
 * « Un poste d'encadrement est un autre métier : une alerte "Vendeur" ne reçoit pas "Responsable vendeur" ni "Team
 * Leader Client Advisor" » (§32 a). Aujourd'hui, des intitulés d'encadrement sont classés dans le métier qu'ils
 * encadrent, parce que la règle de ce métier n'exclut pas leur mot (« lead cashier » → caissier). Ici :
 *  1. candidats : les intitulés classés dans un métier dont le titre porte un mot d'encadrement ABSENT des libellés et
 *     variantes de ce métier (le mot de « community manager » appartient au métier), et les deux exemples du CEO ;
 *     la liste de mots n'est qu'un filtre : ce sont les modèles qui décident ;
 *  2. les deux modèles disent, chacun de son côté, si le poste ENCADRE une équipe de ce métier ; encadrement = accord
 *     des deux. Le poste rejoint alors un métier de la v3 (proposition de l'un ou l'autre, consensus des deux juges),
 *     ou un métier nouveau d'encadrement (regroupement, consensus, seuils de volume) ; sans métier, il garde sa famille ;
 *  3. les exclusions, décidées une fois par (métier, mot d'encadrement) : un mot dont tous les intitulés jugés sont
 *     d'encadrement est exclu des règles du métier ; un mot disputé est tranché une fois par les deux modèles, et
 *     exclu seulement sur leur accord (sinon le classement actuel reste). Jamais d'exclusion sur mesure (lieu,
 *     enseigne). TOUS les intitulés du corpus sont ensuite reclassés par le moteur réel (`compileOccupationManifest`)
 *     avant et après ; les intitulés dont le verdict isolé diffère de la décision de leur mot sont écrits au bilan.
 *
 * Classement sur le seul intitulé (l'export ne porte pas le service) : les règles de contexte restent comparées à
 * elles-mêmes, la preview de l'étape 6 repasse tout avec le service.
 * Entrées : l'export des intitulés, les étapes 1 à 3, la version servie. Sortie : `curation-v3/4-encadrement.json`.
 *
 *   node --env-file=<fichier .env portant GEMINI_API_KEY> --import tsx \
 *     apps/aggregator/scripts/taxonomie/curation/4-encadrement.mts
 */
import { writeFileSync } from 'node:fs';
import { compileOccupationManifest, normalizeOccupationTitle } from '../../../../../packages/db/occupation-engine.ts';
import { CACHE_VECTEURS, conceptsV3, contexte, DOSSIER_SORTIE, lireIntitulesOffres, MIN_EMPLOYEURS, MIN_OFFRES_METIER, servie } from './commun.mts';
import { consensus, cosinus, JUGES, MODELE_CHOIX, rapprocherDesExistants, regrouper, repondre, vecteurs } from './ia.mts';

/** Mots d'encadrement, toutes langues du corpus (filtre seulement). Forme normalisée du moteur : majuscules sans accents. */
const MOTS = ['RESPONSABLE', 'RESPONSABILE', 'MANAGER', 'MANAGERIN', 'GERENTE', 'LEITER', 'LEITERIN', 'DIRECTEUR', 'DIRECTRICE',
  'DIRECTOR', 'DIRECTORA', 'DIRETTORE', 'DIRETTRICE', 'HEAD', 'SUPERVISOR', 'SUPERVISEUR', 'SUPERVISEUSE', 'SUPERVISORA', 'LEAD',
  'LEADER', 'CHEF', 'CHEFFE', 'CAPO', 'ENCARGADO', 'ENCARGADA', 'JEFE', 'JEFA', 'COORDINATOR', 'COORDINATEUR', 'COORDINATRICE',
  'COORDINADOR', 'COORDINADORA', 'COORDINATORE', 'KEYHOLDER', 'KEY HOLDER', 'PREMIER VENDEUR', 'PREMIERE VENDEUSE', '店長', '主任', '经理', '主管', '매니저', '팀장'];
const EXEMPLES_CEO = ['Responsable vendeur H/F', 'Team Leader Client Advisor', 'Première vendeuse'];
/** Formes d'un même mot : exclure l'une exclut l'autre (« Première vendeuse » restait vendeuse, audit du 29/09/2026). */
const FORMES: Record<string, string[]> = { DIRECTEUR: ['DIRECTRICE'], SUPERVISEUR: ['SUPERVISEUSE'], COORDINATEUR: ['COORDINATRICE'],
  ENCARGADO: ['ENCARGADA'], JEFE: ['JEFA'], LEITER: ['LEITERIN'], CHEF: ['CHEFFE'], DIRETTORE: ['DIRETTRICE'], COORDINADOR: ['COORDINADORA'],
  DIRECTOR: ['DIRECTORA'], SUPERVISOR: ['SUPERVISORA'], 'PREMIER VENDEUR': ['PREMIERE VENDEUSE'], MANAGER: ['MANAGERIN'] };
for (const [a, bs] of Object.entries(FORMES)) for (const b of bs) FORMES[b] = [...(FORMES[b] ?? []), a];

const { intitules, sha256 } = lireIntitulesOffres();
const v1 = compileOccupationManifest(structuredClone(servie));
const concepts = conceptsV3({ avecOffres: true });
const parCle = new Map(concepts.map((c) => [c.cle, c]));
const normal = (v: string) => ` ${normalizeOccupationTitle(v).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
const motsDe = (titre: string) => {
  const t = normal(titre);
  return MOTS.filter((m) => (/[\p{Script=Han}\p{Script=Hangul}]/u.test(m) ? t.includes(m) : t.includes(` ${m} `)));
};

// 1. Candidats.
type Candidat = { intitule: string; code: string; offres: number; employeursIds: string[]; mots: string[]; contexte: string };
const candidats: Candidat[] = [];
for (const x of [...intitules, ...EXEMPLES_CEO.map((e) => ({ intitule: e, codes: {}, employeursIds: [], exemple: true }))]) {
  const code = v1.classify(x.intitule).occupationCode;
  if (!code) continue;
  const propres = new Set(motsDe([parCle.get(code)?.fr, parCle.get(code)?.en, ...(parCle.get(code)?.variantes ?? [])].join(' ')));
  const mots = motsDe(x.intitule).filter((m) => !propres.has(m));
  if (mots.length) candidats.push({ intitule: x.intitule, code, offres: (x.codes ?? {})[code] ?? 0, employeursIds: x.employeursIds ?? [], mots, contexte: contexte(x) });
}

// 2. Encadrement ou non, par les deux modèles, et le métier du poste d'encadrement.
const vec = await vecteurs([...concepts.map((c) => c.texte), ...candidats.map((c) => c.intitule)], CACHE_VECTEURS);
const proches = candidats.map((c) => concepts.map((q, k) => ({ k, s: cosinus(vec.get(c.intitule)!, vec.get(q.texte)!) }))
  .sort((a, b) => b.s - a.s).slice(0, 8).map((x) => x.k));
const CONSIGNE = `Tu construis la taxonomie des métiers de Catwalks (luxe, mode, beauté, retail, sièges des Maisons, 41 pays).
Chaque intitulé d'offre est aujourd'hui rangé dans le MÉTIER ACTUEL indiqué. Dis dans "encadrement" si le poste ENCADRE, supervise ou dirige une équipe de ce métier (il est alors un autre métier : « Responsable vendeur » ou « Team Leader Client Advisor » ne sont pas « Vendeur »), ou s'il est ce métier lui-même, quel que soit son niveau d'expérience.
Si c'est un poste d'encadrement, donne dans "concept" le numéro du MÉTIER CATWALKS proposé qui est EXACTEMENT ce poste, ou null, et dans "libelle_fr" et "libelle_en" le nom court de ce poste (sans H/F, contrat, marque, secteur ni lieu).`;
const SCHEMA = { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, encadrement: { type: 'BOOLEAN' }, concept: { type: 'INTEGER', nullable: true },
  libelle_fr: { type: 'STRING', nullable: true }, libelle_en: { type: 'STRING', nullable: true } }, required: ['i', 'encadrement', 'concept', 'libelle_fr', 'libelle_en'] };
const numeros = candidats.map((_, k) => k);
const rendu = (lot: number[]) => lot.map((k, j) => `[${j}] « ${candidats[k].intitule} »${candidats[k].contexte ? ` (${candidats[k].contexte})` : ''} — MÉTIER ACTUEL : ${parCle.get(candidats[k].code)?.fr ?? candidats[k].code}\n  MÉTIERS CATWALKS : ${proches[k].map((q, n) => `${n}: ${concepts[q].fr}`).join(' · ')}`).join('\n');
const traduire = (r: any, k: number) => r && { ...r, concept: r.concept === null || r.concept === undefined ? null : concepts[proches[k][r.concept]]?.cle ?? null };
const choix = (await repondre(MODELE_CHOIX, CONSIGNE, numeros, 20, rendu, SCHEMA)).map(traduire);
const second = (await repondre(JUGES.j2, CONSIGNE, numeros, 20, rendu, SCHEMA)).map(traduire);
const encadrement = numeros.map((k) => (!choix[k] || !second[k] ? null : choix[k].encadrement && second[k].encadrement));

type Proposee = { k: number; cle: string };
const proposees: Proposee[] = [...new Map<string, Proposee>(numeros.filter((k) => encadrement[k]).flatMap((k) => [choix[k], second[k]]
  .filter((r: any) => r.concept && r.concept !== candidats[k].code).map((r: any): [string, Proposee] => [`${k}|${r.concept}`, { k, cle: r.concept }]))).values()];
const verdicts = await consensus(proposees.map(({ k, cle }) => ({ intitule: candidats[k].intitule, contexte: candidats[k].contexte, metier: `${parCle.get(cle)!.fr} / ${parCle.get(cle)!.en}`, alias: parCle.get(cle)!.variantes })));
const cible = new Map<number, string>();
proposees.forEach(({ k, cle }, n) => { if (verdicts[n] === 'confirme' && (!cible.has(k) || cle === choix[k].concept)) cible.set(k, cle); });
const proposeesSansVerdict = proposees.filter((_, n) => verdicts[n] === 'indetermine').map(({ k, cle }) => `${candidats[k].intitule} → ${cle}`);

const aGrouper = numeros.filter((k) => encadrement[k] && !cible.has(k));
const groupes = await regrouper(aGrouper.map((k) => ({ intitule: candidats[k].intitule, fr: choix[k].libelle_fr, en: choix[k].libelle_en, contexte: candidats[k].contexte })));
const membres = new Map<string, number[]>();
// Un intitulé sans groupe ou sans verdict n'est pas une décision : l'étape échoue (audit du 29/09/2026 : il valait rejet).
const groupesSansVerdict = aGrouper.filter((_, n) => !groupes[n] || groupes[n]!.verdict === 'indetermine').map((k) => candidats[k].intitule);
aGrouper.forEach((k, n) => { const g = groupes[n]; if (g?.verdict === 'confirme') membres.set(g.cle, [...(membres.get(g.cle) ?? []), k]); });
// Garde d'unicité : un poste d'encadrement identique à un métier existant le rejoint.
const nomGroupe = (ks: number[]) => groupes[aGrouper.indexOf(ks[0])]!;
const rapprochements = await rapprocherDesExistants([...membres].map(([cle, ks]) => ({ cle, fr: nomGroupe(ks).fr, en: nomGroupe(ks).en,
  titres: ks.map((k) => candidats[k].intitule), exclure: [...new Set(ks.map((k) => candidats[k].code))] })), concepts, CACHE_VECTEURS);
const doublonsEvites: { groupe: string; existant: string }[] = [], groupesIndetermines: string[] = [];
for (const [cle, ks] of [...membres]) {
  const r = rapprochements.get(cle)!;
  if (r.existant) { for (const k of ks) cible.set(k, r.existant); doublonsEvites.push({ groupe: `${nomGroupe(ks).fr} / ${nomGroupe(ks).en}`, existant: r.existant }); }
  if (r.existant || r.indetermine) membres.delete(cle);
  if (r.indetermine) groupesIndetermines.push(cle);
}
const nouveauxMetiers: any[] = [], enAttente: any[] = [];
for (const [cle, ks] of membres) {
  const g = nomGroupe(ks);
  const offres = ks.reduce((n, k) => n + candidats[k].offres, 0);
  const employeurs = new Set(ks.flatMap((k) => candidats[k].employeursIds)).size;
  const metier = { cle, fr: g.fr, en: g.en, famille: parCle.get(candidats[ks[0]].code)?.famille ?? null, encadre: [...new Set(ks.map((k) => candidats[k].code))],
    offres, employeurs, titres: ks.map((k) => candidats[k].intitule) };
  if (offres >= MIN_OFFRES_METIER && employeurs >= MIN_EMPLOYEURS) { nouveauxMetiers.push(metier); for (const k of ks) cible.set(k, `encadrement:${cle}`); }
  else enAttente.push(metier);
}

// 3. Exclusions, décidées UNE fois par (métier, mot) puis éprouvées par le moteur réel sur tout le corpus. Juger chaque
// intitulé isolément donnait des verdicts contraires pour le même rôle (« premier vendeur h/f » oui, « premier vendeur
// f/h (cdi 35h) » non, passe du 29/09/2026) et poussait à des exclusions sur mesure (« KEYHOLDER HOLT RENFREW »).
const encadrants = numeros.filter((k) => encadrement[k]);
const nonEncadrants = new Set(numeros.filter((k) => encadrement[k] === false).map((k) => candidats[k].intitule));
const avecExclusions = (ajouts: Map<string, string[]>) => {
  const m = structuredClone(servie);
  for (const r of m.rules) {
    const mots = ajouts.get(r.occupation);
    if (mots?.length) r.exclude = [...(r.exclude ?? []), { any: mots, field: 'title' }];
  }
  return compileOccupationManifest(m);
};
const corpus = [...intitules.map((x) => x.intitule), ...EXEMPLES_CEO];
const avant = new Map(corpus.map((t) => [t, v1.classify(t).occupationCode]));
const deplaces = (moteur: ReturnType<typeof compileOccupationManifest>) =>
  corpus.filter((t) => avant.get(t) && moteur.classify(t).occupationCode !== avant.get(t));

type Unite = { code: string; mot: string; ks: number[] };
const unites = new Map<string, Unite>();
for (const k of numeros) for (const mot of candidats[k].mots) {
  const u = unites.get(`${candidats[k].code}|${mot}`) ?? { code: candidats[k].code, mot, ks: [] };
  u.ks.push(k);
  unites.set(`${candidats[k].code}|${mot}`, u);
}
const concernees = [...unites.values()].filter((u) => u.ks.some((k) => encadrement[k]));
const mixtes = concernees.filter((u) => u.ks.some((k) => encadrement[k] === false));
const CONSIGNE_MOT = `Tu construis la taxonomie des métiers de Catwalks (luxe, mode, beauté, retail, sièges des Maisons, 41 pays).
Chaque élément est un mot ou une expression relevé dans des intitulés d'offres rangés aujourd'hui dans le MÉTIER indiqué. Dis dans "encadrement" si, dans ces intitulés, ce mot désigne un poste qui ENCADRE, supervise ou dirige une équipe de ce métier (un autre métier : « Responsable vendeur » ou « Team Leader Client Advisor » ne sont pas « Vendeur »), ou le métier lui-même, quel que soit son niveau d'expérience. Une réponse vaut pour tous les intitulés qui portent ce mot dans ce métier.`;
const SCHEMA_MOT = { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, encadrement: { type: 'BOOLEAN' } }, required: ['i', 'encadrement'] };
const renduMot = (lot: Unite[]) => lot.map((u, j) => `[${j}] « ${u.mot.toLowerCase()} » — MÉTIER : ${parCle.get(u.code)?.fr ?? u.code} — intitulés : ${u.ks.slice(0, 6).map((k) => candidats[k].intitule).join(' · ')}`).join('\n');
const [m1, m2] = [await repondre(MODELE_CHOIX, CONSIGNE_MOT, mixtes, 20, renduMot, SCHEMA_MOT), await repondre(JUGES.j2, CONSIGNE_MOT, mixtes, 20, renduMot, SCHEMA_MOT)];
const motsSansAvis = mixtes.filter((_, n) => !m1[n] || !m2[n]).map((u) => `${u.code}|${u.mot}`);
// Mot unanime → exclu ; mot disputé → exclu seulement sur l'accord des deux modèles, sinon le classement actuel reste.
const decisions = [...concernees.filter((u) => !mixtes.includes(u)).map((u) => ({ ...u, exclu: true, par: 'unanime' })),
  ...mixtes.map((u, n) => ({ ...u, exclu: !!(m1[n]?.encadrement && m2[n]?.encadrement), par: 'mot' }))];
const ajouts = new Map<string, string[]>();
for (const d of decisions) if (d.exclu) ajouts.set(d.code, [...new Set([...(ajouts.get(d.code) ?? []), d.mot, ...(FORMES[d.mot] ?? [])])]);
const final = avecExclusions(ajouts);
// Transparence : les intitulés dont le verdict isolé diffère de la décision prise pour leur mot.
const deplacesNonEncadrants = deplaces(final).filter((t) => nonEncadrants.has(t));
const encadrantsNonDeplaces = encadrants.filter((k) => final.classify(candidats[k].intitule).occupationCode === candidats[k].code).map((k) => candidats[k].intitule);

const exemples = EXEMPLES_CEO.map((e) => ({ intitule: e, avant: v1.classify(e).occupationCode, apres: final.classify(e).occupationCode }));
const offresDe = (titres: string[]) => { const s = new Set(titres); return intitules.filter((x) => s.has(x.intitule)).reduce((n, x) => n + Object.values<number>(x.codes ?? {}).reduce((a, b) => a + b, 0), 0); };
const bilan = { export: { sha256 }, candidats: candidats.length, sansDecision: encadrement.filter((e) => e === null).length,
  encadrement: encadrants.length, pasEncadrement: nonEncadrants.size, offresEncadrement: offresDe(encadrants.map((k) => candidats[k].intitule)),
  versMetierV3: [...cible.values()].filter((c) => !c.startsWith('encadrement:')).length, versMetierNouveau: [...cible.values()].filter((c) => c.startsWith('encadrement:')).length,
  sansMetier: encadrants.filter((k) => !cible.has(k)).length, nouveauxMetiers: nouveauxMetiers.length, enAttente: enAttente.length, doublonsEvites, groupesIndetermines,
  motsDecides: decisions.map(({ ks, ...d }) => ({ ...d, intitules: ks.length })), motsSansAvis, exclusions: Object.fromEntries(ajouts),
  deplacesNonEncadrants, encadrantsNonDeplaces, exemplesCeo: exemples };
writeFileSync(`${DOSSIER_SORTIE}4-encadrement.json`, JSON.stringify({ calculeLe: new Date().toISOString(), modeles: { choix: MODELE_CHOIX, ...JUGES }, bilan,
  nouveauxMetiers, enAttente,
  intitules: numeros.map((k) => ({ ...candidats[k], employeursIds: undefined, encadrement: encadrement[k], cible: cible.get(k) ?? null,
    preuve: { choix: choix[k] ?? null, second: second[k] ?? null } })) }, null, 1));
console.log(JSON.stringify({ ...bilan, exclusions: undefined }, null, 1));
console.log('exclusions :', JSON.stringify(Object.fromEntries(ajouts)));
const echecs = [bilan.sansDecision && `${bilan.sansDecision} candidat(s) sans décision`,
  groupesIndetermines.length && `${groupesIndetermines.length} groupe(s) sans verdict d'unicité`,
  groupesSansVerdict.length && `${groupesSansVerdict.length} intitulé(s) sans groupe ou sans verdict de rattachement`,
  proposeesSansVerdict.length && `${proposeesSansVerdict.length} rattachement(s) proposé(s) sans verdict des juges`,
  motsSansAvis.length && `${motsSansAvis.length} mot(s) sans avis des deux modèles`,
  exemples.some((e) => e.apres === e.avant && e.avant) && 'un exemple du CEO reste dans le métier encadré'].filter(Boolean);
if (echecs.length) { console.error(`ÉTAPE INCOMPLÈTE : ${echecs.join(' ; ')}`); process.exitCode = 1; }
