/** Engine-independent query interpretation. This candidate is exercised by the
 * frozen-corpus benchmark before it replaces the public search path.
 * No network, model call, publication gate, or modification of native fields. */
export type SearchConcept = { key: string; kind: 'role' | 'family' | 'sector'; aliases: readonly string[]; titleOnlyAliases?: readonly string[] };
export type SearchCompany = { id: string; names: readonly string[] };
export type SearchClause = {
  kind: SearchConcept['kind'] | 'company' | 'text';
  keys: string[];
  phrases: string[];
  observed: string;
  corrected: boolean;
  exclude: boolean;
  /** An ambiguous standalone brand gets a ranking preference, never a hard filter. */
  preferCompanyKeys?: string[];
  /** Broad activity words may establish a role in the title, not a colleague mention. */
  titleOnlyPhrases?: string[];
};
export type SearchIntent = { version: 1; original: string; clauses: SearchClause[] };

export function searchWords(value: string): string[] {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    // Shared character positions let a native CJK role match inside an
    // unsegmented title even when no occupation code exists.
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, ' $& ')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}
const phrase = (value: string) => searchWords(value).join(' ');
// In a composed query these are ambiguous words, not unambiguous employers.
// An exact whole-query company name remains searchable through native text.
const AMBIGUOUS_COMPANIES = new Set(['on', 'normal', 'coach', 'next', 'boss', 'cos', 'closed', 'only', 'theory', 'head', 'alo']);
const NEGATION = new Set(['sans', 'without', 'excluding', 'except', 'not', 'hors']);
const CONNECTOR = new Set(['chez', 'at', 'pour', 'for']);

