import { prisma, Prisma } from '@catwalks/db';
import { publicJobSql } from '@catwalks/db/availability';
import type { Perimetre } from '@catwalks/db/marches';
import { langueDesLibelles } from '@catwalks/db/presentation';
import { MOTS_DE_LIAISON, replierRequete } from '@catwalks/db/search-comprendre';
import { directPubliableSql } from './direct-offers';
import { echapperLike } from './like';
import { getOptionalOccupationPresentation } from './occupations';
import { localeAffichage } from './presentation-locale';
import { getSearchContext, requireSearchIndex, SEARCH_VERSION } from './search-index';
import { searchWords, validateSearchQuery, type SearchClause } from './search-intent';
import { languesDuMarche } from './search-langues';
import { metiersSansIndex, repartitionDuPerimetre } from './search-chemin';
import { searchSql } from './search-sql';
import { requeteRefusee, requetesPopulaires } from './requetes-tapees';
import type { MetierSuggere } from './suggestions';

/**
 * D-500 (Q2) — LES SUGGESTIONS D'INTITULÉS CANONIQUES, au seul client du contrat 2 (`x-catwalks-client: 2`).
 *
 * Mesuré en production le 01/10/2026 (`audits/2026-10-01/d500-requete/`) : 63 % des suggestions servies étaient des
 * intitulés bruts qui ne nommaient aucun métier (« CONSEILLER DE VENTE /NB », « Conseillère de vente expérimentée
 * Toulouse CDD ») ; les choisir rendait surtout les offres de cette formulation exacte. Comme chez Indeed, la liste
 * propose désormais, dans cet ordre (8 lignes au plus) :
 *  1. UNE LIGNE PAR MÉTIER (`nature: 'metier'`) dont le libellé du marché, ou une de ses variantes gardées pour le marché
 *     (D-488), a un mot qui commence par la frappe ; dans la forme tapée (« Conseillère de vente » pour « conseillère »),
 *     sinon le libellé du marché. Une variante sans langue n'est proposée que si un intitulé d'offre du marché qui contient la
 *     frappe l'écrit (« Conseillère de vente » n'est plus proposée à Londres). Rangées par le nombre d'offres que rend leur
 *     choix (`metier=`, le prédicat de `job-search-query.ts`), jamais à zéro ;
 *  2. DES INTITULÉS NETTOYÉS (`nature: 'intitule'`), qui apportent autre chose qu'un métier (« Vendeur polyvalent ») :
 *     l'intitulé sans contrat, durée, marque de genre, crochets, ville du marché ni niveau, en minuscules sauf la
 *     première lettre et les sigles, porté par au moins 3 offres ; un intitulé qui nomme exactement un métier rejoint sa
 *     ligne ;
 *  3. LES REQUÊTES POPULAIRES (`nature: 'populaire'`, D-501) au-delà du seuil, dont chaque mot est écrit dans l'intitulé
 *     d'une offre du marché.
 * Toute ligne est vérifiée par la recherche que lance son choix : `metier=` pour un métier, le texte compris (Q1) pour
 * les autres. Le titre natif d'une offre n'est jamais réécrit : un intitulé nettoyé est une copie servie ici.
 */
const LIMITE = 8;
/** Une expression d'offres n'est proposée que portée par au moins ce nombre d'offres du marché (cahier §3.1.3). */
export const OFFRES_MIN_EXPRESSION = 3;
const TTL_METIERS_MS = 10 * 60_000, TTL_VILLES_MS = 60 * 60_000;

export type NatureSuggestion = 'metier' | 'intitule' | 'populaire';
export type SuggestionCanonique = { valeur: string; metier: MetierSuggere | null; nature: NatureSuggestion };

const normal = (v: string) => searchWords(v).join(' ');
const sansLiaison = (e: string) => e.split(' ').filter((m) => !MOTS_DE_LIAISON.has(m)).join(' ');
/**
 * Un mot de l'expression (mots normalisés) commence par la frappe ; les mots de liaison peuvent manquer d'un côté. Une
 * frappe en deux mots trouve aussi leur forme soudée (« make up » trouve « Makeup artist ») ; jamais l'inverse, qui
 * découperait un mot tapé entier (« conseillere » ne trouve pas « Conseiller en image »).
 */
export function correspond(expression: string, frappe: string): boolean {
  const e = ` ${expression}`, f = ` ${frappe}`;
  if (e.includes(f) || ` ${sansLiaison(expression)}`.includes(` ${sansLiaison(frappe)}`)) return true;
  if (!frappe.includes(' ')) return false;
  const colle = frappe.replace(/ /g, '');
  const mots = expression.split(' ');
  return mots.some((_m, i) => mots.slice(i).join('').startsWith(colle));
}

// ── Mémos par instance ─────────────────────────────────────────────────────────────────────────────────────────────
type Memo<T> = Map<string, { valeur: Promise<T>; expire: number; enCours?: boolean }>;
/**
 * Un mémo qui sert sa valeur périmée pendant qu'il se relit (audit de réconciliation du 01/10/2026 : relire les offres
 * par métier du marché français coûte environ 1,7 s ; la frappe qui tombait sur l'expiration les payait). Seule la
 * première lecture d'une instance attend.
 */
