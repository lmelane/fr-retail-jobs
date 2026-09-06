import { describe, it, expect } from 'vitest';
import { addDays, citySlug, fmtDate, fmtIndex, fmtInt, fmtPct, fmtSigned, fmtSignedPct, kebab, naText, parseCitySlug } from '../intelligence/format';
import { intelTitle, jsonLd, TITLE_MAX } from '../intelligence/seo';
import { alpha2FromNumeric, knownAlpha2 } from '../intelligence/country-ids';
import { countryCode } from '../countries';
import { familyOf, functionLabel, isFunctionKey, JOB_FUNCTIONS, sectorLabel, seniorityLabel } from '../intelligence/taxonomy';
import { level, thresholds } from '../../components/intelligence/world-map';

describe('formatters (fr-FR)', () => {
  it('formats integers with a NO-BREAK SPACE thousands separator (U+00A0, drawn by every font — U+202F rendered « 71525 » in prod)', () => {
    expect(fmtInt(26112)).toBe('26\u00a0112');
    expect(fmtInt(26112)).not.toContain('\u202f');
  });
  it('formats percentages, signed values and indexes', () => {
    expect(fmtPct(0.342)).toBe('34,2\u00a0%');
    expect(fmtPct(0.342, 0)).toBe('34\u00a0%');
    expect(fmtSigned(12)).toBe('+12');
    expect(fmtSigned(-3)).toBe('−3');
    expect(fmtSignedPct(0.072)).toBe('+7,2\u00a0%');
    expect(fmtIndex(112.37)).toBe('112,4');
  });
  it('formats and shifts ISO dates without timezone drift', () => {
    expect(fmtDate('2026-09-06')).toBe('6 sept. 2026');
    expect(addDays('2026-09-06', 7)).toBe('2026-09-13');
    expect(addDays('2026-09-06', -7)).toBe('2026-08-30');
  });
  it('renders the three n/d reasons', () => {
    expect(naText({ kind: 'insufficient', n: 3 })).toBe('n/d — échantillon insuffisant');
    expect(naText({ kind: 'from', date: '2026-09-13' })).toBe('disponible à partir du 13 sept. 2026');
    expect(naText({ kind: 'none' })).toBe('n/d');
  });
});

describe('slugs', () => {
  it('builds stable accent-free city slugs and parses them back', () => {
    expect(kebab('Saint-Étienne')).toBe('saint-etienne');
    expect(citySlug('FR', 'Le Pré-Saint-Gervais')).toBe('fr-le-pre-saint-gervais');
    expect(citySlug('AE', 'Dubai')).toBe('ae-dubai');
    expect(parseCitySlug('fr-paris')).toEqual({ cc: 'FR', rest: 'paris' });
    expect(parseCitySlug('paris')).toBeNull();
  });
});

describe('SEO helpers', () => {
  it('keeps every title within 60 characters', () => {
    for (const subject of ['Le marché mondial du recrutement luxe', 'Recrutement luxe : Émirats arabes unis', 'Global Hiring Pulse — le marché en chiffres', 'Groupe Estée Lauder Companies : intelligence recrutement', 'x'.repeat(90)]) {
      expect(intelTitle(subject).length).toBeLessThanOrEqual(TITLE_MAX);
    }
    expect(intelTitle('France')).toBe('France · Catwalks Intelligence');
  });
  it('escapes </script> in JSON-LD', () => {
    expect(jsonLd({ a: '</script><b>' })).not.toContain('</script>');
    expect(jsonLd({ a: '</script>' })).toContain('\\u003c/script>');
  });
});

describe('country ids', () => {
  it('maps the world-atlas numeric ids to alpha-2', () => {
    expect(alpha2FromNumeric('250')).toBe('FR');
    expect(alpha2FromNumeric(840)).toBe('US');
    expect(alpha2FromNumeric('004')).toBe('AF');
    expect(alpha2FromNumeric('999')).toBeNull();
    expect(knownAlpha2()).toHaveLength(249);
  });
  it('folds French and English spellings onto ISO codes (Intl reverse lookup)', () => {
    expect(countryCode('Japon')).toBe('JP');
    expect(countryCode('Allemagne')).toBe('DE');
    expect(countryCode('Arabie saoudite')).toBe('SA');
    expect(countryCode('Corée, République de')).toBe('KR');
    expect(countryCode('Hong Kong, RAS Chine')).toBe('HK');
    expect(countryCode("États-Unis d'Amérique")).toBe('US');
    expect(countryCode('Nowhere Land')).toBeNull();
  });
});

describe('taxonomy', () => {
  it('has the 25 functions of the pipeline with a family each', () => {
    expect(JOB_FUNCTIONS).toHaveLength(25);
    expect(isFunctionKey('retail-client-advisor')).toBe(true);
    expect(familyOf('atelier-craft')).toBe('craft');
    expect(familyOf('finance')).toBe('corporate');
    expect(familyOf(null)).toBeNull();
    expect(functionLabel(null)).toBe('Non classé');
    expect(functionLabel('nope')).toBe('Non classé');
    expect(seniorityLabel('EXECUTIVE')).toBe('Dirigeant');
    expect(sectorLabel('SUPPLIER')).toBe('Autres');
  });
});

describe('world map buckets', () => {
  it('splits positive values into five quantile levels and keeps zero out', () => {
    const th = thresholds([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(th).toHaveLength(4);
    expect(level(0, th)).toBe(-1);
    expect(level(1, th)).toBe(0);
    expect(level(10, th)).toBe(4);
    expect(thresholds([0, 0])).toEqual([]);
  });
});