/** Damerau distance <= 1, bounded to a single sufficiently long word. */
function oneEdit(a: string, b: string): boolean {
  if (a === b || Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const differences = [...a].flatMap((c, i) => c === b[i] ? [] : [i]);
    return differences.length === 1 || (differences.length === 2 && differences[1] === differences[0] + 1
      && a[differences[0]] === b[differences[1]] && a[differences[1]] === b[differences[0]]);
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}

type Entry = { kind: SearchClause['kind']; keys: string[]; phrases: string[]; words: string[]; titleOnlyPhrases?: string[] };

export function createIntentResolver(concepts: readonly SearchConcept[], companies: readonly SearchCompany[]) {
  const entries = new Map<string, Entry[]>();
  const ambiguousCompanies = new Map<string, Entry[]>();
  const add = (raw: string, e: Omit<Entry, 'words'>) => {
    const p = phrase(raw);
    if (!p) return;
    const list = entries.get(p) ?? [];
    if (!list.some(x => x.kind === e.kind && x.keys.join('\0') === e.keys.join('\0'))) list.push({ ...e, words: p.split(' ') });
    entries.set(p, list);
  };
  for (const c of concepts) for (const a of c.aliases) add(a, { kind: c.kind, keys: [c.key], phrases: [...new Set(c.aliases.map(phrase))], titleOnlyPhrases: c.titleOnlyAliases?.map(phrase) });
  // Only reviewed aliases and explicit company/group relationships enter here.
  // Duplicate names naming unrelated entities remain lexical, never a forced ID.
  for (const c of companies) for (const a of c.names) {
    const entry = { kind: 'company' as const, keys: [c.id], phrases: [...new Set(c.names.map(phrase))] };
    if (!AMBIGUOUS_COMPANIES.has(phrase(a))) add(a, entry);
    else {
      const list = ambiguousCompanies.get(phrase(a)) ?? [];
      if (!list.some(e => e.keys[0] === c.id)) list.push({ ...entry, words: phrase(a).split(' ') });
      ambiguousCompanies.set(phrase(a), list);
    }
  }
  const unique = [...entries.values()].filter(es => es.length === 1).map(es => es[0]);
  const maxWords = Math.max(1, ...unique.map(x => x.words.length));
  // Corrections are role/family aliases only: never rewrite a Maison or a
  // free-text term to the closest entity. Competing corrections abstain.
  const corrections = unique.filter(e => e.kind === 'role');

  function find(words: string[], offset: number, correct: boolean): { entry: Entry; length: number; corrected: boolean } | undefined {
    for (let n = Math.min(maxWords, words.length - offset); n > 0; n--) {
      const candidates = entries.get(words.slice(offset, offset + n).join(' '));
      if (candidates?.length === 1) return { entry: candidates[0], length: n, corrected: false };
      // A longer ambiguous alias must not be split into a shorter different role.
      if (candidates?.length) return;
    }
    if (!correct) return;
    const matches = corrections.filter(e => {
      const part = words.slice(offset, offset + e.words.length);
      if (part.length !== e.words.length) return false;
      let edits = 0;
      return part.every((word, i) => word === e.words[i] || (oneEdit(word, e.words[i]) && ++edits === 1)) && edits === 1;
    });
    const keys = new Set(matches.map(e => e.keys.join('\0')));
    if (keys.size !== 1) return;
    matches.sort((a, b) => b.words.length - a.words.length);
    return { entry: matches[0], length: matches[0].words.length, corrected: true };
  }

  return {
    resolve(original: string): SearchIntent {
      // Reject excessive input explicitly; never drop trailing intent silently.
      if (original.length > 500) throw new Error('SEARCH_QUERY_TOO_LONG');
      const words = searchWords(original);
      if (words.length > 64) throw new Error('SEARCH_QUERY_TOO_MANY_WORDS');
      const clauses: SearchClause[] = [];
      for (let i = 0; i < words.length;) {
        let exclude = false;
        if (NEGATION.has(words[i]) && i + 1 < words.length) { exclude = true; i++; }
        const ambiguous = ambiguousCompanies.get(words[i]);
        // A terminal Maison after a resolved role, or explicitly introduced by
        // 'chez/at', has identity context. A free 'on' remains an ordinary word.
        const companyContext = ambiguous?.length === 1 && i === words.length - 1
          && (clauses.some(c => c.kind === 'role' && !c.exclude) || (i > 0 && CONNECTOR.has(words[i - 1])));
        const found = companyContext ? { entry: ambiguous[0], length: 1, corrected: false } : find(words, i, true);
        if (found) {
          clauses.push({ kind: found.entry.kind, keys: found.entry.keys, phrases: found.entry.phrases,
            observed: words.slice(i, i + found.length).join(' '), corrected: found.corrected, exclude,
            ...(found.entry.titleOnlyPhrases?.length ? { titleOnlyPhrases: found.entry.titleOnlyPhrases } : {}) });
          i += found.length;
        } else if (!exclude && CONNECTOR.has(words[i]) && clauses.length && (find(words, i + 1, false) || (i + 2 === words.length && ambiguousCompanies.get(words[i + 1])?.length === 1))) {
          i++;
        } else {
          clauses.push({ kind: 'text', keys: [], phrases: [words[i]], observed: words[i], corrected: false, exclude,
            ...(words.length === 1 && ambiguous?.length === 1 ? { preferCompanyKeys: ambiguous[0].keys } : {}) });
          i++;
        }
      }
      return { version: 1, original, clauses };
    },
    /** Exact, longest alias spans only. Typo correction belongs to queries, not
     * inferred job facts. A deputy title cannot acquire the nested manager role. */
    titleConcepts(title: string): { roles: string[]; families: string[] } {
      const words = searchWords(title);
      const roles = new Set<string>(), families = new Set<string>();
      for (let i = 0; i < words.length;) {
        const found = find(words, i, false);
        if (found) {
          if (found.entry.kind === 'role') found.entry.keys.forEach(k => roles.add(k));
          if (found.entry.kind === 'family') found.entry.keys.forEach(k => families.add(k));
          i += found.length;
        } else i++;
      }
      return { roles: [...roles].sort(), families: [...families].sort() };
    },
  };
}
