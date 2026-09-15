import { Prisma } from '@prisma/client';
import { storedAmount } from '@catwalks/db/money';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { at, object, type Evidence, type Fact, type FactStatus } from './types.js';

import type { SalaryBand, SalaryValue } from '@catwalks/db/source-facts';
export type { SalaryBand, SalaryValue } from '@catwalks/db/source-facts';
type Tuple = { path: string; min?: unknown; max?: unknown; currency?: unknown; period?: unknown; periodMeaning?: string; basis?: unknown; label?: string | null };
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
// Time units only. Unknown publisher intervals remain native and are not annualised.
const PERIODS: Record<string, string> = { year: 'YEAR', yearly: 'YEAR', 'per-year-salary': 'YEAR', '1 year': 'YEAR',
  month: 'MONTH', monthly: 'MONTH', 'per-month-salary': 'MONTH', '1 month': 'MONTH',
  hour: 'HOUR', hourly: 'HOUR', 'per-hour-wage': 'HOUR', '1 hour': 'HOUR',
  week: 'WEEK', weekly: 'WEEK', 'per-week-salary': 'WEEK', '1 week': 'WEEK',
  day: 'DAY', daily: 'DAY', 'per-day-wage': 'DAY', '1 day': 'DAY' };

/** Exact paths belonging to this posting. No recursive key search and no salary guesses from magnitude. */
export function readSalary(type: string, raw: unknown): Fact<SalaryValue> {
  if (!object(raw)) return { status: 'INPUT_MISSING', value: null, evidence: [], issues: [] };
  const kind = KIND_TO_ATS[type] ?? type;
  const evidence: Evidence[] = [], tuples: Tuple[] = [], issues: string[] = [], terms: string[] = [];
  const take = (path: string) => { const value = at(raw, path); if (value !== undefined) evidence.push({ path, value }); return value; };
  const fields = (path: string, names: [string, string, string?, string?, string?], extra: Partial<Tuple> = {}) => {
    const [min, max, currency, period, basis] = names;
    tuples.push({ path, min: take(`${path}/${min}`), max: take(`${path}/${max}`),
      currency: currency ? take(`${path}/${currency}`) : undefined, period: period ? take(`${path}/${period}`) : undefined,
      basis: basis ? take(`${path}/${basis}`) : undefined, ...extra });
  };
  const jsonLd = (path: string) => {
    const salary = at(raw, path);
    if (typeof salary === 'string' || typeof salary === 'number') { take(path); issues.push('UNSTRUCTURED_BASE_SALARY'); return; }
    const value = object(salary); if (!value) return;
    const nested = object(value.value);
    const amounts = nested ? `${path}/value` : path;
    const fixed = !nested && (typeof value.value === 'number' || typeof value.value === 'string');
    const minPath = fixed || (nested && nested.minValue == null && nested.value != null) ? `${path}/value${nested ? '/value' : ''}` : `${amounts}/minValue`;
    tuples.push({ path, min: take(minPath), max: take(`${amounts}/maxValue`),
      currency: take(`${path}/currency`), period: take(`${amounts}/unitText`) });
  };
  switch (kind) {
    case 'TEAMTAILOR': jsonLd('/_jobposting/baseSalary'); break;
    case 'ICIMS': jsonLd('/postingEvidence/jobPosting/baseSalary'); break;
    case 'GENERIC_JSONLD': jsonLd('/baseSalary'); break;
    case 'LEVER': fields('/salaryRange', ['min','max','currency','interval']); break;
    case 'RECRUITEE': case 'LVMH_ALGOLIA': fields('/salary', ['min','max','currency','period']); break;
    case 'PERSONIO': fields('/salaryInformation', ['min','max','currencyCode','type']); break;
    case 'WTTJ': fields('', ['salary_minimum','salary_maximum','salary_currency','salary_period']); break;
    case 'MAGNET': fields('/salary', ['min_src','max_src','currency','periodicity','definition']); break;
    case 'PINPOINT': fields('', ['minimum_salary','maximum_salary']); break;
    case 'VOLCANIC': fields('', ['salary_low','salary_high']); break;
    case 'TALENT_FUNNEL': {
      const path = object(at(raw, '/detail/positionProfile/remuneration')) ? '/detail/positionProfile/remuneration' : '/vacancy/remuneration';
      const ranges = at(raw, `${path}/ranges`);
      if (Array.isArray(ranges)) ranges.forEach((range, index) => {
        const value = object(range), prefix = `${path}/ranges/${index}`;
        if (!value) return;
        const fixed = value.type === 'FIXED'; take(`${prefix}/type`);
        tuples.push({ path: prefix, min: take(`${prefix}/${fixed ? 'value' : 'min'}`), max: take(`${prefix}/${fixed ? 'value' : 'max'}`),
          currency: take(`${path}/currency`), period: take(`${path}/interval`), label: text(take(`${path}/description`)) });
      });
      break;
    }
    case 'TALENTVIEW': {
      fields('/detail', ['salary_min','salary_max','salary_currency']);
      // Measured proprietary ID: only 1 has a reviewed meaning in this collector.
      if (tuples[0].currency === 1 || tuples[0].currency === '1') tuples[0].currency = 'EUR';
      break;
    }
    case 'FLATCHR': {
      const displayed = take('/vacancy/show_salary');
      if (displayed !== true) return { status: displayed === false ? 'WITHHELD_BY_SOURCE' : 'NOT_OBSERVED', value: null, evidence, issues: [] };
      const period = take('/vacancy/mensuality');
      fields('/vacancy', ['salary','salary_max','currency'], { period, periodMeaning: typeof period === 'string' ? ({ y: 'YEAR', m: 'MONTH', h: 'HOUR' } as Record<string,string>)[period] : undefined });
      break;
    }
    case 'JIBE': {
      const value = take('/salary_value');
      // The audited feed uses zero placeholders; no positive tuple is qualified yet.
      return { status: value == null || value === 0 || value === '0' ? 'NOT_OBSERVED' : 'UNINTERPRETED', value: null, evidence,
        issues: value === 0 || value === '0' ? ['ZERO_PLACEHOLDER'] : [] };
    }
    case 'ASHBY': {
      if (take('/shouldDisplayCompensationOnJobPostings') === false) return { status: 'WITHHELD_BY_SOURCE', value: null, evidence, issues: [] };
      const compensation = object(at(raw, '/compensation'));
      const tiers = Array.isArray(compensation?.compensationTiers) ? compensation.compensationTiers : [];
      const readComponents = (components: unknown, prefix: string, label: string | null) => {
        if (!Array.isArray(components)) return;
        components.forEach((component, index) => {
          if (object(component)?.compensationType !== 'Salary') return;
          const path = `${prefix}/${index}`; take(`${path}/compensationType`);
          fields(path, ['minValue','maxValue','currencyCode','interval'], { label });
        });
      };
      if (tiers.length) tiers.forEach((tier, index) => {
        const entry = object(tier); const prefix = `/compensation/compensationTiers/${index}`;
        const label = text(entry?.title); if (label) evidence.push({ path: `${prefix}/title`, value: entry!.title });
        readComponents(entry?.components, `${prefix}/components`, label);
      });
      else readComponents(compensation?.summaryComponents, '/compensation/summaryComponents', null);
      break;
    }
    default: return { status: 'UNINTERPRETED', value: null, evidence: [], issues: ['SALARY_READER_NOT_QUALIFIED'] };
  }
  let problem: FactStatus | undefined;
  const amount = (value: unknown): string | null => {
    if (value == null || value === '') return null;
    if (typeof value !== 'number' && typeof value !== 'string') { problem = 'UNINTERPRETED'; issues.push('UNINTERPRETED_AMOUNT'); return null; }
    if (typeof value === 'string' && !/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())) {
      terms.push(value); issues.push('NON_NUMERIC_SALARY_TERM'); return null;
    }
    try { const decimal = storedAmount(value); if (decimal?.isZero()) { issues.push('ZERO_PLACEHOLDER'); return null; } return decimal?.toString() ?? null; }
    catch { problem = 'INVALID'; issues.push('AMOUNT_OUTSIDE_EXACT_STORAGE'); return null; }
  };
  const bands: SalaryBand[] = [];
  for (const tuple of tuples) {
    const min = amount(tuple.min), max = amount(tuple.max);
    if (!min && !max) continue;
    if (min && max && new Prisma.Decimal(min).gt(max)) { problem = 'CONFLICT'; issues.push('INVERTED_RANGE'); continue; }
    const currency = text(tuple.currency)?.toUpperCase() ?? null;
    const validCurrency = currency && /^[A-Z]{3}$/.test(currency) ? currency : null;
    if (tuple.currency != null && !validCurrency) issues.push('UNINTERPRETED_CURRENCY');
    const nativePeriod = text(tuple.period);
    const period = tuple.periodMeaning ?? (nativePeriod ? PERIODS[nativePeriod.toLowerCase()] ?? null : null);
    if (nativePeriod && !period) issues.push('UNINTERPRETED_PERIOD');
    bands.push({ min, max, currency: validCurrency, period, nativePeriod, basis: text(tuple.basis), label: tuple.label ?? null });
  }
  if (problem) return { status: problem, value: null, evidence, issues: [...new Set(issues)] };
  return { status: bands.length || terms.length ? 'DECLARED' : issues.length && !issues.every(issue => issue === 'ZERO_PLACEHOLDER') ? 'UNINTERPRETED' : 'NOT_OBSERVED',
    value: bands.length || terms.length ? { bands, terms: [...new Set(terms)] } : null, evidence, issues: [...new Set(issues)] };
}
