import { htmlToPlainText } from '../lib/html.js';
import { normalizedEmployerName } from '../normalize/employerName.js';
import type { NormalizedJob } from '../types.js';

export type EmployerSubject = { name: string; role: 'EMPLOYER' | 'BRAND' | 'GROUP' };
type Condition = { path: string; equals?: string; startsWith?: string; includes?: string };
export type NativeEmployerRule = {
  id: string;
  employer: EmployerSubject;
  /** Every condition refers to this posting's retained RAW, never a page menu or registry label. */
  when: Condition[];
  /** An explicit native relation, not an alias or a global corporate-tree mutation. */
  brands?: string[];
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const text = (value: string) => (htmlToPlainText(value) ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
const mentionsName = (observed: string, name: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${text(name).toLocaleLowerCase('en').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u').test(observed);
function scalar(raw: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) =>
    (object(value) || Array.isArray(value)) && Object.hasOwn(value, part) ? (value as Record<string, unknown>)[part] : undefined, raw);
}

/** SourceRevision versions these reviewed extraction rules with the rest of the source config.
 * No regex, name guessing, publisher substitution, or arbitrary executable expressions. */
export function nativeEmployerRules(config: Record<string, unknown>): NativeEmployerRule[] {
  const rules = config.nativeEmployerRules;
  if (rules === undefined) return [];
  if (!Array.isArray(rules) || rules.length > 100) throw Error('Invalid nativeEmployerRules');
  const ids = new Set<string>();
  for (const r of rules) {
    if (!object(r) || !onlyKeys(r, ['id', 'employer', 'when', 'brands']) || typeof r.id !== 'string' || !r.id.trim() || r.id.length > 120 || ids.has(r.id) ||
      !object(r.employer) || typeof r.employer.name !== 'string' || !r.employer.name.trim() || r.employer.name.length > 180 ||
      !onlyKeys(r.employer, ['name', 'role']) ||
      !['EMPLOYER', 'BRAND', 'GROUP'].includes(String(r.employer.role)) ||
      !Array.isArray(r.when) || !r.when.length || r.when.length > 8) throw Error('Invalid native employer rule');
    ids.add(r.id);
    for (const c of r.when) {
      if (!object(c) || !onlyKeys(c, ['path', 'equals', 'startsWith', 'includes']) || typeof c.path !== 'string' || c.path.length > 250 || !/^[\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)*$/u.test(c.path) ||
        c.path.split('.').some(p => ['__proto__', 'prototype', 'constructor'].includes(p))) throw Error('Invalid native employer path');
      const ops = ['equals', 'startsWith', 'includes'].filter(k => Object.hasOwn(c, k));
      if (ops.length !== 1 || typeof c[ops[0]] !== 'string' || !text(c[ops[0]] as string) || (c[ops[0]] as string).length > 1200)
        throw Error('Invalid native employer condition');
    }
    if (r.brands !== undefined && (!Array.isArray(r.brands) || r.brands.length > 10 || r.brands.some(b => typeof b !== 'string' || !b.trim() || b.length > 180)))
      throw Error('Invalid native employer brand relation');
  }
  return rules as NativeEmployerRule[];
}

export function applyNativeEmployerRules(job: NormalizedJob, rules: readonly NativeEmployerRule[]): NormalizedJob {
  if (job.publicationHold || !rules.length) return job;
  const matches = rules.flatMap(rule => {
    const witnesses = rule.when.map(condition => {
      const value = scalar(job.raw, condition.path);
      if (typeof value !== 'string') return null;
      const actual = text(value), expected = text(condition.equals ?? condition.startsWith ?? condition.includes!);
      const matches = condition.equals !== undefined ? actual === expected : condition.startsWith !== undefined
        ? actual.startsWith(expected) : actual.includes(expected);
      return matches ? { path: condition.path, quote: expected } : null;
    });
    if (witnesses.some(w => w === null)) return [];
    // A reviewed rule must still witness the names in this posting. A condition
    // on a location or a department code alone cannot manufacture an employer.
    const observed = witnesses.map(w => w!.quote).join('\n').toLocaleLowerCase('en');
    if (![rule.employer.name, ...(rule.brands ?? [])].every(name => mentionsName(observed, name))) return [];
    return [{ rule, witnesses: witnesses as { path: string; quote: string }[] }];
  });
  if (!matches.length) return job;
  // A broad group description cannot erase a directly labelled Maison/legal
  // entity. It supplies an identity only when that more precise fact is absent.
  const specific = matches.filter(m => m.rule.employer.role !== 'GROUP');
  if (!specific.length && job.company) return job;
  const selected = specific.length ? specific : matches;
  const names = new Set(selected.map(m => normalizedEmployerName(m.rule.employer.name)));
  if (new Set(selected.map(m => m.rule.employer.role)).size !== 1)
    return { ...job, publicationHold: 'NATIVE_EMPLOYER_CONFLICT' };
  if (names.size !== 1 || job.company && !names.has(normalizedEmployerName(job.company)))
    return { ...job, publicationHold: 'NATIVE_EMPLOYER_CONFLICT' };
  const { rule } = selected[0];
  const brands = [...new Set(selected.flatMap(m => m.rule.brands ?? []))];
  return { ...job, company: job.company ?? rule.employer.name,
    employerEvidence: { rawName: job.company ?? rule.employer.name, path: selected[0].witnesses[0].path,
      rule: 'REVIEWED_NATIVE_STATEMENT', role: rule.employer.role,
      statements: selected.map(m => ({ ruleId: m.rule.id, witnesses: m.witnesses })),
      ...(brands.length ? { brands } : {}) } };
}
