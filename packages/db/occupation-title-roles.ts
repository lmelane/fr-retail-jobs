import { normalizeOccupationTitle, type CompiledOccupationTaxonomy } from "./occupation-engine.ts";
import { occupationLevelOnly } from "./occupation-levels.ts";
import { createIntentResolver, searchWords } from "./search-intent.ts";
import { searchConcepts } from "./search-vocabulary.ts";

/**
 * Les métiers lus dans un intitulé (`titleRoles`, D-475 point 38 ; plan docs/architecture/classification-metiers.md
 * §3.3) : une recherche par métier retrouve aussi les offres dont l'intitulé contient ce métier (point 27 e), sauf sous
 * un mot d'encadrement (point 32 a). Ce sont :
 *  - les candidats retenus par le moteur (le métier d'un intitulé classé, ceux d'un intitulé ambigu) ;
 *  - plus les métiers que le résolveur de la recherche lit dans l'intitulé, la portée la plus longue l'emportant, sur
 *    l'intitulé passé d'abord par la normalisation du moteur (écriture inclusive : « Animateur·rice des ventes ») ;
 *    un métier dont une règle exclut l'intitulé (ses mots d'encadrement jugés) n'en fait pas partie ;
 *  - un alias fait seulement de mots de niveau (« Team Leader », « Supervisor ») ne vaut que pour l'intitulé exact
 *    (points 36, 37) : il ne se lit jamais dans un intitulé plus long.
 * Un résolveur par version du catalogue, construit une fois.
 */
type Lecteur = { resolveur: ReturnType<typeof createIntentResolver>; niveauSeul: Map<string, string[]> };
const lecteurs = new WeakMap<object, Lecteur>();
const cleRecherche = (v: string) => searchWords(v).join(" ");

function lecteur(catalogue: CompiledOccupationTaxonomy): Lecteur {
  const connu = lecteurs.get(catalogue.manifest);
  if (connu) return connu;
  const niveauSeul = new Map<string, string[]>();
  const concepts = searchConcepts(catalogue.manifest, []).filter((c) => c.kind === "role").map((c) => {
    for (const a of c.aliases) if (occupationLevelOnly(a)) niveauSeul.set(cleRecherche(a), [...(niveauSeul.get(cleRecherche(a)) ?? []), c.key]);
    return { ...c, aliases: c.aliases.filter((a) => !occupationLevelOnly(a)) };
  });
  const cree = { resolveur: createIntentResolver(concepts, []), niveauSeul };
  lecteurs.set(catalogue.manifest, cree);
  return cree;
}

export function occupationTitleRoles(
  catalogue: CompiledOccupationTaxonomy,
  title: string | null | undefined,
  candidates: readonly string[],
): string[] {
  const roles = new Set(candidates);
  if (title?.trim()) {
    const { resolveur, niveauSeul } = lecteur(catalogue);
    const exclus = catalogue.excludedOccupations(title);
    for (const r of resolveur.titleConcepts(normalizeOccupationTitle(title)).roles) if (!exclus.has(r)) roles.add(r);
    for (const r of niveauSeul.get(cleRecherche(normalizeOccupationTitle(title))) ?? []) roles.add(r);
  }
  return [...roles].sort();
}
