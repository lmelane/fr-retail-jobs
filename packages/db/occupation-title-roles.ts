import { normalizeOccupationTitle, occupationMatchKey, type CompiledOccupationTaxonomy } from "./occupation-engine.ts";
import { OCCUPATION_SUPERVISORY_WORDS, occupationLevelOnly } from "./occupation-levels.ts";
import { createIntentResolver, searchWords } from "./search-intent.ts";
import { searchConcepts } from "./search-vocabulary.ts";

/**
 * Les métiers lus dans un intitulé (`titleRoles`, D-475 point 38 ; plan docs/architecture/classification-metiers.md
 * §3.1 et §3.3), qu'une recherche par métier lira (sous-lot 2B-4 : aujourd'hui, aucun lecteur) : les offres dont
 * l'intitulé contient un métier, sauf sous un mot d'encadrement. Ce sont :
 *  - les candidats retenus par le moteur (le métier d'un intitulé classé, ceux d'un intitulé ambigu), qui porte déjà les
 *    intitulés exacts validés, dont ceux faits seulement de mots de niveau (points 36, 37) ;
 *  - plus les métiers que le résolveur de la recherche, réduit aux métiers, lit dans un intitulé PLUS LONG, passé par la
 *    normalisation du moteur (écriture inclusive : « Animateur·rice des ventes »), la portée la plus longue l'emportant
 *    (« Responsable vendeur » ne laisse pas lire « vendeur »), et seulement :
 *      · pour une expression vérifiée sur ce qu'elle y capte (`titleReadingAliases`, étape de curation 6g) ; lue sans
 *        preuve, la lecture était fausse pour 18,5 % des offres selon l'assistant, 16,5 % selon le juge (mesure 6f,
 *        tour 1 : « Commercial Controller » → commercial, « Extra salle » → figurant) ;
 *      · hors d'un mot d'encadrement du même segment de l'intitulé (liste partagée avec l'étape 4 ; les segments sont
 *        séparés par « / », « | », « , », « - » entre espaces ou une parenthèse qui n'est pas une marque de genre ou
 *        de contrat : « Sales Supervisor (Keyholder) » lit Keyholder, « Trainer Manager » ne lit pas Formateur) ;
 *      · hors des formes qui désignent un autre métier ou aucun (`titleReadingExclusions` : frontières servies comme
 *        « adjoint » ou « deputy » pour le Responsable de boutique, §37 b ; décisions v3, §32 a, §35, §37), sauf
 *        « formation » et « training » : « Conseiller(ère) de Vente – Poste avec formation avant embauche », l'exemple
 *        de la décision, se lit ;
 *  - rien de plus quand le moteur a classé l'intitulé par une règle EXACTE : l'intitulé entier est une expression jugée
 *    de son métier (« Assisterande butikschef » reste l'adjoint, « Sales Lead with Keys » reste le Floor manager).
 * Un lecteur par version du catalogue, construit une fois.
 */
export type TitleDecision = {
  occupationCode: string | null;
  occupationStatus: string;
  occupationEvidence: { candidates: readonly string[]; matchedRules: readonly string[] };
};
type Lecteur = {
  resolveur: ReturnType<typeof createIntentResolver>;
  /** [[D-500]] Q5, lecture 2 : les mots des expressions de métier (singulier d'un pluriel) ; vide en lecture 1. */
  lexique: Set<string>;
  lecture: 1 | 2;
  /** Par métier, les expressions vérifiées pour un intitulé plus long (mots de la recherche). */
  verifiees: Map<string, Set<string>>;
  /** Par métier, les clés des formes qui empêchent la lecture (clé du moteur, version du manifeste). */
  exclusions: Map<string, string[]>;
  /** Règles à clause de titre exacte, et leur métier. */
  exactes: Map<string, string>;
  version: 1 | 2;
};
const lecteurs = new WeakMap<object, Lecteur>();
const cleRecherche = (v: string) => searchWords(v).join(" ");
const ENCADREMENT = OCCUPATION_SUPERVISORY_WORDS.map((m) => searchWords(m)).filter((m) => m.length);
// Une marque de genre ou de contrat entre parenthèses (« (ère) », « (H/F) », « (m/w/d) ») n'est pas une frontière : la
// normalisation du moteur la traite. Un groupe plus long (« (Keyholder) », « (Part time) ») en est une.
const MARQUE = /\(\s*(?:\p{L}{1,5}|\p{L}(?:\s*\/\s*\p{L}){1,3})\s*\)/gu;
const FRONTIERE = /[|;,()[\]{}]|\s+[/–—-]\s*|\s*[/–—-]\s+/u;
const segments = (titre: string) => titre.replace(MARQUE, (m) => ` ${m.slice(1, -1)} `).split(FRONTIERE).map((s) => s.trim()).filter(Boolean);

function lecteur(catalogue: CompiledOccupationTaxonomy): Lecteur {
  const connu = lecteurs.get(catalogue.manifest);
  if (connu) return connu;
  const version = catalogue.manifest.matchingVersion ?? 1;
  const concepts = searchConcepts(catalogue.manifest, []).filter((c) => c.kind === "role");
  const verifiees = new Map(catalogue.manifest.occupations.map((o) => [o.key,
    new Set((o.titleReadingAliases ?? []).filter((a) => !occupationLevelOnly(a)).map(cleRecherche))]));
  const exclusions = new Map(catalogue.manifest.occupations.map((o) => [o.key,
    (o.titleReadingExclusions ?? []).map((x) => occupationMatchKey(x, version)).filter(Boolean)]));
  const exactes = new Map(catalogue.manifest.rules.filter((r) => r.all.some((c) => c.field === "title" && c.mode === "exact"))
    .map((r) => [r.id, r.occupation]));
  const lecture = catalogue.manifest.titleReadingVersion ?? 1;
  const lexique = lecture === 2 ? new Set(concepts.flatMap((c) => c.aliases.flatMap((a) => searchWords(a)))) : new Set<string>();
  // Lecture 2 : une expression vérifiée vaut aussi à l'autre genre (« conseillere de vente » pour « conseiller de vente »).
  if (lecture === 2) for (const [role, cles] of verifiees) for (const c of [...cles]) cles.add(auMasculin(c));
  const cree = { resolveur: createIntentResolver(concepts, []), verifiees, exclusions, exactes, version, lexique, lecture };
  lecteurs.set(catalogue.manifest, cree);
  return cree;
}

