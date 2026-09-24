/** Offline challenger only. Synonyms and interpreted identities come exclusively
 * from the same SearchIntent as PostgreSQL; no second query understanding. */
import { searchWords, type SearchClause, type SearchIntent } from '../../lib/search-intent';
import profile from './elastic-profile.json';

const FIELD = { role: 'roles', family: 'families', sector: 'sectors', company: 'companyKeys', text: 'title' };
type Query = Record<string, unknown>;
function clause(c: SearchClause): Query {
  const fields = c.kind === 'company' ? ['title^10', 'company^5']
    : ['role', 'family'].includes(c.kind) ? ['title^10', 'duties^1'] : ['title^10', 'company^5', 'body^0.5'];
  const lexical: Query[] = c.phrases.map(query => ({ multi_match: {
    query, fields: c.titleOnlyPhrases?.includes(query) ? ['title^10'] : fields, type: 'phrase',
  } }));
  // Do not stem employer names or negations. A linguistic field is populated
  // only from the document's declared language, never inferred from its market.
  if (!c.exclude && c.kind !== 'company') for (const query of c.phrases) {
    // Stemming a responsibility ("financial control") must not turn a store
    // manager into a "financial controller". Exact native duties remain above.
    const weighted = (c.kind === 'role' || c.titleOnlyPhrases?.includes(query) ? ['title^10'] : fields).filter(f => !f.startsWith('company'));
    lexical.push({ dis_max: { queries: Object.keys(profile.languages).map(language => ({ multi_match: {
      query, fields: weighted.map(f => `linguistic_${language}_${f}`), type: 'phrase', boost: profile.linguisticBoost,
    } })) } });
  }
  // One edit on ONE long residual token; all other words remain required in the
  // SAME title/duties field. No fuzzy company, semantic role, exclusion or digit.
  // Known role typos have already been handled by the shared intent resolver.
  if (c.kind === 'text' && !c.exclude && !c.preferCompanyKeys?.length) for (const phrase of c.phrases) {
    const words = searchWords(phrase);
    if (!words.length || words.length > profile.fuzzy.maxWords || words.some(w => /\p{N}/u.test(w))) continue;
    for (let i = 0; i < words.length; i++) {
      if (words[i].length < profile.fuzzy.minLength || !/^\p{Script=Latin}+$/u.test(words[i])) continue;
      lexical.push({ dis_max: { queries: ['title', 'duties'].map(field => ({ bool: {
        must: words.map((word, j) => j === i ? { fuzzy: { [field]: { value: word, fuzziness: 1,
          prefix_length: profile.fuzzy.prefixLength, max_expansions: profile.fuzzy.maxExpansions, transpositions: true,
        } } } : { term: { [field]: word } }), boost: profile.fuzzy.boost,
      } })) } });
    }
  }
  const should: Query[] = c.kind === 'role' ? [{ bool: {
    must: [{ bool: { should: lexical, minimum_should_match: 1 } }], must_not: [{ exists: { field: 'titleRoles' } }],
  } }] : lexical;
  if (c.kind !== 'text') should.push({ constant_score: { filter: { terms: { [FIELD[c.kind]]: c.keys } }, boost: 10 } });
  if (c.preferCompanyKeys?.length) return { bool: {
    must: [{ bool: { should, minimum_should_match: 1 } }],
    should: [{ constant_score: { filter: { terms: { companyKeys: c.preferCompanyKeys } }, boost: 20 } }],
  } };
  return { bool: { should, minimum_should_match: 1 } };
}

export function elasticQuery(intent: SearchIntent, countries: readonly string[], limit: number) {
  return { size: limit, track_total_hits: true, _source: false,
    query: { bool: { filter: [{ terms: { country: countries } }],
      must: intent.clauses.filter(c => !c.exclude).map(clause),
      must_not: intent.clauses.filter(c => c.exclude).map(clause),
    } }, sort: [{ origin: 'asc' }, '_score', { postedAt: 'desc' }, { firstSeenAt: 'desc' }, { id: 'asc' }],
  };
}
