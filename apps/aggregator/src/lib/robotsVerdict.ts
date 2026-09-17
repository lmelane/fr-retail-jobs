import { CRAWLER_PRODUCT_TOKEN } from './crawlerIdentity.js';

/** Rule observation only, never an access authorization. RFC 9309 §2.2. */
const MAX_ROBOTS_BYTES = 512_000;
const MAX_PATH_BYTES = 16_384;
const MAX_MATCH_STEPS = 5_000_000;
type Rule = { allow: boolean; pattern: string };
type Group = { agents: string[]; rules: Rule[] };

/** Compare percent-encoded UTF-8, decoding only ASCII unreserved octets. */
function comparisonPath(value: string, pattern: boolean): string {
  let output = '';
  for (let i = 0; i < value.length;) {
    const hex = value.slice(i + 1, i + 3);
    if (value[i] === '%' && /^[a-f\d]{2}$/i.test(hex)) {
      const char = String.fromCharCode(parseInt(hex, 16));
      output += /^[a-z\d._~-]$/i.test(char) ? char : `%${hex.toUpperCase()}`;
      i += 3; continue;
    }
    const code = value.codePointAt(i)!;
    if (code >= 0xd800 && code <= 0xdfff) throw new Error('Invalid robots path encoding');
    const char = String.fromCodePoint(code); i += char.length;
    const operator = pattern && (char === '*' || char === '$' && i === value.length);
    output += !operator && (code > 0x7f || char === '%' || char === '*' || char === '$' || char === ' ')
      ? [...Buffer.from(char)].map(byte => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('') : char;
  }
  return output;
}

/** Wildcard matching without an untrusted regular expression or recursive stack. */
function matches(pattern: string, path: string, budget: { steps: number }): boolean {
  const anchored = pattern.endsWith('$');
  if (anchored) pattern = pattern.slice(0, -1);
  let p = 0, s = 0, star = -1, retry = 0;
  while (true) {
    if (++budget.steps > MAX_MATCH_STEPS) throw new Error('Robots match budget exceeded');
    if (p === pattern.length && (!anchored || s === path.length)) return true;
    if (pattern[p] === '*') { star = p++; retry = s; continue; }
    if (s < path.length && pattern[p] === path[s]) { p++; s++; continue; }
    if (star >= 0 && retry < path.length) { p = star + 1; s = ++retry; continue; }
    return false;
  }
}

/**
 * Observe the rules for our exact product token on pathname + query, preserving
 * case and reserved percent escapes. Matching named groups combine; '*' groups
 * apply only when none names CatwalksBot. An absent body stays NO_ROBOTS.
 * Oversized/invalid input or excessive matching throws; callers must retain an
 * unresolved observation, never turn incomplete evaluation into ALLOWED.
 */
export function robotsVerdictFor(robots: string | null, path: string): 'ALLOWED' | 'DISALLOWED' | 'NO_ROBOTS' {
  if (!path.startsWith('/') || /[\u0000-\u0020\u007f#]/u.test(path) || Buffer.byteLength(path) > MAX_PATH_BYTES) throw new Error('Invalid robots request path');
  if (robots === null) return 'NO_ROBOTS';
  if (Buffer.byteLength(robots) > MAX_ROBOTS_BYTES) throw new Error('Robots document exceeds parsing limit');
  const target = comparisonPath(path, false);
  if (target === '/robots.txt') return 'ALLOWED';
  const groups: Group[] = [];
  let current: Group | null = null, hasRule = false;
  for (const raw of robots.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const field = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!field) continue;
    const name = field[1].toLowerCase(), value = field[2].trim();
    if (name === 'user-agent') {
      if (!/^(?:[a-z_-]+|\*)$/i.test(value)) continue;
      if (!current || hasRule) { current = { agents: [], rules: [] }; groups.push(current); hasRule = false; }
      current.agents.push(value.toLowerCase());
    } else if ((name === 'allow' || name === 'disallow') && current) {
      hasRule = true;
      if (/^[/*][^\u0000-\u0020\u007f]*$/u.test(value)) current.rules.push({ allow: name === 'allow', pattern: value });
    }
    // Unknown records, comments and blank lines do not split a group.
  }
  const named = groups.filter(group => group.agents.includes(CRAWLER_PRODUCT_TOKEN.toLowerCase()));
  const selected = named.length ? named : groups.filter(group => group.agents.includes('*'));
  const budget = { steps: 0 };
  let best: { allow: boolean; length: number } | null = null;
  for (const group of selected) for (const rule of group.rules) {
    const pattern = comparisonPath(rule.pattern, true).replace(/\*+$/, '');
    if (!matches(pattern, target, budget)) continue;
    const length = Buffer.byteLength(pattern);
    if (!best || length > best.length || length === best.length && rule.allow) best = { allow: rule.allow, length };
  }
  return !best || best.allow ? 'ALLOWED' : 'DISALLOWED';
}