function memoriser<T>(memo: Memo<T>, cle: string, ttl: number, calcul: () => Promise<T>): Promise<T> {
  const connu = memo.get(cle);
  if (connu && connu.expire > Date.now()) return connu.valeur;
  if (connu) {
    if (!connu.enCours) {
      connu.enCours = true;
      const relue = calcul();
      relue.then(() => memo.set(cle, { valeur: relue, expire: Date.now() + ttl }), () => { connu.enCours = false; });
    }
    return connu.valeur;
  }
  const valeur = calcul();
  memo.set(cle, { valeur, expire: Date.now() + ttl });
  valeur.catch(() => memo.delete(cle));
  return valeur;
}
const paysSql = (pays: readonly string[]) => Prisma.join(pays.map((p) => Prisma.sql`${p}`));

const metiersMemo: Memo<Map<string, number>> = new Map();
/**
 * Les offres publiables du périmètre par métier, exactement comme les compte `metier=` (code OU métier lu dans
 * l'intitulé, deux origines) : une ligne de métier est vérifiée par la recherche que lance son choix.
 */
export function offresParMetier(pays: readonly string[]): Promise<Map<string, number>> {
  return memoriser(metiersMemo, [...pays].sort().join(','), TTL_METIERS_MS, async () => {
    const asOf = new Date();
    const lignes = await prisma.$queryRaw<{ code: string; n: number }[]>(Prisma.sql`
      SELECT code, count(*)::int AS n FROM (
        SELECT DISTINCT j.id, code FROM "Job" j CROSS JOIN LATERAL unnest(array_append(j."titleRoles", j."occupationCode")) code
         WHERE ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${paysSql(pays)}) AND code IS NOT NULL
        UNION ALL
        SELECT DISTINCT 'cw_' || d.id, code FROM "DirectOffer" d CROSS JOIN LATERAL unnest(array_append(d."titleRoles", d."occupationCode")) code
         WHERE ${directPubliableSql(Prisma.sql`d`, asOf)} AND d."countryCode" IN (${paysSql(pays)}) AND code IS NOT NULL
      ) t GROUP BY code`);
    return new Map(lignes.map((l) => [l.code, l.n]));
  });
}

const villesMemo: Memo<Set<string>> = new Map();
/** Les villes du marché (au moins 3 offres), normalisées : une suggestion n'en porte pas (cahier §3.1.3). */
function villesDuMarche(pays: readonly string[]): Promise<Set<string>> {
  return memoriser(villesMemo, [...pays].sort().join(','), TTL_VILLES_MS, async () => {
    const lignes = await prisma.$queryRaw<{ v: string }[]>(Prisma.sql`SELECT lower(trim(j.city)) AS v FROM "Job" j
      WHERE ${publicJobSql(Prisma.sql`j`, new Date())} AND j."countryCode" IN (${paysSql(pays)}) AND length(trim(j.city)) >= 3
      GROUP BY 1 HAVING count(*) >= 3`);
    return new Set(lignes.map((l) => normal(l.v)).filter((v) => v.length >= 3));
  });
}

// ── 1. Les lignes de métier ────────────────────────────────────────────────────────────────────────────────────────
type Forme = { texte: string; e: string; libelleDuMarche: boolean };
type Modele = Awaited<ReturnType<typeof getSearchContext>>['model'];
const accentue = (v: string) => /[^\p{ASCII}]/u.test(v);
/** Une variante s'affiche avec ses majuscules d'origine, sauf une casse de titre (« Make-up Artist » → « Make-up artist »). */
/** Des sigles courants des intitulés, gardés en capitales même dans un intitulé tout en capitales (« CRM MANAGER »). */
const SIGLES = new Set(['CRM', 'RH', 'HR', 'IT', 'VM', 'B2B', 'B2C', 'SAV', 'KAM', 'CEO', 'CFO', 'COO', 'CTO', 'CMO', 'DRH', 'DAF', 'PR', 'RP',
  'UX', 'UI', 'SEO', 'SEA', 'QA', 'QHSE', 'HSE', 'R&D', 'L&D', 'ADV', 'BI', 'ERP', 'SAP', 'PLM', '3D', '2D', 'CDP', 'PMO', 'TV', 'DJ',
  'PAP', 'VIP', 'VIC', 'RTW', 'PLV', 'LVMH']);
/** Dans un intitulé en casse mêlée, un mot en capitales de 2 ou 3 lettres est un sigle (« Vendeur PAP ») ; de 4, seulement
 * s'il est connu ou sans voyelle (« LVMH », mais « Vendeur LUXE » → « Vendeur luxe ») : audit 2. */
