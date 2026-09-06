import '../test/setup-integration.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resolveDomains } from './resolveDomains.js';
import type { WikidataClaimsResponse, WikidataClient, WikidataSearchResponse } from '../normalize/companyDomain.js';

/**
 * `resolve-domains` de bout en bout sur une base de test : le catalogue donne
 * Sephora, Wikidata (fixtures capturées, aucun réseau) donne Dior, et MAC
 * reste sans domaine — l'initiale plutôt que mac.com, qui n'est pas la marque.
 */
const prisma = new PrismaClient();

function fixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`../normalize/__fixtures__/wikidata/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const calls: string[] = [];
const wikidata: WikidataClient = {
  async search(term, language) {
    calls.push(`search ${term} ${language}`);
    if (term === 'Christian Dior Couture' && language === 'fr') return fixture<WikidataSearchResponse>('search-dior-fr');
    if (term === 'MAC') return fixture<WikidataSearchResponse>(`search-mac-${language}`);
    return { search: [] };
  },
  async officialWebsite(id) {
    calls.push(`claims ${id}`);
    return id === 'Q542767' ? fixture<WikidataClaimsResponse>('claims-dior') : { claims: {} };
  },
};

async function wipe() {
  await prisma.jobSource.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.company.deleteMany({});
  await prisma.source.deleteMany({});
  calls.length = 0;
}

async function seedCompany(name: string, canonicalKey: string, activeJobs: number) {
  const company = await prisma.company.create({
    data: { name, canonicalKey, fashionjobsUrl: `resolved:${canonicalKey}` },
  });
  for (let i = 0; i < activeJobs; i++) {
    await prisma.job.create({
      data: {
        companyId: company.id,
        externalId: `${canonicalKey}-${i}`,
        source: 'GENERIC_JSONLD',
        title: `Poste ${i}`,
        url: `https://x/${canonicalKey}/${i}`,
        clusterKey: `${canonicalKey}|paris`,
        fingerprint: `${canonicalKey}|${i}`,
        isActive: true,
      },
    });
  }
  return company;
}

beforeEach(async () => {
  await wipe();
  await prisma.source.create({
    data: {
      key: 'sephora', maison: 'Sephora', careersDomain: 'jobs.sephora.com', kind: 'successfactors',
      config: {}, tier: 'EMPLOYER_DIRECT', tenantKey: 'successfactors:jobs.sephora.com', status: 'ACTIVE',
    },
  });
  await seedCompany('Sephora', 'SEPHORA', 3);
  await seedCompany('Christian Dior Couture', 'DIOR', 2);
  await seedCompany('MAC', 'MAC', 1);
  // Une Maison sans offre active n'est pas parcourue : elle n'a pas de logo à montrer.
  await seedCompany('Fermée', 'FERMEE', 0);
});
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('resolve-domains', () => {
  it('catalogue d’abord, Wikidata ensuite, rien sinon — et l’écrit', async () => {
    const stats = await resolveDomains(prisma, { wikidata });
    expect(stats.scanned).toBe(3);
    expect(stats.resolved).toEqual({ 'source-careers': 1, wikidata: 1, manual: 0 });
    expect(stats.unresolved).toBe(1);
    expect(stats.written).toBe(2);
    expect(stats.examples.unresolved).toEqual(['MAC']);

    const byName = Object.fromEntries(
      (await prisma.company.findMany({ select: { name: true, domain: true, domainSource: true } })).map((c) => [c.name, c]),
    );
    expect(byName['Sephora']).toMatchObject({ domain: 'sephora.com', domainSource: 'source-careers' });
    expect(byName['Christian Dior Couture']).toMatchObject({ domain: 'dior.com', domainSource: 'wikidata' });
    expect(byName['MAC']).toMatchObject({ domain: null, domainSource: null });
    // Sephora n'a coûté aucune requête ; Dior une recherche + une lecture ; MAC deux recherches.
    expect(calls).toEqual(['search Christian Dior Couture fr', 'claims Q542767', 'search MAC fr', 'search MAC en']);
  });

  it('est idempotente : un second run ne re-parcourt que les non résolues', async () => {
    await resolveDomains(prisma, { wikidata });
    const again = await resolveDomains(prisma, { wikidata });
    expect(again.scanned).toBe(1);
    expect(again.written).toBe(0);
    expect(again.examples.unresolved).toEqual(['MAC']);
  });

  it('--limit prend les Maisons les plus visibles d’abord, --dry-run n’écrit rien', async () => {
    const stats = await resolveDomains(prisma, { wikidata, limit: 1, dryRun: true });
    expect(stats.scanned).toBe(1);
    expect(stats.examples['source-careers']).toEqual(['Sephora → sephora.com']);
    expect(stats.written).toBe(0);
    expect((await prisma.company.findFirstOrThrow({ where: { name: 'Sephora' } })).domain).toBeNull();
  });
});
