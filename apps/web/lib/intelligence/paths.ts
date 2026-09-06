import { companySlug } from '@/lib/company-slug';
import { citySlug, kebab } from './format';
import { SECTOR_SLUGS, isSector } from './taxonomy';

/** URLs stables en français sans accent — un seul endroit les compose. */
export const intelPaths = {
  home: '/intelligence',
  market: '/intelligence/marche',
  geographies: '/intelligence/geographies',
  functions: '/intelligence/metiers',
  sectors: '/intelligence/secteurs',
  methodology: '/intelligence/methodologie',
  country: (code: string) => `/intelligence/pays/${code.toUpperCase()}`,
  city: (code: string, city: string) => `/intelligence/villes/${citySlug(code, city)}`,
  fn: (key: string) => `/intelligence/metiers/${key}`,
  company: (name: string) => `/intelligence/maisons/${companySlug(name)}`,
  group: (name: string) => `/intelligence/groupes/${kebab(name)}`,
  sector: (value: string) => `/intelligence/secteurs#${isSector(value) ? SECTOR_SLUGS[value] : 'autres'}`,
  /** Le moteur d'offres, filtré (paramètres réels de `parseFilters`). */
  jobs: (params: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/emplois?${qs}` : '/emplois';
  },
};
