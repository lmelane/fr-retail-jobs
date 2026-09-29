/**
 * PASSE DE CURATION v3, ÉTAPE 5 : LES LIBELLÉS DANS LES 25 LANGUES, LES VARIANTES ET LA GARDE D'UNICITÉ (D-475 §29,
 * §31 c ; plan `docs/architecture/classification-metiers.md` §3.1).
 *
 *  1. Libellés affichés : pour chaque métier et chaque famille, un modèle écrit dans les 25 langues du site la forme
 *     COURTE d'usage (« Conseiller de vente », D-475 §31 c) et ses seules formes grammaticales (féminin, épicène), à
 *     partir des libellés Catwalks et des libellés ESCO de la langue (17 langues du site ; matière, jamais recopiée telle
 *     quelle, D-475 §29) ; le second modèle relit, les langues qu'il signale sont réécrites une fois, puis relues.
 *  2. Variantes qui classent les offres : AUCUNE invention. Seulement ce qui est déjà validé : alias servis et du
 *     backend, libellés fusionnés (étapes 1, 1b), intitulés d'offres confirmés par les juges (étapes 3, 3b, 4), plus
 *     les libellés et formes de l'étape 1 ci-dessus. Un synonyme nouveau viendra de la table apprise, sous consensus
 *     (R-66 §2), jamais d'ici. Un mot vague seul (« Manager », « Stagiaire ») n'est jamais une variante (§32 c).
 *  3. Garde d'unicité, sans modèle : une forme normalisée (celle du moteur) qui désigne deux métiers reste au seul métier
 *     dont elle est le libellé ; sinon elle est retirée de tous (ambiguë). « Demand Planner » (deux métiers en v1) passe
 *     par là.
 *
 * Entrées : les étapes 1 à 4, la référence ESCO. Sortie : `curation-v3/5-libelles.json`. L'étape échoue si un libellé
 * manque ou reste signalé après sa réécriture.
 *
 *   node --env-file=<fichier .env portant GEMINI_API_KEY> --import tsx \
 *     apps/aggregator/scripts/taxonomie/curation/5-libelles.mts
 */
import { writeFileSync } from 'node:fs';
import { normalizeOccupationTitle } from '../../../../../packages/db/occupation-engine.ts';
import { CACHE_VECTEURS, conceptsV3, courte, DOSSIER_SORTIE, escoMetiers, familles, LANGUE_ESCO, LANGUES_SITE, lireEtape, texteEsco } from './commun.mts';
import { cosinus, JUGES, MODELE_CHOIX, repondre, vecteurs } from './ia.mts';

/** §32 c : un mot vague seul ne désigne pas un métier, donc ne classe aucune offre. */
const VAGUES = new Set(['MANAGER', 'ASSISTANT', 'ASSISTANTE', 'ASSOCIATE', 'TEAM MEMBER', 'STAGIAIRE', 'STAGE', 'INTERN', 'EMPLOYE', 'EMPLOYEE',
  'RESPONSABLE', 'DIRECTEUR', 'DIRECTRICE', 'DIRECTOR', 'CHARGE', 'CHARGEE', 'LEAD', 'SPECIALIST', 'SPECIALISTE', 'COORDINATOR', 'COORDINATEUR',
  'CONSULTANT', 'CONSULTANTE', 'TECHNICIEN', 'TECHNICIENNE', 'OPERATEUR', 'AGENT', 'CONSEILLER', 'CONSEILLERE', 'ADVISOR', 'SUPERVISOR']);
const norme = (v: string) => normalizeOccupationTitle(v).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const cleSchema = (l: string) => l.replace('-', '_');

const concepts = conceptsV3({ avecOffres: true, avecEncadrement: true });
const etape1 = lireEtape('1-correspondance-backend.json'), etape2 = lireEtape('2-familles.json'), etape3 = lireEtape('3-intitules-offres.json');
const etape3b = lireEtape('3b-garde-unicite.json'), etape4 = lireEtape('4-encadrement.json');
const escoParUri = new Map(escoMetiers.map((m: any) => [m.uri, m]));