/** [[D-500]] Q5 — une forme au masculin, mot à mot (mots d'au moins 6 lettres) : la clé qui rapproche les deux genres. */
const MASCULINS: [RegExp, string][] = [[/trice$/, "teur"], [/ienne$/, "ien"], [/enne$/, "en"], [/iere$/, "ier"], [/ere$/, "er"],
  [/euse$/, "eur"], [/ive$/, "if"], [/ante$/, "ant"], [/ente$/, "ent"], [/ointe$/, "oint"], [/elle$/, "el"], [/ee$/, "e"]];
const auMasculin = (phrase: string) => phrase.split(" ").map((m) => {
  if (m.length < 6) return m;
  const r = MASCULINS.find(([re]) => re.test(m));
  return r ? m.replace(r[0], r[1]) : m;
}).join(" ");

/**
 * [[D-500]] Q5 — un segment d'intitulé (normalisé par le moteur, en capitales) dont les mots au pluriel sont ramenés au
 * singulier quand le vocabulaire des métiers connaît ce singulier (« VENDEURS » → « VENDEUR »,
 * « VENTES » → « VENTE », « COMMERCIAUX » → « COMMERCIAL ») ; tout autre mot reste tel quel. Le titre natif n'est jamais
 * réécrit : ce texte ne sert qu'à lire les métiers.
 */
function auSingulier(norme: string, lexique: ReadonlySet<string>): string {
  return norme.replace(/[A-Z]{4,}/g, (mot) => {
    const m = mot.toLowerCase();
    const singulier = /aux$/.test(m) ? m.replace(/aux$/, "al") : /[^su]s$/.test(m) || /x$/.test(m) ? m.slice(0, -1) : null;
    return singulier && lexique.has(singulier) ? singulier.toUpperCase() : mot;
  });
}

const contient = (mots: string[], m: string[], hors: [number, number]) => {
  for (let i = 0; i + m.length <= mots.length; i++)
    if ((i + m.length <= hors[0] || i >= hors[1]) && m.every((x, j) => mots[i + j] === x)) return true;
  return false;
};

/** Ce que le résolveur lit dans un intitulé plus long, AVANT vérification (étape 6g : chaque expression s'y vérifie sur
 * ce qu'elle capte), après les mots d'encadrement, les formes décidées et la préséance d'une règle exacte. */
export function occupationTitleReadings(
  catalogue: CompiledOccupationTaxonomy,
  title: string | null | undefined,
  decision: TitleDecision,
): { role: string; phrase: string }[] {
  if (!title?.trim()) return [];
  const { resolveur, exclusions, exactes, version, lexique, lecture } = lecteur(catalogue);
  if (decision.occupationStatus === "CLASSIFIED"
    && decision.occupationEvidence.matchedRules.some((id) => exactes.get(id) === decision.occupationCode)) return [];
  // Lecture 2 : les formes exclues se cherchent aussi dans l'intitulé ramené au singulier (« PREMIERES VENDEUSES »).
  const cle = ` ${occupationMatchKey(title, version)} ${lecture === 2 ? `${occupationMatchKey(auSingulier(normalizeOccupationTitle(title), lexique), version)} ` : ""}`;
  const parts = segments(title);
  // Lecture 2 : le segment tel quel, puis ramené au singulier s'il change (« CHARGE D AFFAIRES » se lit toujours tel quel) ;
  // les lectures s'ajoutent, aucune ne se perd.
  const lectures = (segment: string) => {
    const norme = normalizeOccupationTitle(segment);
    const singulier = lecture === 2 ? auSingulier(norme, lexique) : norme;
    return singulier === norme ? [norme] : [norme, singulier];
  };
  const vues = new Set<string>();
  return parts.flatMap((segment) => lectures(segment)).flatMap((norme) => {
    const mots = searchWords(norme);
    return resolveur.titleMatches(norme)
      .filter((m) => m.kind === "role" && !(m.whole && parts.length === 1))
      .filter((m) => {
        const span: [number, number] = [m.start, m.start + m.phrase.split(" ").length];
        return !ENCADREMENT.some((e) => contient(mots, e, span));
      })
      .flatMap((m) => m.keys.filter((r) => !exclusions.get(r)?.some((x) => cle.includes(` ${x} `))).map((role) => ({ role, phrase: m.phrase })));
  }).filter((l) => (vues.has(`${l.role}|${l.phrase}`) ? false : (vues.add(`${l.role}|${l.phrase}`), true)));
}

export function occupationTitleRoles(
  catalogue: CompiledOccupationTaxonomy,
  title: string | null | undefined,
  decision: TitleDecision,
): string[] {
  const { verifiees } = lecteur(catalogue);
  const { lecture } = lecteur(catalogue);
  const lus = occupationTitleReadings(catalogue, title, decision)
    .filter(({ role, phrase }) => verifiees.get(role)?.has(phrase) || (lecture === 2 && !!verifiees.get(role)?.has(auMasculin(phrase))));
  return [...new Set([...decision.occupationEvidence.candidates, ...lus.map((l) => l.role)])].sort();
}
