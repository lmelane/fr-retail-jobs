import { occupationExactKey, type OccupationManifest } from "./occupation-engine.ts";

/**
 * Garde d'unicité du vocabulaire (plan `docs/architecture/classification-metiers.md` §3.1, lot 2B de D-475) : aucune
 * variante, dans aucune langue, ne désigne deux concepts du même genre (deux métiers, deux familles, deux secteurs).
 * Une seule fonction, appelée par l'assemblage et la preview (clé du moteur) et par un test de l'API (clé de la
 * recherche) : chaque surface vérifie avec la normalisation qu'elle applique réellement.
 *
 * Deux surfaces, deux vocabulaires : le MOTEUR compare les métiers (libellés, alias, alias « titre seulement »,
 * expressions de titre des règles) ; la RECHERCHE compare ensemble métiers, familles et secteurs (ses concepts, tels
 * que `searchConcepts` de l'API les construit). `supplement` ajoute ce qu'une surface y joint.
 */
export type VocabularyConcept = { key: string; kind: string; aliases: readonly string[] };
export type VocabularyCollision = { key: string; kind: string; concepts: string[]; values: string[] };

/** La surface du MOTEUR : les métiers (le moteur ne lit ni les alias de familles ni les secteurs). */
export function manifestVocabulary(manifest: OccupationManifest): VocabularyConcept[] {
  const titres = new Map<string, string[]>();
  for (const r of manifest.rules)
    for (const c of r.all)
      if (c.field === "title") titres.set(r.occupation, [...(titres.get(r.occupation) ?? []), ...c.any]);
  return [
    ...manifest.occupations.map((o) => ({
      key: o.key,
      kind: "occupation",
      aliases: [...Object.values(o.labels), ...(o.aliases ?? []), ...(o.titleOnlyAliases ?? []), ...(titres.get(o.key) ?? [])],
    })),
  ];
}

/**
 * Une variante désigne deux concepts dès qu'elle en désigne deux, QUEL QUE SOIT leur genre : la recherche abandonne
 * une phrase qui a plus d'une entrée (`find` de packages/db/search-intent.ts), qu'il s'agisse de deux métiers ou d'un
 * métier et d'une famille (audit du lot 2B-2 : « 销售顾问 », métier et famille, tombait en texte libre).
 */
export function vocabularyCollisions(
  concepts: readonly VocabularyConcept[],
  cle: (value: string) => string,
): VocabularyCollision[] {
  const parCle = new Map<string, { concepts: Set<string>; values: Set<string> }>();
  for (const c of concepts)
    for (const v of c.aliases) {
      const k = cle(v);
      if (!k) continue;
      const x = parCle.get(k) ?? { concepts: new Set<string>(), values: new Set<string>() };
      x.concepts.add(`${c.kind}:${c.key}`);
      x.values.add(v);
      parCle.set(k, x);
    }
  return [...parCle]
    .filter(([, x]) => x.concepts.size > 1)
    .map(([k, x]) => ({ key: k, kind: [...new Set([...x.concepts].map((c) => c.split(':')[0]))].sort().join('+'), concepts: [...x.concepts].sort(), values: [...x.values] }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** La garde du moteur, avec la clé de la version du manifeste (celle de sa correspondance). La recherche, elle, passe
 * ses propres concepts (métiers, familles, secteurs) à `vocabularyCollisions` avec sa clé. */
export function manifestVocabularyCollisions(manifest: OccupationManifest, supplement: readonly VocabularyConcept[] = []): VocabularyCollision[] {
  const version = manifest.matchingVersion ?? 1;
  return vocabularyCollisions([...manifestVocabulary(manifest), ...supplement], (v) => occupationExactKey(v, version));
}
