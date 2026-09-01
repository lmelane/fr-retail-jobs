/**
 * Free-text search across everything a posting says about itself.
 *
 * The previous filter matched `title` and `company` with a strict substring, so
 * "vendeuse chanel marseille" returned nothing — no single field contains all
 * three words, and no field contains "vendeuse" when the title says "Vendeur".
 *
 * Every term must appear SOMEWHERE in the posting (title, employer, city,
 * region, contract, description), but not necessarily in the same field. Terms
 * match on a normalized prefix, which covers the endings that carry most French
 * near-misses — vendeur/vendeuse, conseiller/conseillère, boutique/boutiques.
 */

/** Accent- and case-insensitive; punctuation becomes space. */
function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Prefix worth matching on. French inflections live in the tail, so comparing
 * stems catches them without a stemmer.
 *
 * Trimming two characters was not enough: "vendeuse" gave "vendeu" and "vente"
 * gave "vente", which share no prefix even though a candidate typing the first
 * plainly wants "Conseiller de vente". Longer words are cut harder, since the
 * root sits earlier — but never below 4 characters, or "directeur" would reach
 * "direction" and "direct" alike.
 */
function stem(term: string): string {
  // The floor is 4, not 5: "vente" is five letters and would never be trimmed,
  // so "vendeuse" (stem "vend") could not reach it — yet a candidate typing
  // "vendeuse" plainly wants "Conseiller de vente". Below 4 the roots get short
  // enough to collide ("dir" would join directeur and direction).
  if (term.length <= 4) return term;
  return term.slice(0, Math.max(4, term.length - 4));
}

/**
 * Words a candidate types that the posting spells differently — derivations a
 * prefix rule cannot bridge, because the roots themselves diverge ("vendeuse"
 * stems to "vend", "vente" to "vent").
 *
 * Deliberately tiny, and limited to retail vocabulary where the equivalence is
 * beyond argument. A loose entry here silently widens every search.
 */
/** Written as STEMS, since that is what they are compared against. */
const ROOT_ALIASES: ReadonlyArray<readonly string[]> = [
  ['vend', 'vent'], // vendeur / vendeuse / vente
  ['bout', 'maga', 'stor'], // boutique / magasin / store
];

function aliasGroup(stemmed: string): readonly string[] | undefined {
  return ROOT_ALIASES.find((group) => group.some((root) => stemmed.startsWith(root)));
}

export type SearchableJob = {
  title: string;
  company: string;
  city: string | null;
  location: string | null;
  contract: string | null;
  description: string | null;
  sector: string | null;
};

/** One normalized blob per posting; built once per row, not once per term. */
export function searchIndex(job: SearchableJob): string {
  return normalize(
    [job.title, job.company, job.city, job.location, job.contract, job.sector, job.description]
      .filter(Boolean)
      .join(' '),
  );
}

/**
 * True when every term in the query appears in the haystack.
 *
 * AND rather than OR: "vendeuse paris" must not return every job in Paris.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const terms = normalize(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;

  const words = haystack.split(' ');
  return terms.every((term) => words.some((word) => sharesRoot(term, word)));
}

/**
 * Two words share a root when one's stem prefixes the other.
 *
 * Comparing stem to stem is not enough, because a short word is never trimmed:
 * "vendeuse" stems to "vend" but "vente" stays whole, so neither prefixes the
 * other. Comparing each stem against the FULL other word closes that — "vend"
 * prefixes "vente" — while a 4-character floor keeps it from matching
 * everything.
 */
function sharesRoot(a: string, b: string): boolean {
  if (a === b) return true;
  const stemA = stem(a);
  const stemB = stem(b);
  // Stem against the full other word first: "vend" prefixes "vente".
  if (b.startsWith(stemA) || a.startsWith(stemB)) return true;
  // Then stem against stem, which catches the pairs whose stems diverge in the
  // last letter — "vendeuse" gives "vend" and "vente" gives "vent", so neither
  // reaches the other's full form, though both are the same root.
  if (stemA.startsWith(stemB) || stemB.startsWith(stemA)) return true;
  // Last, the hand-listed equivalences a prefix rule cannot express.
  const group = aliasGroup(stemA);
  return group !== undefined && group === aliasGroup(stemB);
}
