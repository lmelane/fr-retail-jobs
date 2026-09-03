/**
 * Posting-language detection (decision, 2026-09-03).
 *
 * The catalogue is worldwide and nothing may drop an offer for its language;
 * the language is STORED so the jobboard can display, filter or translate
 * later. Most ATS feeds do not declare it, so it is detected from the text.
 *
 * Detection is stopword scoring over the languages the catalogue actually
 * carries. Function words are the most frequent tokens of any real posting and
 * are nearly disjoint between these languages, so a handful of hits decides
 * cleanly; when the evidence is thin (short title, language outside the set)
 * the answer is undefined, never a guess.
 */

const STOPWORDS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ['fr', new Set(['le', 'la', 'les', 'des', 'une', 'et', 'est', 'vous', 'nous', 'pour', 'dans', 'avec', 'sur', 'votre', 'nos', 'aux', 'du', 'au', 'ou', 'être', 'sont', 'plus', 'que', 'qui', 'pas', 'chez', 'poste', 'ainsi', 'afin'])],
  ['en', new Set(['the', 'and', 'of', 'to', 'in', 'you', 'we', 'our', 'with', 'for', 'is', 'are', 'will', 'be', 'as', 'at', 'this', 'that', 'your', 'or', 'have', 'from', 'an', 'by', 'on', 'their'])],
  ['de', new Set(['der', 'die', 'das', 'und', 'wir', 'du', 'sie', 'mit', 'für', 'ein', 'eine', 'einen', 'ist', 'bei', 'auf', 'dich', 'dein', 'deine', 'unser', 'unsere', 'werden', 'sowie', 'oder', 'nicht', 'als', 'zum', 'zur', 'im'])],
  ['es', new Set(['el', 'la', 'los', 'las', 'de', 'y', 'en', 'con', 'para', 'por', 'una', 'que', 'es', 'nuestro', 'nuestra', 'trabajo', 'como', 'del', 'se', 'te', 'tu', 'más', 'está'])],
  ['it', new Set(['il', 'la', 'le', 'di', 'e', 'che', 'per', 'con', 'una', 'del', 'della', 'nel', 'sono', 'nostro', 'nostra', 'lavoro', 'più', 'anche', 'come', 'gli', 'dei', 'delle', 'ed'])],
  ['pt', new Set(['o', 'a', 'os', 'as', 'de', 'e', 'em', 'com', 'para', 'uma', 'que', 'é', 'não', 'você', 'nosso', 'nossa', 'mais', 'trabalho', 'como', 'dos', 'das', 'ao', 'são'])],
  ['nl', new Set(['de', 'het', 'een', 'en', 'van', 'je', 'jij', 'wij', 'met', 'voor', 'op', 'bij', 'naar', 'onze', 'wordt', 'zijn', 'niet', 'ook', 'als', 'dat', 'aan', 'werken'])],
];

/** Below this many stopword hits the text has not said what language it is. */
const MIN_HITS = 3;
/** The winner must beat the runner-up by this factor, or the text is mixed. */
const LEAD_FACTOR = 1.4;

/**
 * ISO-639-1 code of the text's language, or undefined when the evidence is
 * thin or ambiguous. Accepts raw HTML: tags are stripped before scoring.
 */
export function detectLanguage(text: string | undefined): string | undefined {
  if (!text) return undefined;

  const tokens = text
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .split(/[^a-zà-ÿœ]+/i)
    .filter(Boolean)
    .slice(0, 400);
  if (tokens.length < MIN_HITS) return undefined;

  let best: { lang: string; hits: number } = { lang: '', hits: 0 };
  let second = 0;
  for (const [lang, words] of STOPWORDS) {
    let hits = 0;
    for (const token of tokens) if (words.has(token)) hits++;
    if (hits > best.hits) {
      second = best.hits;
      best = { lang, hits };
    } else if (hits > second) {
      second = hits;
    }
  }

  if (best.hits < MIN_HITS) return undefined;
  if (second > 0 && best.hits < second * LEAD_FACTOR) return undefined;
  return best.lang;
}
