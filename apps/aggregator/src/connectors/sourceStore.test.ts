import { describe, expect, it } from 'vitest';
import { tenantKeyOf } from './sourceStore.js';
describe('tenantKeyOf — Workday : le tenant seul n’identifie pas un feed', () => {
  /**
   * Mesuré le 2026-09-04 : les trois boards Uniqlo du tenant `fastretailing`
   * s'écrasaient sur une seule clé, et les 107 offres boutiques + 11 graduate
   * étaient rejetées comme doublons du siège (20 offres). Idem chez Capri :
   * Michael Kors (519) et Jimmy Choo (50) écartés au profit de Versace (52).
   * La clé empêche de re-télécharger LE MÊME feed, pas d'en lire deux vrais.
   */
  const wd = (tenant: string, site: string) =>
    tenantKeyOf('workday', JSON.stringify({ tenant, site, origin: `https://${tenant}.wd3.myworkdayjobs.com` }));

  it('deux sites du même tenant sont deux feeds distincts', () => {
    expect(wd('fastretailing', 'headquarters_eu_Uniqlo')).not.toBe(wd('fastretailing', 'store_staff_eu_Uniqlo'));
    expect(wd('capri', 'Versace')).not.toBe(wd('capri', 'Michael_Kors'));
  });

  it('le même tenant + le même site restent une seule clé', () => {
    expect(wd('mango', 'Mango_Work_Your_Passion')).toBe(wd('mango', 'Mango_Work_Your_Passion'));
  });

  it('un Workday sans site retombe sur le comportement générique', () => {
    expect(tenantKeyOf('workday', JSON.stringify({ tenant: 'acme' }))).toBe('workday:acme');
  });
})

describe('tenantKeyOf — Eightfold : le domain est le tenant, pas l’hôte', () => {
  /**
   * Mesuré le 2026-09-06 : dr-jart-13 et estee-lauder-companies pointaient le
   * même domain=elcompanies.com via deux origins différents, et passaient pour
   * deux tenants — le même feed de 1 441 offres visité deux fois par run.
   */
  it('deux origins du même domain Eightfold donnent une seule clé', () => {
    const a = tenantKeyOf('eightfold', JSON.stringify({ origin: 'https://careers.elcompanies.com', domain: 'elcompanies.com' }));
    const b = tenantKeyOf('eightfold', JSON.stringify({ origin: 'https://elcompanies.eightfold.ai', domain: 'elcompanies.com' }));
    expect(a).toBe(b);
    expect(a).toBe('eightfold:elcompanies.com');
  });
});
