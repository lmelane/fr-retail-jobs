import { normalizeOccupationTitle, type CompiledOccupationTaxonomy } from "./occupation-engine.ts";
import { occupationLevelOnly } from "./occupation-levels.ts";
import { createIntentResolver, searchWords } from "./search-intent.ts";
import { searchConcepts } from "./search-vocabulary.ts";

/**
 * Les métiers lus dans un intitulé (`titleRoles`, D-475 point 38 ; plan docs/architecture/classification-metiers.md
 * §3.3) : une recherche par métier retrouve aussi les offres dont l'intitulé contient ce métier (point 27 e), sauf sous
 * un mot d'encadrement (point 32 a). Ce sont :
 *  - les candidats retenus par le moteur (le métier d'un intitulé classé, ceux d'un intitulé ambigu), qui porte déjà les
 *    intitulés exacts validés, dont ceux faits seulement de mots de niveau (points 36, 37) ;
 *  - plus les métiers que le résolveur de la recherche lit dans un intitulé PLUS LONG, passé d'abord par la
 *    normalisation du moteur (écriture inclusive : « Animateur·rice des ventes »), la portée la plus longue l'emportant
 *    (« Responsable vendeur » ne laisse pas lire « vendeur »), seulement pour une expression vérifiée sur ce qu'elle y
 *    capte (`titleReadingAliases`, étape de curation 6g, R-66 §2 : sans preuve, pas de généralisation) et jamais pour
 *    un métier dont une règle exclut l'intitulé (ses mots d'encadrement jugés). Sans cette preuve, la lecture était
 *    fausse pour 17 % des offres (mesure 6f du 29/09/2026 : « Commercial Controller » → commercial, « Extra salle » →
 *    figurant) ; lire tout alias pour l'intitulé exact n'ajoutait qu'un intitulé, faux (« Optometric Technician »).
 * Un lecteur par version du catalogue, construit une fois.
 */
type Lecteur = {
  resolveur: ReturnType<typeof createIntentResolver>;
  /** Par métier, les expressions vérifiées pour un intitulé plus long (mots de la recherche). */
  verifiees: Map<string, Set<string>>;
};
const lecteurs = new WeakMap<object, Lecteur>();
const cleRecherche = (v: string) => searchWords(v).join(" ");

function lecteur(catalogue: CompiledOccupationTaxonomy): Lecteur {
  const connu = lecteurs.get(catalogue.manifest);
  if (connu) return connu;
  const concepts = searchConcepts(catalogue.manifest, []).filter((c) => c.kind === "role");
  const verifiees = new Map(catalogue.manifest.occupations.map((o) => [o.key,
    new Set((o.titleReadingAliases ?? []).filter((a) => !occupationLevelOnly(a)).map(cleRecherche))]));
  const cree = { resolveur: createIntentResolver(concepts, []), verifiees };
  lecteurs.set(catalogue.manifest, cree);
  return cree;
}

/** Ce que le résolveur lit dans un intitulé plus long, AVANT vérification (étape 6g : chaque expression s'y vérifie sur
 * ce qu'elle capte) : les métiers lus dans une portée plus courte que l'intitulé, hors encadrement. */
export function occupationTitleReadings(catalogue: CompiledOccupationTaxonomy, title: string | null | undefined): { role: string; phrase: string }[] {
  if (!title?.trim()) return [];
  const exclus = catalogue.excludedOccupations(title);
  return lecteur(catalogue).resolveur.titleMatches(normalizeOccupationTitle(title)).filter((m) => m.kind === "role" && !m.whole)
    .flatMap((m) => m.keys.filter((r) => !exclus.has(r)).map((role) => ({ role, phrase: m.phrase })));
}

export function occupationTitleRoles(
  catalogue: CompiledOccupationTaxonomy,
  title: string | null | undefined,
  candidates: readonly string[],
): string[] {
  const { verifiees } = lecteur(catalogue);
  const lus = occupationTitleReadings(catalogue, title).filter(({ role, phrase }) => verifiees.get(role)?.has(phrase));
  return [...new Set([...candidates, ...lus.map((l) => l.role)])].sort();
}