const sigleEnCasseMelee = (m: string) => /^[\p{Lu}\d&]{2,4}$/u.test(m) && (m.length <= 3 || !/[AEIOUYÀÂÄÉÈÊËÎÏÔÖÙÛÜ]/u.test(m));
export function casse(texte: string): string {
  const mots = texte.split(/(\s+)/);
  const toutEnCapitales = !/\p{Ll}/u.test(texte);
  let premier = true;
  return mots.map((m) => {
    if (/^\s+$/.test(m)) return m;
    const sigle = (sigleEnCasseMelee(m) && !toutEnCapitales) || SIGLES.has(m.toUpperCase().replace(/[^\p{L}\d&]/gu, '')) && /^[\p{Lu}\d&]+$/u.test(m);
    let r = sigle ? m : m.toLocaleLowerCase('fr');
    if (premier && !sigle) r = r.charAt(0).toLocaleUpperCase('fr') + r.slice(1);
    premier = false;
    return r;
  }).join('');
}

/**
 * Les formes d'un métier pour un marché : ses libellés dans les langues du marché et ses variantes gardées pour le
 * marché (D-488, `search-langues.ts`). Pures et mémorisées par version du modèle et marché.
 */
const formesMemo = new WeakMap<object, Map<string, Map<string, Forme[]>>>();
function formesDesMetiers(model: Modele, perimetre: Perimetre): Map<string, Forme[]> {
  const parModele = formesMemo.get(model) ?? new Map<string, Map<string, Forme[]>>();
  formesMemo.set(model, parModele);
  const cle = perimetre.marche ? languesDuMarche(perimetre.marche).join(',') : '*';
  const connues = parModele.get(cle);
  if (connues) return connues;
  const langues = new Set(perimetre.marche ? languesDuMarche(perimetre.marche) : []);
  const resultat = new Map<string, Forme[]>();
  for (const o of model.manifest.occupations) {
    const concept = model.concepts.find((c) => c.kind === 'role' && c.key === o.key);
    if (!concept) continue;
    const clause: SearchClause = { kind: 'role', keys: [o.key], phrases: [...new Set(concept.aliases.map(normal))], observed: '', corrected: false, exclude: false };
    const gardees = new Set(model.langues.restreindre({ version: 1, original: '', clauses: [clause] }, perimetre.marche).clauses[0].phrases);
    const duMarche = new Set(Object.entries(o.labels ?? {}).filter(([etiquette]) => !perimetre.marche || langues.has(etiquette.split('-')[0].toLowerCase()))
      .map(([, v]) => normal(v)));
    const parE = new Map<string, Forme>();
    for (const a of concept.aliases) {
      const e = normal(a);
      if (!e || !gardees.has(e)) continue;
      const deja = parE.get(e);
      // Entre deux écritures d'une même expression, celle qui porte ses accents (« Conseillère » plutôt que « Conseillere »).
      if (!deja || (!accentue(deja.texte) && accentue(a))) parE.set(e, { texte: a.trim(), e, libelleDuMarche: duMarche.has(e) });
    }
    resultat.set(o.key, [...parE.values()]);
  }
  parModele.set(cle, resultat);
  return resultat;
}

/**
 * Parmi ces expressions (mots normalisés), celles qu'écrit un des intitulés d'offres du marché que la frappe a ramenés
 * (`lireIntitules` : les 40 plus portés qui contiennent la frappe). Aucune requête de plus : une variante qui contient la
 * frappe mais qu'aucun de ces intitulés n'écrit n'est pas proposée (le libellé du marché, lui, l'est toujours).
 */
function ecritesDansLesIntitules(expressions: readonly string[], intitules: readonly string[]): Set<string> {
  return new Set(expressions.filter((e) => intitules.some((t) => ` ${t} `.includes(` ${e} `))));
}

