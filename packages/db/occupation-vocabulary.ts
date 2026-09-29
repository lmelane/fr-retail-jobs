import { occupationExactKey, type OccupationManifest } from "./occupation-engine.ts";

/**
 * Garde d'unicité du vocabulaire (plan `docs/architecture/classification-metiers.md` §3.1, lot 2B de D-475) : aucune
 * variante, dans aucune langue, ne désigne deux concepts du même genre (deux métiers, deux familles, deux secteurs).
 * Une seule fonction, appelée par l'assemblage et la preview (clé du moteur) et par un test de l'API (clé de la
 * recherche) : chaque surface vérifie avec la normalisation qu'elle applique réellement.
 *
 * Sources d'un métier : ses libellés (toutes langues), ses alias, ses alias « titre seulement » et les expressions de
 * titre de ses règles ; d'une famille : ses libellés et ses alias ; `supplement` ajoute ce qu'une surface y joint (les
 * secteurs de l'API, par exemple).
 */
export type VocabularyConcept = { key: string; kind: string; aliases: readonly string[] };
export type VocabularyCollision = { key: string; kind: string; concepts: string[]; values: string[] };

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
    ...manifest.families.map((f) => ({ key: f.key, kind: "family", aliases: [...Object.values(f.labels), ...(f.aliases ?? [])] })),
  ];
}

export function vocabularyCollisions(
  concepts: readonly VocabularyConcept[],
  cle: (value: string) => string,
): VocabularyCollision[] {
  const parCle = new Map<string, { kind: string; concepts: Set<string>; values: Set<string> }>();
  for (const c of concepts)
    for (const v of c.aliases) {
      const k = cle(v);
      if (!k) continue;
      const id = `${c.kind} ${k}`;
      const x = parCle.get(id) ?? { kind: c.kind, concepts: new Set<string>(), values: new Set<string>() };
      x.concepts.add(c.key);
      x.values.add(v);
      parCle.set(id, x);
    }
  return [...parCle]
    .filter(([, x]) => x.concepts.size > 1)
    .map(([id, x]) => ({ key: id.slice(x.kind.length + 1), kind: x.kind, concepts: [...x.concepts].sort(), values: [...x.values] }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
}

/** La garde avec la clé du moteur de la version du manifeste (celle de sa correspondance). */
export function manifestVocabularyCollisions(manifest: OccupationManifest, supplement: readonly VocabularyConcept[] = []): VocabularyCollision[] {
  const version = manifest.matchingVersion ?? 1;
  return vocabularyCollisions([...manifestVocabulary(manifest), ...supplement], (v) => occupationExactKey(v, version));
}