// Matière ESCO : l'ancre choisie aux étapes 1 et 3 ; sinon le métier ESCO le plus proche (vecteurs), simple matière.
const ancreDe = new Map<string, string>();
for (const d of etape1.decisions) if (d.decision === 'nouveau' && d.ancreEsco) ancreDe.set(`backend:${d.slug}`, d.ancreEsco);
for (const m of etape3b.nouveauxMetiers) if (m.ancre) ancreDe.set(`offres:${m.cle}`, m.ancre);
const vec = await vecteurs([...concepts.map((c) => c.texte), ...escoMetiers.map(texteEsco)], CACHE_VECTEURS);
const matiere = new Map(concepts.map((c) => {
  if (ancreDe.has(c.cle)) return [c.cle, { uri: ancreDe.get(c.cle)!, ancre: true }];
  const v = vec.get(c.texte)!;
  let meilleur = escoMetiers[0], s = -Infinity;
  for (const m of escoMetiers) { const x = cosinus(v, vec.get(texteEsco(m))!); if (x > s) { s = x; meilleur = m; } }
  return [c.cle, { uri: meilleur.uri, ancre: false }];
}));
const libellesEsco = (uri: string) => {
  const m = escoParUri.get(uri) as any;
  return LANGUES_SITE.map((l) => [l, courte(m?.libelles?.[LANGUE_ESCO[l] ?? l])] as const).filter(([, v]) => v);
};

// 1. Libellés affichés, par un modèle, relus par l'autre.
const SCHEMA_LIBELLES = { type: 'OBJECT', required: ['i', ...LANGUES_SITE.map(cleSchema)], properties: { i: { type: 'INTEGER' },
  ...Object.fromEntries(LANGUES_SITE.map((l) => [cleSchema(l), { type: 'OBJECT', required: ['libelle', 'formes'],
    properties: { libelle: { type: 'STRING' }, formes: { type: 'ARRAY', items: { type: 'STRING' } } } }])) } };
const CONSIGNE_LIBELLES = (quoi: string) => `Tu nommes ${quoi} de Catwalks, la plateforme de recrutement du luxe, de la mode, de la beauté et du retail, dans les 25 langues de son site.
Pour chaque élément et chaque langue, donne :
- "libelle" : la forme COURTE d'usage dans les offres d'emploi de ce pays : un seul nom, sans barre ni parenthèse, sans H/F, sans secteur ni marque (« Conseiller de vente », pas « Conseiller / Conseillère de vente » ni « Conseiller de vente en boutique de luxe ») ; quand le pays emploie couramment le terme anglais, garde-le (« Keyholder », « Visual merchandiser ») ;
- "formes" : les autres formes grammaticales du MÊME nom seulement (féminin, épicène), jamais un synonyme ; liste vide s'il n'y en a pas.
Les libellés ESCO fournis sont une matière : ne les recopie pas s'ils sont longs ou administratifs.
Codes : pt = portugais du Portugal, pt_BR = portugais du Brésil, zh_CN = chinois simplifié, zh_Hant = chinois traditionnel, nb = norvégien bokmål, ms = malais.`;
type Element = { cle: string; fr: string; en: string; contexte: string };
const elementsMetiers: Element[] = concepts.map((c) => ({ cle: c.cle, fr: c.fr, en: c.en, contexte:
  `variantes connues : ${c.variantes.slice(0, 6).join(', ')} ; ESCO : ${libellesEsco(matiere.get(c.cle)!.uri).map(([l, v]) => `${l} « ${v} »`).join(' · ')}` }));
const toutesFamilles = [...familles.map((f) => ({ cle: f.key, fr: f.labels.fr, en: f.labels.en ?? f.labels.fr })),
  ...etape2.nouvellesFamilles.map((f: any) => ({ cle: f.key, fr: f.labels.fr, en: f.labels.en }))];
const elementsFamilles: Element[] = toutesFamilles.map((f) => ({ ...f, contexte: `métiers : ${concepts.filter((c) => c.famille === f.cle).slice(0, 6).map((c) => c.fr).join(', ')}` }));
const rendu = (lot: Element[]) => lot.map((e, j) => `[${j}] « ${e.fr} / ${e.en} » — ${e.contexte}`).join('\n');
const valide = (r: any) => LANGUES_SITE.every((l) => typeof r?.[cleSchema(l)]?.libelle === 'string' && r[cleSchema(l)].libelle.trim());

