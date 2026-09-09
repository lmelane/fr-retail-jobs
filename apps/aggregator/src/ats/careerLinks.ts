import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';

const signals = JSON.parse(readFileSync(new URL('../../data/discovery-career-signals.json', import.meta.url), 'utf8')) as {
  words: string[]; phrases: string[]; unsegmented: string[]; conditionalWords: string[];
  consumerPatterns: string[]; excludedPatterns: string[]; urlPatterns: string[]; conditionalUrlPatterns: string[];
};
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = (values: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${values.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
const explicit = words([...signals.words, ...signals.phrases]);
const conditional = words(signals.conditionalWords);
const careerUrl = new RegExp(signals.urlPatterns.join('|'), 'iu');
const talentUrl = new RegExp(signals.conditionalUrlPatterns.join('|'), 'iu');
const consumer = new RegExp(signals.consumerPatterns.join('|'), 'iu');
const excluded = new RegExp(signals.excludedPatterns.join('|'), 'iu');
function decoded(value: string) { try { return decodeURIComponent(value); } catch { return value; } }

/** Discovery candidates only, across languages. These links never certify ownership. */
export function careerCandidates(html: string, baseUrl: string) {
  const $ = cheerio.load(html, { scriptingEnabled: false });
  const found = new Map<string, { from: string; to: string; label: string }>();
  $('a[href]').each((_, a) => {
    const label = $(a).text().trim() || $(a).attr('aria-label') || $(a).attr('title') || '';
    const href = $(a).attr('href') ?? '';
    const text = `${label} ${decoded(href)}`.normalize('NFKC');
    const separated = text.replace(/[-_/]+/g, ' ');
    const hasCareer = careerUrl.test(decoded(href)) || explicit.test(separated) || signals.unsegmented.some(term => text.includes(term));
    if (!hasCareer && ((!conditional.test(separated) && !talentUrl.test(href)) || consumer.test(text))) return;
    try {
      const url = new URL(href, baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      if (excluded.test(url.pathname + ' ' + label)) return;
      found.set(url.toString(), { from: baseUrl, to: url.toString(), label });
    } catch { /* Not a navigable URL. */ }
  });
  return [...found.values()];
}