async function lignesDeMetier(model: Modele, perimetre: Perimetre, frappe: string, libelle: (k: string) => string | null,
  intitules: readonly string[]): Promise<SuggestionCanonique[]> {
  const comptes = await offresParMetier(perimetre.pays);
  const candidats: { cle: string; formes: Forme[]; n: number; libelle: string }[] = [];
  for (const [cle, formes] of formesDesMetiers(model, perimetre)) {
    const n = comptes.get(cle) ?? 0;
    const nom = libelle(cle);
    if (!n || !nom) continue;
    const trouvees = formes.filter((f) => correspond(f.e, frappe));
    if (trouvees.length || correspond(normal(nom), frappe)) candidats.push({ cle, formes: trouvees, n, libelle: nom });
  }
  candidats.sort((a, b) => b.n - a.n || a.libelle.localeCompare(b.libelle));
  // Pour chaque métier, la forme affichée : le libellé de l'écran s'il répond à la frappe ; sinon un libellé d'une langue
  // du marché qui y répond (« Sales advisor » pour « sales ad » en France) ; sinon la forme tapée (« Conseillère de
  // vente » pour « conseillère »), à condition qu'une offre du marché l'écrive. Entre deux formes : celle qui commence par
  // la frappe, du même nombre de mots que le libellé, accentuée, la plus courte.
  const choix = candidats.slice(0, LIMITE).map((c) => {
    if (correspond(normal(c.libelle), frappe)) return { c, formes: [] as Forme[], libelleRepond: true };
    const nbMots = normal(c.libelle).split(' ').length;
    const ordonnees = [...c.formes].sort((a, b) =>
      Number(` ${b.e}`.startsWith(` ${frappe}`)) - Number(` ${a.e}`.startsWith(` ${frappe}`))
      || Number(b.e.split(' ').length === nbMots) - Number(a.e.split(' ').length === nbMots)
      || Number(accentue(b.texte)) - Number(accentue(a.texte))
      || a.texte.length - b.texte.length || a.texte.localeCompare(b.texte));
    const libelle = ordonnees.find((f) => f.libelleDuMarche);
    return { c, formes: libelle ? [libelle] : ordonnees.slice(0, 3), libelleRepond: false };
  });
  // Une variante (pas un libellé d'une langue du marché) n'est proposée que si une offre du marché l'écrit.
  const aVerifier = choix.flatMap((x) => x.formes.filter((f) => !f.libelleDuMarche).map((f) => f.e));
  const ecrites = ecritesDansLesIntitules(aVerifier, intitules);
  const lignes: SuggestionCanonique[] = [];
  const textes = new Set<string>();
  // Deux métiers peuvent partager une variante (« Brand manager ») : une seule ligne par texte, celle du métier le plus porté.
  const pousser = (valeur: string, metier: MetierSuggere) => {
    if (textes.has(normal(valeur))) return;
    textes.add(normal(valeur));
    lignes.push({ valeur, metier, nature: 'metier' });
  };
  for (const { c, formes, libelleRepond } of choix) {
    const metier = { identifiant: c.cle, libelle: c.libelle };
    if (libelleRepond) { pousser(c.libelle, metier); continue; }
    const f = formes.find((x) => x.libelleDuMarche || ecrites.has(x.e));
    if (f) pousser(casse(f.texte), metier);
  }
  return lignes;
}

// ── 2. Les intitulés nettoyés ──────────────────────────────────────────────────────────────────────────────────────
const CONTRATS = new Set(['cdi', 'cdd', 'stage', 'stagiaire', 'alternance', 'alternant', 'alternante', 'apprentissage', 'apprenti', 'apprentie',
  'interim', 'freelance', 'ftc', 'permanent', 'temporaire', 'temporary', 'saisonnier', 'saisonniere', 'etudiant', 'etudiante', 'extra', 'extras',
  'renfort', 'soldes', 'noel', 'ete', 'weekend', 'samedi', 'dimanche', 'h', 'hrs', 'hours', 'heures', 'month', 'months', 'mois', 'm', 'w', 'f',
  'x', 'nb',
  // Les saisons et contrats des autres langues des marchés (audit 2 : « Christmas sales advisor » était servi).
  'christmas', 'xmas', 'seasonal', 'holiday', 'holidays', 'summer', 'saturday', 'sunday', 'casual', 'graduate', 'intern', 'internship',
  'apprentice', 'apprenticeship', 'werkstudent', 'werkstudentin', 'praktikant', 'praktikantin', 'praktikum', 'aushilfe', 'minijob', 'befristet',
  'stagista', 'tirocinio', 'tirocinante', 'becario', 'becaria', 'practicas', 'temporal']);
const CONTRATS_EN_DEUX_MOTS = ['temps partiel', 'temps plein', 'mi temps', 'part time', 'full time', 'fixed term', 'tiempo parcial', 'teilzeit', 'vollzeit',
  'week end', 'jeune diplome', 'jeune diplomee'];
const NIVEAUX = new Set(['junior', 'jr', 'senior', 'sr', 'confirme', 'confirmee', 'experimente', 'experimentee', 'experimentes', 'experienced', 'debutant',
  'debutante', 'midweight']);
/** Le mot qui introduit un lieu part avec lui (« Val » de « Val Thoiry », « Saint » d'un lieu que la base n'écrit pas). */
const INTRODUIT_UN_LIEU = new Set(['val', 'port', 'mont', 'saint', 'st', 'ste', 'sainte', 'centre', 'center', 'a', 'au', 'in', 'at']);
/** Un intitulé ne finit pas sur un mot de liaison ou une préposition que le nettoyage a laissés seuls (« … en » de « en CDD »). */
const FINS_ORPHELINES = new Set(['en', 'de', 'du', 'des', 'd', 'a', 'au', 'aux', 'pour', 'avec', 'chez', 'sur', 'et', 'ou', 'in', 'at', 'for', 'with',
  'and', 'or', 'of', 'the', 'la', 'le', 'les', 'l', 'y', 'e', 'por', 'para', 'con', 'per', 'di', 'da', 'im', 'bei', 'fur', 'und']);

/**
 * L'intitulé d'une offre réduit à une expression qu'on tape (cahier §3.1.3), ou `null`. Le titre natif n'est pas touché :
 * le résultat est une copie servie à l'autocomplétion.
 */