const SCHEMA_RELECTURE = { type: 'OBJECT', required: ['i', 'fautes'], properties: { i: { type: 'INTEGER' }, fautes: { type: 'ARRAY', items: {
  type: 'OBJECT', required: ['langue', 'raison'], properties: { langue: { type: 'STRING', enum: LANGUES_SITE.map(cleSchema) }, raison: { type: 'STRING' } } } } } };
const CONSIGNE_RELECTURE = `Tu relis les noms des métiers et familles de Catwalks (luxe, mode, beauté, retail) dans 25 langues. Pour chaque élément, liste dans "fautes" les langues dont le libellé n'est PAS la forme courte d'usage juste de ce métier dans ce pays (sens faux, forme longue ou administrative, barre ou parenthèse, secteur ou marque ajoutés, mauvaise langue ou mauvaise écriture), avec la raison. Liste vide si tout est juste.`;

async function nommer(elements: Element[], quoi: string) {
  const premiers = await repondre(MODELE_CHOIX, CONSIGNE_LIBELLES(quoi), elements, 8, rendu, SCHEMA_LIBELLES, valide);
  const avecLibelles = (libelles: any[]) => elements.map((e, k) => ({ ...e, contexte: `${e.contexte}\n  LIBELLÉS : ${LANGUES_SITE.map((l) => `${cleSchema(l)}: ${libelles[k]?.[cleSchema(l)]?.libelle ?? '?'}`).join(' · ')}` }));
  const relus = await repondre(JUGES.j2, CONSIGNE_RELECTURE, avecLibelles(premiers), 8, rendu, SCHEMA_RELECTURE, (r) => Array.isArray(r.fautes));
  // Réécriture unique des éléments signalés, avec la raison, puis nouvelle relecture de ceux-là seulement.
  const signales = elements.map((_, k) => k).filter((k) => relus[k]?.fautes?.length);
  const reecrits = await repondre(MODELE_CHOIX, `${CONSIGNE_LIBELLES(quoi)}\nCertaines langues ont été jugées fautives (raison donnée) : corrige-les.`,
    signales.map((k) => ({ ...elements[k], contexte: `${elements[k].contexte}\n  FAUTES : ${relus[k].fautes.map((f: any) => `${f.langue} (${premiers[k][f.langue].libelle}) : ${f.raison}`).join(' ; ')}` })),
    8, rendu, SCHEMA_LIBELLES, valide);
  const finaux = premiers.map((p, k) => {
    const n = signales.indexOf(k);
    if (n < 0 || !reecrits[n]) return p;
    return { ...p, ...Object.fromEntries(relus[k].fautes.map((f: any) => [f.langue, reecrits[n][f.langue]])) };
  });
  const relus2 = await repondre(JUGES.j2, CONSIGNE_RELECTURE, avecLibelles(finaux).filter((_, k) => signales.includes(k)), 8, rendu, SCHEMA_RELECTURE, (r) => Array.isArray(r.fautes));
  const restantes = signales.map((k, n) => ({ cle: elements[k].cle, fautes: relus2[n]?.fautes ?? null })).filter((x) => x.fautes === null || x.fautes.length);
  return { finaux, signales: signales.length, restantes, sansLibelle: elements.filter((_, k) => !valide(finaux[k])).map((e) => e.cle) };
}
const metiers = await nommer(elementsMetiers, 'les métiers');
const famillesNommees = await nommer(elementsFamilles, 'les familles de métiers');
const libellesDe = (r: any) => Object.fromEntries(LANGUES_SITE.map((l) => [l, r?.[cleSchema(l)]?.libelle?.trim() ?? null]));
const formesDe = (r: any) => Object.fromEntries(LANGUES_SITE.map((l) => [l, (r?.[cleSchema(l)]?.formes ?? []).map((x: string) => x.trim()).filter(Boolean)]));

// 2. Variantes validées, par métier.
const variantes = new Map<string, Set<string>>(concepts.map((c) => [c.cle, new Set([c.fr, c.en, ...c.variantes])]));
const ajouter = (cle: string | null, v: string) => { if (cle && variantes.has(cle)) variantes.get(cle)!.add(v); };
for (const t of etape3.intitules) if (t.decision === 'variante') ajouter(t.concept, t.intitule);
for (const v of etape3b.variantesAjoutees) ajouter(v.concept, v.intitule);
for (const t of etape4.intitules) if (t.cible) ajouter(t.cible, t.intitule);

