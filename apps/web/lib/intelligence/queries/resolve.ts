import { prisma } from '@catwalks/db';
import { DatabaseUnavailableError } from '@/lib/jobs';
import { companySlug } from '@/lib/company-slug';
import { countryLabel } from '@/lib/countries';
import { cached } from '../cache';
import { allCities, allGroups } from '../facts';
import { citySlug, kebab, parseCitySlug } from '../format';
import { knownAlpha2 } from '../country-ids';

/**
 * Résolution des slugs d'URL vers une entité réelle — jamais l'inverse : une
 * page n'existe que si la base contient le pays, la ville, la Maison ou le
 * groupe demandé. Sinon `null` → 404.
 *
 * Audit I-5 : un slug inconnu coûtait 17 requêtes SQL et UNE entrée de cache
 * par slug (un scanner remplissait le disque). Désormais : la forme du slug
 * est validée avant toute base, et c'est la LISTE des entités qui est
 * mémorisée (une entrée), jamais le résultat par slug.
 */

const ALPHA2 = new Set(knownAlpha2());
/** Un slug : minuscules, chiffres, tirets — 80 caractères au plus. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 80;

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= SLUG_MAX && SLUG_RE.test(slug);
}

/** `fr` / `FR` → { code: 'FR', label: 'France' } si le code est un pays ISO connu. */
export function resolveCountry(param: string): { code: string; label: string } | null {
  if (!/^[A-Za-z]{2}$/.test(param)) return null;
  const code = param.toUpperCase();
  if (!ALPHA2.has(code)) return null;
  return { code, label: countryLabel(code) };
}

const cityIndex = cached('city-index', async (): Promise<Record<string, { code: string; city: string }>> => {
  const out: Record<string, { code: string; city: string }> = {};
  for (const c of await allCities()) out[citySlug(c.code, c.city)] ??= { code: c.code, city: c.city };
  return out;
});

export async function resolveCity(slug: string): Promise<{ code: string; city: string } | null> {
  if (!isValidSlug(slug) || !parseCitySlug(slug)) return null;
  return (await cityIndex())[slug] ?? null;
}

const groupIndex = cached('group-index', async (): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const g of await allGroups()) out[kebab(g)] ??= g;
  return out;
});

export async function resolveGroup(slug: string): Promise<string | null> {
  if (!isValidSlug(slug)) return null;
  return (await groupIndex())[slug] ?? null;
}

export type ResolvedCompany = { id: string; name: string; sector: string | null; parentGroup: string | null; domain: string | null; careersUrl: string | null; identityRevision?: string; identityChangedAt?: string | null };

/**
 * Même règle de slug que `/entreprise/[slug]` (companySlug). En cas
 * d'homonymie, la société qui a le plus d'offres vivantes l'emporte. Un seul
 * index mémorisé pour toutes les Maisons.
 */
const companyIndex = cached('company-index', async (): Promise<Record<string, ResolvedCompany>> => {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    const rows = await prisma.company.findMany({
      select: {
        id: true, name: true, sector: true, parentGroup: true, domain: true, careersUrl: true,
        _count: { select: { jobs: { where: { isActive: true } } } },
      },
    });
    const sorted = [...rows].sort((a, b) => b._count.jobs - a._count.jobs || a.name.localeCompare(b.name, 'fr'));
    const out: Record<string, ResolvedCompany> = {};
    for (const c of sorted) {
      const slug = companySlug(c.name);
      if (!slug || out[slug]) continue;
      out[slug] = { id: c.id, name: c.name, sector: c.sector, parentGroup: c.parentGroup, domain: c.domain, careersUrl: c.careersUrl };
    }
    return out;
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseUnavailableError(error);
  }
});

export async function resolveCompany(slug: string): Promise<ResolvedCompany | null> {
  if (!isValidSlug(slug)) return null;
  const indexed = (await companyIndex())[slug];
  if (!indexed) return null;
  // Read redirect/revision fresh: a cached slug index must not retain an old
  // employer assignment for an hour after a reviewed production repair.
  let company = await prisma.company.findUnique({ where: { id: indexed.id } });
  if (!company) return null;
  const visited = new Set<string>();
  while (company.mergedIntoId) {
    if (visited.has(company.id)) throw new Error('Employer redirect cycle');
    visited.add(company.id);
    company = await prisma.company.findUniqueOrThrow({ where: { id: company.mergedIntoId } });
  }
  const revision = await prisma.dataCorrection.findFirst({
    where: { entityType: 'Company', OR: [{ entityId: company.id }, { after: { path: ['mergedIntoId'], equals: company.id } }] },
    orderBy: { createdAt: 'desc' }, select: { planHash: true },
  });
  const merge = await prisma.dataCorrection.findFirst({
    where: { entityType: 'Company', after: { path: ['mergedIntoId'], equals: company.id } },
    orderBy: { createdAt: 'desc' }, select: { createdAt: true },
  });
  return { id: company.id, name: company.name, sector: company.sector, parentGroup: company.parentGroup, domain: company.domain, careersUrl: company.careersUrl, identityRevision: revision?.planHash, identityChangedAt: merge?.createdAt.toISOString().slice(0, 10) ?? null };
}