export function nettoyerIntitule(titre: string, villes: ReadonlySet<string>): string | null {
  let t = replierRequete(titre.normalize('NFC').replace(/\[[^\]]*\]/g, ' ').replace(/[«»"“”]/g, ' '));
  t = t.replace(/^[\s\-–—_.*•·#]+/, '')
    .replace(/^(?:CDI|CDD|STAGE|ALTERNANCE|INTERIM|INTÉRIM|VIE|FREELANCE|\d[\d-]*)\s*[-–:]\s*/i, '')
    .split(/\s[-–—|/]\s|\s*\|\s*|\s\/\/\s|\s–|–\s/)[0]
    .replace(/\([^)]*\)?|\)/g, ' ');
  // « Directrice, Directeur de magasin » : la seconde partie d'une virgule qui ne fait que répéter le mot au genre opposé.
  const parties = t.split(',').map((p) => p.trim()).filter(Boolean);
  if (parties.length > 1 && parties[0].split(/\s+/).length === 1) {
    const a = normal(parties[0]), b = normal(parties[1]).split(' ')[0] ?? '';
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    t = i >= 4 ? parties[1] : parties[0];
  } else t = parties[0] ?? '';
  // Mot à mot : contrats, durées, niveaux, nombres ; et tout ce qui suit le premier lieu du marché (« Vendeur Val Thoiry »,
  // « Sales Advisor Saint Tropez ») : le lieu vient après le métier, et le mot qui l'introduit part avec lui.
  let jetons = t.split(/\s+/).filter(Boolean);
  let n = jetons.map((j) => normal(j));
  for (let i = 1; i < jetons.length; i++) {
    const lieu = [4, 3, 2, 1].find((longueur) => i + longueur <= jetons.length && villes.has(n.slice(i, i + longueur).join(' ')));
    if (!lieu) continue;
    const debut = i - 1 >= 1 && INTRODUIT_UN_LIEU.has(n[i - 1]) ? i - 1 : i;
    jetons = jetons.slice(0, debut);
    n = n.slice(0, debut);
    break;
  }
  const garde = jetons.map(() => true);
  for (let i = 0; i < jetons.length; i++) {
    if (i + 1 < jetons.length && CONTRATS_EN_DEUX_MOTS.includes(`${n[i]} ${n[i + 1]}`)) { garde[i] = false; garde[i + 1] = false; }
    if (CONTRATS_EN_DEUX_MOTS.includes(n[i])) garde[i] = false;
    const mot = n[i];
    if (CONTRATS.has(mot) || NIVEAUX.has(mot) || /^\d/.test(mot) || /^\d+(?:[.,]\d+)?h$/.test(mot)) garde[i] = false;
    // Le volontariat international en entreprise s'écrit « VIE » ; « cycle de vie », « assurance Vie » restent (audit 2).
    if (/^V\.?I\.?E\.?$/.test(jetons[i]) && !['de', 'du', 'la', 'en'].includes(n[i - 1] ?? '')) garde[i] = false;
  }
  const restants = jetons.filter((_, i) => garde[i]);
  // Les mots orphelins de fin (« en », « de ») et un dernier mot d'une ou deux lettres, que le nettoyage a laissés.
  // Un sigle en capitales (« RH », « IT », « 3D ») n'est pas orphelin (audit technique du 01/10/2026).
  const orphelin = (j: string) => FINS_ORPHELINES.has(normal(j)) || (normal(j).length <= 2 && !/^[\p{Lu}\d&]{2,4}$/u.test(j));
  while (restants.length > 1 && orphelin(restants.at(-1)!)) restants.pop();
  const reste = restants.join(' ')
    .replace(/\s+/g, ' ').replace(/^[\s\-–—,.:;/|*•·_&+]+|[\s\-–—,.:;/|*•·_&+]+$/g, '').trim();
  if (normal(reste).length < 2) return null;
  return casse(reste);
}

/** La clé d'un intitulé, au masculin (« Conseillère esthéticienne polyvalente » et sa forme masculine ne font qu'une ligne). */
const MASCULINS: [RegExp, string][] = [[/trice$/, 'teur'], [/ienne$/, 'ien'], [/enne$/, 'en'], [/iere$/, 'ier'], [/ere$/, 'er'], [/euse$/, 'eur'], [/esse$/, 'e'],
  [/ive$/, 'if'], [/ante$/, 'ant'], [/ente$/, 'ent'], [/ointe$/, 'oint'], [/elle$/, 'el'], [/ee$/, 'e']];
export const cleAuMasculin = (e: string) => e.split(' ').map((m) => {
  if (m.length < 6) return m;
  const r = MASCULINS.find(([re]) => re.test(m));
  return r ? m.replace(r[0], r[1]) : m;
}).join(' ');

/**
 * Les accents d'un intitulé écrit en capitales (« CONSEILLERE ESTHETICIENNE » → « Conseillère esthéticienne »), rendus
 * par le vocabulaire des métiers : un mot n'est accentué que si le vocabulaire ne l'écrit qu'avec cet accent-là.
 */
const accentsMemo = new WeakMap<object, Map<string, string>>();
function accents(model: Modele): Map<string, string> {
  const connu = accentsMemo.get(model);
  if (connu) return connu;
  const formes = new Map<string, Set<string>>();
  for (const c of model.concepts) for (const a of c.aliases) for (const mot of a.toLocaleLowerCase('fr').match(/[\p{L}]+/gu) ?? []) {
    if (!/^\p{Script=Latin}+$/u.test(mot)) continue;
    const cle = normal(mot);
    formes.set(cle, new Set([...(formes.get(cle) ?? []), mot]));
  }
  // Un mot n'est accentué que si le vocabulaire ne connaît qu'UNE écriture accentuée de lui (« conseillere » →
  // « conseillère », même si une variante l'écrit aussi sans accent) ; deux écritures accentuées différentes : rien.
  const carte = new Map<string, string>();
  for (const [cle, f] of formes) {
    const accentuees = [...f].filter((x) => x !== cle);
    if (accentuees.length === 1) carte.set(cle, accentuees[0]);
  }
  accentsMemo.set(model, carte);
  return carte;
}
function accentuer(model: Modele, texte: string): string {
  const carte = accents(model);
  return texte.replace(/[\p{L}]+/gu, (mot) => {
    if (accentue(mot)) return mot;
    const a = carte.get(mot.toLowerCase());
    return a ? (mot[0] === mot[0].toUpperCase() ? a.charAt(0).toUpperCase() + a.slice(1) : a) : mot;
  });
}

type Intitule = { valeur: string | null; n: number; ids: string[]; maisons: string[] };
/** Les 40 intitulés d'offres du marché qui contiennent la frappe, les plus portés d'abord, avec quelques-unes de leurs offres. */
async function lireIntitules(perimetre: Perimetre, q: string): Promise<Intitule[]> {
  const motif = `%${echapperLike(q)}%`;
  const asOf = new Date();
  const pays = paysSql(perimetre.pays);
  return prisma.$queryRaw<Intitule[]>`
    SELECT valeur, sum(n)::int AS n, (array_agg(id ORDER BY id))[1:3] AS ids,
      array_agg(array_to_string(maisons, ',')) AS maisons FROM (
      SELECT j.title AS valeur, count(*) AS n, min(j.id) AS id, (array_agg(DISTINCT j."companyId"))[1:3]::text[] AS maisons FROM "Job" j
       WHERE ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays}) AND catwalks_normaliser_texte(j.title) LIKE catwalks_normaliser_texte(${motif}) GROUP BY j.title
      UNION ALL
      SELECT d.title, count(*), 'cw_' || min(d.id), (array_agg(DISTINCT coalesce(d."companyId", d.company)))[1:3]::text[] FROM "DirectOffer" d
       WHERE ${directPubliableSql(Prisma.sql`d`, asOf)} AND d."countryCode" IN (${pays}) AND catwalks_normaliser_texte(d.title) LIKE catwalks_normaliser_texte(${motif}) GROUP BY d.title
    ) t GROUP BY valeur ORDER BY n DESC, valeur ASC LIMIT 40`;
}

/** Une expression d'offres n'est proposée que portée par au moins ce nombre de Maisons (audit métier : une ligne d'un seul
 * employeur, « Conseiller vente expert huiles essentielles », est son intitulé maison, pas une recherche). */
export const MAISONS_MIN_EXPRESSION = 2;

function intitulesNettoyes(model: Modele, rows: readonly Intitule[], villes: ReadonlySet<string>, frappe: string): { valeur: string; e: string; n: number; ids: string[] }[] {
  const groupes = new Map<string, { valeur: string; e: string; n: number; meilleur: number; ids: string[]; maisons: Set<string> }>();
  for (const r of rows) {
    if (!r.valeur) continue;
    const nettoye = nettoyerIntitule(r.valeur, villes);
    if (!nettoye) continue;
    const valeur = remettreLesMaisons(model, accentuer(model, nettoye));
    const e = normal(valeur);
    // Jamais un critère de sexe, d'âge ou de religion, ni une négation (« Directeur de magasin femme ») : audit métier.
    if (!correspond(e, frappe) || requeteRefusee(e.split(' '))) continue;
    const cle = cleAuMasculin(e);
    const maisons = (r.maisons ?? []).flatMap((m) => (m ? m.split(',') : [])).filter(Boolean);
    const g = groupes.get(cle);
    if (!g) groupes.set(cle, { valeur, e, n: r.n, meilleur: r.n, ids: [...r.ids], maisons: new Set(maisons) });
    else {
      g.n += r.n;
      g.ids.push(...r.ids);
      for (const m of maisons) g.maisons.add(m);
      // La graphie de l'intitulé le plus porté ; à égalité, celle qui porte ses accents.
      if (r.n > g.meilleur || (r.n === g.meilleur && accentue(valeur) && !accentue(g.valeur))) { g.valeur = valeur; g.e = e; g.meilleur = r.n; }
    }
  }
  return [...groupes.values()].filter((g) => g.n >= OFFRES_MIN_EXPRESSION && g.maisons.size >= MAISONS_MIN_EXPRESSION)
    .sort((a, b) => b.n - a.n || a.e.localeCompare(b.e));
}

/** Les noms de Maisons retrouvent leur graphie (« dior » → « Dior », « louis vuitton » → « Louis Vuitton ») : audit métier. */
const maisonsMemo = new WeakMap<object, Map<string, string>>();
function remettreLesMaisons(model: Modele, texte: string): string {
  let carte = maisonsMemo.get(model);
  if (!carte) {
    carte = new Map();
    for (const c of model.names) for (const n of c.names) {
      const cle = normal(n);
      // Un nom trop court ou ambigu (« on », « next ») n'est pas réécrit.
      if (cle.length >= 3 && !carte.has(cle)) carte.set(cle, n.trim());
    }
    maisonsMemo.set(model, carte);
  }
  const jetons = texte.split(' ');
  const n = jetons.map(normal);
  const sortie: string[] = [];
  for (let i = 0; i < jetons.length;) {
    const longueur = [4, 3, 2, 1].find((l) => i + l <= jetons.length && carte!.has(n.slice(i, i + l).join(' ')));
    if (longueur) { sortie.push(carte.get(n.slice(i, i + longueur).join(' '))!); i += longueur; }
    else { sortie.push(jetons[i]); i += 1; }
  }
  return sortie.join(' ');
}

// ── La recherche que lance le choix d'une ligne de texte ───────────────────────────────────────────────────────────
/**
 * Les valeurs dont la recherche comprise (Q1, la même condition que `q=` au contrat 2) retient au moins une offre.
 *  - Un intitulé nettoyé : parmi les offres dont l'intitulé l'a produit (lecture par identifiant, quelques lignes) :
 *    son choix rend au moins cette offre-là.
 *  - Une requête populaire : dans tout le marché, et chacune de ses clauses doit être écrite dans l'intitulé d'une même
 *    offre (une suite de mots poussée au-delà du seuil sans qu'aucune offre ne la porte n'est pas proposée).
 */
async function verifiees(model: Modele, perimetre: Perimetre, candidats: readonly { valeur: string; ids?: readonly string[] }[]): Promise<Set<string>> {
  if (!candidats.length) return new Set();
  const asOf = new Date();
  const pays = paysSql(perimetre.pays);
  const repartition = candidats.some((c) => !c.ids) ? await repartitionDuPerimetre(perimetre.pays) : null;
  const requetes = candidats.map(({ valeur, ids }, position) => {
    const intention = model.intention(valeur, perimetre.marche, { comprendre: true });
    // Une clause exclue (« vendeuse sans … ») n'est jamais une suggestion : rien ne prouverait le mot exclu (audit technique).
    if (intention.clauses.some((c) => c.exclude)) return Prisma.sql`SELECT NULL::int AS position WHERE false`;
    if (ids) {
      const { condition } = searchSql(intention, { metiersSansIndex: true });
      return Prisma.sql`SELECT ${position}::int AS position WHERE EXISTS (SELECT 1 FROM "SearchDocument" s
        WHERE s.version = ${SEARCH_VERSION} AND s.id = ANY(${[...ids]}::text[]) AND ${condition})`;
    }
    const { condition } = searchSql(intention, { metiersSansIndex: !!repartition && metiersSansIndex(intention, repartition) });
    const lues = intention.clauses.filter((c) => !c.exclude && ['role', 'family', 'text'].includes(c.kind));
    const titre = lues.length
      ? Prisma.sql` AND s.vector @@ to_tsquery('simple', ${lues.map((c) => '(' + c.phrases.map((p) => '(' + p.split(' ').map((w) => `'${w}':A`).join(' <-> ') + ')').join(' | ') + ')').join(' & ')})`
      : Prisma.empty;
    return Prisma.sql`SELECT ${position}::int AS position WHERE EXISTS (
      SELECT 1 FROM "SearchDocument" s JOIN "Job" j ON j.id=s.id
      WHERE s.version=${SEARCH_VERSION} AND ${condition}${titre} AND ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays})
      UNION ALL SELECT 1 FROM "SearchDocument" s JOIN "DirectOffer" d ON s.id='cw_'||d.id
      WHERE s.version=${SEARCH_VERSION} AND ${condition}${titre} AND ${directPubliableSql(Prisma.sql`d`, asOf)} AND d."countryCode" IN (${pays}))`;
  });
  const trouvees = await prisma.$queryRaw<{ position: number }[]>(Prisma.sql`SELECT position FROM (${Prisma.join(requetes, ' UNION ALL ')}) v`);
  return new Set(trouvees.map((r) => candidats[r.position].valeur));
}

/** Les mots d'une expression, sans liaison, triés : « responsable boutique adjoint » et « responsable adjoint de boutique »
 * ont la même clé. */
const cleDesMots = (e: string) => sansLiaison(e).split(' ').filter(Boolean).sort().join(' ');
const motsDesMetiers = new WeakMap<object, Map<string, string | null>>();
/** Par modèle : la clé des mots de chaque expression de métier, et son métier (`null` si deux métiers la partagent). */
function metiersParMots(model: Modele): Map<string, string | null> {
  const connu = motsDesMetiers.get(model);
  if (connu) return connu;
  const carte = new Map<string, string | null>();
  for (const c of model.concepts) if (c.kind === 'role') for (const a of c.aliases) {
    const cle = cleDesMots(normal(a));
    if (!cle) continue;
    carte.set(cle, carte.has(cle) && carte.get(cle) !== c.key ? null : c.key);
  }
  motsDesMetiers.set(model, carte);
  return carte;
}

/** Le métier qu'une chaîne nomme exactement, lue comme la requête comprise (une clause, un métier, rien d'autre), ou
 * dont les mots sont ceux d'une expression de métier dans un autre ordre (« Responsable boutique adjoint » est l'adjoint). */
function metierNomme(model: Modele, valeur: string): string | null {
  const { clauses } = model.intention(valeur, undefined, { comprendre: true });
  const [c] = clauses;
  if (clauses.length === 1 && c.kind === 'role' && !c.exclude && c.keys.length === 1) return c.keys[0];
  return metiersParMots(model).get(cleDesMots(normal(replierRequete(valeur)))) ?? null;
}

/** Au plus ce nombre de requêtes populaires vérifiées par frappe (une recherche du marché chacune). */
const POPULAIRES_VERIFIEES = 3;

export async function suggestTitlesCanoniques(query: string, perimetre: Perimetre, locale?: string): Promise<SuggestionCanonique[]> {
  if (!process.env.DATABASE_URL) return [];
  validateSearchQuery(query);
  const q = query.trim();
  const frappe = normal(replierRequete(q));
  if (q.length < 2 || frappe.length < 2) return [];
  await requireSearchIndex();
  try {
    const { model } = await getSearchContext();
    const presentation = await getOptionalOccupationPresentation(langueDesLibelles(localeAffichage(locale, perimetre)));
    const libelle = (k: string) => presentation.occupationLabel(k);
    const [rows, villes, populaires] = await Promise.all([
      lireIntitules(perimetre, q),
      villesDuMarche(perimetre.pays),
      // Les requêtes populaires ne font jamais échouer les suggestions (table absente avant sa migration, panne) : sans elles.
      perimetre.marche ? requetesPopulaires(perimetre.code, frappe).catch(() => []) : Promise.resolve([]),
    ]);
    const intitules = rows.flatMap((r) => (r.valeur ? [normal(r.valeur)] : []));
    const lignes = await lignesDeMetier(model, perimetre, frappe, libelle, intitules);
    const vues = new Set(lignes.map((l) => cleAuMasculin(normal(l.valeur))));
    // Un intitulé ou une requête qui nomme un métier, ou les mots d'une de ses expressions dans un autre ordre, ne fait pas
    // une ligne de plus : la ligne du métier suffit (audit métier). Un candidat illisible (plus de 64 mots…) est écarté, seul,
    // et journalisé.
    const libres = (e: string, valeur: string) => {
      try {
        return !vues.has(cleAuMasculin(e)) && !metierNomme(model, valeur);
      } catch (error) {
        console.warn(JSON.stringify({ event: 'suggestions.candidat_ecarte', error: error instanceof Error ? error.name : 'unknown' }));
        return false;
      }
    };
    const reste = () => LIMITE - lignes.length;
    if (reste() > 0) {
      const proposes = intitulesNettoyes(model, rows, villes, frappe).filter((x) => libres(x.e, x.valeur)).slice(0, reste());
      const ok = await verifiees(model, perimetre, proposes);
      for (const x of proposes) if (ok.has(x.valeur) && reste() > 0 && !vues.has(cleAuMasculin(x.e))) {
        lignes.push({ valeur: x.valeur, metier: null, nature: 'intitule' });
        vues.add(cleAuMasculin(x.e));
      }
    }
    if (reste() > 0 && populaires.length) {
      // Une recherche populaire suit les règles d'un intitulé : sans contrat, niveau ni lieu (celle qui en porte n'est pas
      // proposée, elle n'est pas réécrite), en casse de phrase, noms de Maisons dans leur graphie (audit 2).
      const propres = populaires.flatMap((p) => {
        const net = nettoyerIntitule(p.libelle, villes);
        return net && normal(net) === normal(p.libelle) ? [{ ...p, valeur: remettreLesMaisons(model, accentuer(model, net)) }] : [];
      });
      const proposes = propres.filter((p) => libres(p.cle, p.valeur)).slice(0, Math.min(reste(), POPULAIRES_VERIFIEES));
      const ok = await verifiees(model, perimetre, proposes.map((p) => ({ valeur: p.valeur })));
      for (const p of proposes) if (ok.has(p.valeur) && reste() > 0 && !vues.has(cleAuMasculin(p.cle))) {
        lignes.push({ valeur: p.valeur, metier: null, nature: 'populaire' });
        vues.add(cleAuMasculin(p.cle));
      }
    }
    return lignes.slice(0, LIMITE);
  } catch (error) {
    // Une autocomplétion cassée ne casse jamais la barre, mais elle se voit dans les journaux.
    console.error(JSON.stringify({ event: 'suggestions.canoniques_echec', error: error instanceof Error ? error.name : 'unknown' }));
    return [];
  }
}