// 3. Garde d'unicité : forme normalisée → métiers qui la portent, et à quel titre.
type Porteur = { cle: string; libelle: boolean };
const porteurs = new Map<string, Porteur[]>();
const porter = (forme: string, p: Porteur) => {
  const n = norme(forme);
  if (!n) return;
  const l = porteurs.get(n) ?? [];
  const deja = l.find((x) => x.cle === p.cle);
  if (deja) deja.libelle ||= p.libelle; else l.push(p);
  porteurs.set(n, l);
};
concepts.forEach((c, k) => {
  const r = metiers.finaux[k];
  for (const l of LANGUES_SITE) { const v = r?.[cleSchema(l)]; if (v?.libelle) porter(v.libelle, { cle: c.cle, libelle: true }); for (const f of v?.formes ?? []) porter(f, { cle: c.cle, libelle: true }); }
  for (const v of variantes.get(c.cle)!) porter(v, { cle: c.cle, libelle: false });
});
const conflits: { forme: string; metiers: string[]; gardeChez: string | null; libelleDe: string[] }[] = [];
const retenues = new Map<string, Set<string>>(concepts.map((c) => [c.cle, new Set<string>()]));
const generiquesRetires: string[] = [];
for (const [forme, l] of porteurs) {
  if (VAGUES.has(forme)) { generiquesRetires.push(forme); continue; }
  if (l.length === 1) { retenues.get(l[0].cle)!.add(forme); continue; }
  const libelles = l.filter((p) => p.libelle);
  const garde = libelles.length === 1 ? libelles[0].cle : null;
  conflits.push({ forme, metiers: l.map((p) => p.cle), gardeChez: garde, libelleDe: libelles.map((p) => p.cle) });
  if (garde) retenues.get(garde)!.add(forme);
}

const sortieMetiers = concepts.map((c, k) => ({ cle: c.cle, famille: c.famille, ancreEsco: matiere.get(c.cle)!.ancre ? matiere.get(c.cle)!.uri : null,
  matiereEsco: matiere.get(c.cle)!.ancre ? null : matiere.get(c.cle)!.uri, libelles: libellesDe(metiers.finaux[k]), formes: formesDe(metiers.finaux[k]),
  variantes: [...retenues.get(c.cle)!].sort() }));
const bilan = { metiers: concepts.length, familles: toutesFamilles.length, langues: LANGUES_SITE.length,
  libellesSignales: { metiers: metiers.signales, familles: famillesNommees.signales },
  libellesFautifsRestants: { metiers: metiers.restantes.length, familles: famillesNommees.restantes.length },
  sansLibelle: [...metiers.sansLibelle, ...famillesNommees.sansLibelle], variantes: sortieMetiers.reduce((n, m) => n + m.variantes.length, 0),
  conflits: conflits.length, conflitsRetires: conflits.filter((c) => !c.gardeChez).length, generiquesRetires: generiquesRetires.length,
  // Deux métiers affichés sous le même nom dans une langue : le candidat ne saurait pas lequel choisir.
  libellesEnDoublon: conflits.filter((c) => c.libelleDe.length > 1).map((c) => ({ forme: c.forme, metiers: c.libelleDe })) };
writeFileSync(`${DOSSIER_SORTIE}5-libelles.json`, JSON.stringify({ calculeLe: new Date().toISOString(), modeles: { redaction: MODELE_CHOIX, relecture: JUGES.j2 },
  bilan, familles: toutesFamilles.map((f, k) => ({ cle: f.cle, libelles: libellesDe(famillesNommees.finaux[k]) })), metiers: sortieMetiers,
  conflits, generiquesRetires, fautesRestantes: [...metiers.restantes, ...famillesNommees.restantes] }, null, 1));
console.log(JSON.stringify(bilan, null, 1));
const echecs = [bilan.sansLibelle.length && `${bilan.sansLibelle.length} élément(s) sans libellé`,
  (metiers.restantes.length + famillesNommees.restantes.length) && `${metiers.restantes.length + famillesNommees.restantes.length} élément(s) encore signalé(s) après réécriture`,
  bilan.libellesEnDoublon.length && `${bilan.libellesEnDoublon.length} libellé(s) portés par deux métiers`].filter(Boolean);
if (echecs.length) { console.error(`ÉTAPE INCOMPLÈTE : ${echecs.join(' ; ')}`); process.exitCode = 1; }
