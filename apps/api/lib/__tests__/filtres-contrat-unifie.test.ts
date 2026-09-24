import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { getJobs } from '../jobs';
import { getCompanies } from '../companies';

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const prefix = 'test-contrat-unifie';
const maison = 'Maison Contrats Unifiés';
const cas = [
  { id: 'cdi', employmentTerm: 'PERMANENT' },
  { id: 'cdd', employmentTerm: 'FIXED_TERM' },
  { id: 'stage', programType: 'INTERNSHIP' },
  { id: 'alternance-cdi', employmentTerm: 'PERMANENT', programType: 'APPRENTICESHIP' },
  { id: 'freelance', engagementType: 'FREELANCE' },
  { id: 'absent' },
];
const chercher = (contrat?: string[]) => getJobs({ marche: 'FR', filtres: { maison: [maison], ...(contrat ? { contrat } : {}) } });
const ids = (r: Awaited<ReturnType<typeof chercher>>) => r.jobs.map(j => j.id.replace(`${prefix}-`, '')).sort();

describe.skipIf(!enabled)('le menu contrat projette des faits, sans élargissement ni doublon', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: prefix } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.company.deleteMany({ where: { id: prefix } });
    await prisma.directOffer.deleteMany({ where: { id: prefix } });
  };
  beforeAll(async () => {
    await nettoyer();
    await prisma.company.create({ data: { id: prefix, name: maison, canonicalKey: prefix, fashionjobsUrl: `resolved:${prefix}` } });
    for (const row of cas) {
      const { id, ...faits } = row;
      const lien = `https://example.com/${prefix}/${id}`;
      await prisma.job.create({ data: {
        id: `${prefix}-${id}`, companyId: prefix, source: 'GENERIC_JSONLD', externalId: id,
        title: id, url: lien, countryCode: 'FR', isActive: true, ...faits,
        sources: { create: { sourceKey: prefix, sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, isActive: true,
          ...publicationFixture({ sourceKey: prefix, sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, title: id, country: 'FR', ...faits }) } },
      } });
    }
    await prisma.job.create({ data: {
      id: `${prefix}-ca`, companyId: prefix, source: 'GENERIC_JSONLD', externalId: 'ca', title: 'Conseiller Canada',
      url: 'https://example.com/ca', countryCode: 'CA', isActive: true,
      sources: { create: { sourceKey: prefix, sourceTier: 'ATS_OFFICIAL', externalId: 'ca', url: 'https://example.com/ca', isActive: true,
        ...publicationFixture({ sourceKey: prefix, sourceTier: 'ATS_OFFICIAL', externalId: 'ca', url: 'https://example.com/ca', title: 'Conseiller Canada', country: 'CA' }) } },
    } });
    await prisma.directOffer.create({ data: { id: prefix, version: 1n, appliedSeq: 1n, eligible: true, payloadHash: prefix, payload: {},
      correspondanceVersion: 1, slug: prefix, title: 'Stage direct', company: maison, countryCode: 'FR', location: 'Paris', description: 'Stage direct', postedAt: new Date(), programType: 'INTERNSHIP',
      sectorCodes: [], modifiedAt: new Date(), applyUrl: `https://catwalks.io/offres/${prefix}` } });
  });
  afterAll(nettoyer);

  it('Stage ne renvoie que les stages des deux origines, Catwalks en premier', async () => {
    const r = await chercher(['INTERNSHIP']);
    expect(r.total).toBe(2);
    expect(r.jobs.map(j => j.id)).toEqual([`cw_${prefix}`, `${prefix}-stage`]);
    expect(r.jobs.map(j => j.candidature.type)).toEqual(['CATWALKS', 'EXTERNE']);
    expect(r.facettes.map(f => f.cle)).not.toContain('programme');
  });
  it('Alternance, Freelance et CDI sont retrouvables sans réécrire les faits', async () => {
    expect(ids(await chercher(['APPRENTICESHIP']))).toEqual(['alternance-cdi']);
    expect(ids(await chercher(['FREELANCE']))).toEqual(['freelance']);
    expect(ids(await chercher(['PERMANENT']))).toEqual(['alternance-cdi', 'cdi']);
    const union = await chercher(['PERMANENT', 'APPRENTICESHIP']);
    expect(union.total).toBe(2);
    expect(new Set(union.jobs.map(j => j.id)).size).toBe(2);
  });
  it('les comptes des options excluent leur propre sélection et restent factuels', async () => {
    const r = await chercher(['FREELANCE']);
    expect(r.facettes.find(f => f.cle === 'contrat')?.options).toEqual(expect.arrayContaining([
      { value: 'PERMANENT', label: 'CDI', count: 2 }, { value: 'INTERNSHIP', label: 'Stage', count: 2 },
      { value: 'APPRENTICESHIP', label: 'Alternance', count: 1 }, { value: 'FREELANCE', label: 'Freelance', count: 1 },
    ]));
    expect((await chercher()).total).toBe(7);
    expect((await chercher(['INVENTED'])).total).toBe(0);
  });
  it('l’annuaire CA garde son corpus quand sa présentation passe en français', async () => {
    const en = await getCompanies({ marche: 'CA', q: maison, locale: 'en' });
    const fr = await getCompanies({ marche: 'CA', q: maison, locale: 'fr' });
    expect(en.total).toBe(1);
    expect(fr.companies.map(c => [c.id, c.jobCount])).toEqual(en.companies.map(c => [c.id, c.jobCount]));
    expect(fr.perimetre.code).toBe('CA');
    expect(en.facettes.find(f => f.cle === 'secteur')?.libelle).toBe('Sector');
    expect(fr.facettes.find(f => f.cle === 'secteur')?.libelle).toBe('Secteur');
    expect(en.facettes.find(f => f.cle === 'secteur')?.options.map(o => [o.value, o.count]))
      .toEqual(fr.facettes.find(f => f.cle === 'secteur')?.options.map(o => [o.value, o.count]));
  });

});
