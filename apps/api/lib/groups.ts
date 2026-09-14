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
    // The aggregator owns the list; the web app reads the same file rather than
    // keeping a second copy that would drift.
    const path = join(process.cwd(), '..', 'aggregator', 'data', 'maisons.csv');
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
  } catch {
    // A missing file must not break search — it just loses the expansion.
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
