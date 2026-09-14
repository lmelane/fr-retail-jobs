/**
 * Brand ↔ parent group, so a search reaches offers filed under either name.
 *
 * A candidate types "sandro". The offer may well be published by the group
 * portal under "SMCP", with the brand named only in the posting text — or not
 * at all. Matching the employer column alone finds nothing.
 *
 * Read from the 728-house reference list at build time rather than hard-coded,
 * so a new Maison is a CSV row and not a code change.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Registry = {
  /** lowercase brand -> its parent group, as written in the reference list. */
  groupOf: Map<string, string>;
  /** lowercase group -> every brand under it. */
  brandsOf: Map<string, string[]>;
};

let cached: Registry | null = null;

function load(): Registry {
  if (cached) return cached;

  const groupOf = new Map<string, string>();
  const brandsOf = new Map<string, string[]>();

  try {
    /*
     * The aggregator owns the list; the API reads the same file rather than
     * keeping a second copy that would drift.
     *
     * AUDIT 14/09/2026 — LE CHEMIN ÉTAIT FAUX, et personne ne le savait.
     * Il pointait `data/maisons.csv` ; le fichier vit dans
     * `data/reference/maisons.csv` (735 Maisons). Le `catch` plus bas avalait
     * l'échec en silence : l'expansion rendait le terme seul, la recherche
     * « sandro » n'atteignait plus les offres classées sous « SMCP », et
     * AUCUNE erreur ne le signalait.
     *
     * Ce défaut muet en masquait un second, plus grave : tant que le fichier
     * restait introuvable, l'amplification de la recherche restait faible PAR
     * ACCIDENT. Réparer ce chemin seul aurait multiplié par ~15 le nombre de
     * clauses SQL d'une requête — un « bugfix anodin » devenu vecteur de déni
     * de service. C'est pourquoi ce correctif part AVEC les bornes posées dans
     * `job-search-query.ts` (8 termes, LIMIT 20 sur les alias), jamais seul.
     */
    const path = join(process.cwd(), '..', 'aggregator', 'data', 'reference', 'maisons.csv');
    const lines = readFileSync(path, 'utf8').split('\n').slice(1);

    for (const line of lines) {
      const [name, , , group] = line.split(',');
      if (!name || !group?.trim()) continue;
      const brand = name.trim();
      const parent = group.trim();

      groupOf.set(brand.toLowerCase(), parent);
      const siblings = brandsOf.get(parent.toLowerCase()) ?? [];
      siblings.push(brand);
      brandsOf.set(parent.toLowerCase(), siblings);
    }
  } catch (error) {
    /*
     * Un fichier absent ne doit PAS casser la recherche — elle perd seulement
     * l'expansion. Mais elle ne doit plus le perdre EN SILENCE : c'est ce
     * silence qui a laissé un chemin erroné en place sans que personne ne le
     * voie, la recherche par groupe étant dégradée sans aucun symptôme.
     *
     * Une ligne de journal, pas une exception : la dégradation reste douce,
     * mais elle devient observable.
     */
    console.warn(JSON.stringify({
      evenement: 'groupes.referentiel_illisible',
      detail: error instanceof Error ? error.message : String(error),
      consequence: "recherche par groupe degradee : 'sandro' n'atteint plus les offres classees 'SMCP'",
    }));
  }

  cached = { groupOf, brandsOf };
  return cached;
}

/**
 * Every employer name worth searching for one term.
 *
 * "sandro" -> ["sandro", "SMCP"]        (the brand, plus its parent)
 * "smcp"   -> ["smcp", "Sandro", "Maje", "Claudie Pierlot", "Fursac"]
 * "vendeur"-> ["vendeur"]               (not a company; unchanged)
 */
export function expandCompanyTerm(term: string): string[] {
  const { groupOf, brandsOf } = load();
  const key = term.toLowerCase();
  const expanded = new Set<string>([term]);

  const parent = groupOf.get(key);
  if (parent) expanded.add(parent);

  for (const brand of brandsOf.get(key) ?? []) expanded.add(brand);

  return [...expanded];
}
