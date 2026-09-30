import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { prisma } from '@catwalks/db';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { lireBornesExamen } from '../examen-alerte';
import { examinerAlerte, getJobs, type JobFilters } from '../jobs';
import { drainSearchIndex, initializeSearchIndex } from '../search-index';

/**
 * R-130 §3 (D-464 §1, D-465) — L'EXAMEN D'UNE ALERTE PAR LE BACKEND.
 *
 *  - réservé à la clé du backend : la clé du site y est refusée (D-464 §3) ;
 *  - deux bornes obligatoires : sans elles, tout le stock passerait pour nouveau ;
 *  - « nouvelle » = entrée au catalogue APRÈS le filigrane ET publiée après la borne, ou sans date de publication ;
 *    une offre ancienne découverte tard n'est jamais nouvelle ;
 *  - le total est celui de `/emplois` pour la même recherche (R-128 §2 : l'alerte rejoue la page).
 */

describe('les bornes de l’examen', () => {
  const maintenant = new Date('2026-10-01T05:30:00Z');
  const p = (q: string) => new URLSearchParams(q);

  it('refuse une borne absente, illisible ou un filigrane futur', () => {
    expect(lireBornesExamen(p(''), maintenant).ok).toBe(false);
    expect(lireBornesExamen(p('entreeApres=2026-09-30T05:30:00Z'), maintenant).ok).toBe(false);
    expect(lireBornesExamen(p('entreeApres=hier&publieeApres=2026-09-01T00:00:00Z'), maintenant).ok).toBe(false);
    expect(lireBornesExamen(p('entreeApres=2026-10-02T05:30:00Z&publieeApres=2026-09-01T00:00:00Z'), maintenant).ok).toBe(false);
    expect(lireBornesExamen(p('entreeApres=1970-01-01T00:00:00Z&publieeApres=2026-09-01T00:00:00Z'), maintenant).ok).toBe(false);
  });

  it('lit deux dates ISO', () => {
    const b = lireBornesExamen(p('entreeApres=2026-09-30T05:30:00.000Z&publieeApres=2026-09-01T05:30:00%2B02:00'), maintenant);
    expect(b).toEqual({ ok: true, entreeApres: new Date('2026-09-30T05:30:00.000Z'), publieeApres: new Date('2026-09-01T03:30:00Z') });
  });
});

describe('la route de l’examen est réservée au backend', () => {
  beforeEach(() => {
    vi.stubEnv('CATALOGUE_API_KEY', 'cle-du-site');
    vi.stubEnv('CATALOGUE_API_KEY_BACKEND', 'cle-du-backend');
  });
  afterEach(() => vi.unstubAllEnvs());

  const appeler = async (autorisation: string) => {
    const { GET } = await import('../../app/api/alertes/examen/route');
    return GET(new NextRequest('http://catalogue.test/api/alertes/examen?marche=FR', { headers: { authorization: autorisation } }));
  };

  it('refuse la clé du site, accepte celle du backend jusqu’au contrôle des bornes', async () => {
    expect((await appeler('Bearer cle-du-site')).status).toBe(401);
    // La clé du backend passe le garde ; sans bornes, la route répond 400 AVANT toute requête en base.
    const r = await appeler('Bearer cle-du-backend');
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/entreeApres/);
  });

  it('le fichier de la route ne nomme que le backend', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'alertes', 'examen', 'route.ts'), 'utf8');
    expect(source).toContain("['backend']");
    expect(source).not.toMatch(/['"]site['"]/);
  });
});

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const prefixe = 'examen-r130-';
const groupe = 'Groupe Examen R130';
const FILIGRANE = new Date('2026-09-29T05:30:00Z');
const EXAMEN = new Date('2026-09-30T05:30:00Z');
const IL_Y_A_30_JOURS = new Date(EXAMEN.getTime() - 30 * 24 * 3600 * 1000);

/** Chaque offre témoin : quand elle est entrée au catalogue, quand la source l'a publiée, et ce qu'on attend. */
const CAS = [
  { id: 'ancienne-entree', entree: '2026-09-20T18:00:00Z', publiee: '2026-09-19T00:00:00Z', nouvelle: false },
  { id: 'recente', entree: '2026-09-29T18:00:00Z', publiee: '2026-09-28T00:00:00Z', nouvelle: true },
  { id: 'sans-date', entree: '2026-09-29T18:10:00Z', publiee: null, nouvelle: true },
  { id: 'vieille-decouverte-tard', entree: '2026-09-29T18:20:00Z', publiee: '2026-07-01T00:00:00Z', nouvelle: false },
  { id: 'publiee-il-y-a-29-jours', entree: '2026-09-29T18:30:00Z', publiee: '2026-09-01T06:00:00Z', nouvelle: true },
] as const;

describe.skipIf(!enabled)('l’examen sur une base locale dédiée', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { job: { id: { startsWith: prefixe } } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: prefixe } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: prefixe } } });
  };
  beforeAll(async () => {
    await nettoyer();
    await prisma.company.create({ data: { id: `${prefixe}maison`, name: `${prefixe}maison`, canonicalKey: `${prefixe}maison`,
      fashionjobsUrl: `resolved:${prefixe}maison`, sector: 'LUXURY', parentGroup: groupe } });
    for (const c of CAS) {
      const postedAt = c.publiee ? new Date(c.publiee) : null;
      await prisma.job.create({ data: { id: `${prefixe}${c.id}`, companyId: `${prefixe}maison`, externalId: c.id, source: 'GENERIC_JSONLD',
        title: 'Conseiller de vente', url: `https://example.com/${c.id}`, isActive: true, postedAt, countryCode: 'FR', firstSeenAt: new Date(c.entree) } });
      await prisma.jobSource.create({ data: { jobId: `${prefixe}${c.id}`, sourceKey: 'examen-r130', sourceTier: 'ATS_OFFICIAL', externalId: c.id,
        url: `https://example.com/${c.id}`, isActive: true,
        ...publicationFixture({ sourceKey: 'examen-r130', sourceTier: 'ATS_OFFICIAL', externalId: c.id, url: `https://example.com/${c.id}`,
          title: 'Conseiller de vente', postedAt: postedAt ?? undefined, country: 'FR' }) } });
    }
    await initializeSearchIndex();
    while (await drainSearchIndex()) { /* index à jour */ }
  });
  afterAll(nettoyer);

  const filtres = (extra: Partial<JobFilters> = {}): JobFilters => ({ marche: 'FR', filtres: { groupe: [groupe] }, ...extra });

  it('PRÉMISSE : chaque cas se place bien du côté attendu des deux bornes', () => {
    for (const c of CAS) {
      const entreeApres = new Date(c.entree) > FILIGRANE;
      const publieeApres = c.publiee === null || new Date(c.publiee) >= IL_Y_A_30_JOURS;
      expect(entreeApres && publieeApres, c.id).toBe(c.nouvelle);
    }
    // Le cas « découverte tard » est entré après le filigrane : seule la borne de publication l'écarte.
    expect(new Date(CAS[3].entree) > FILIGRANE).toBe(true);
  });

  it('ne compte comme nouvelles que les offres entrées après le filigrane et récentes ou sans date', async () => {
    const r = await examinerAlerte(filtres(), FILIGRANE, IL_Y_A_30_JOURS);
    const attendues = CAS.filter((c) => c.nouvelle).map((c) => `${prefixe}${c.id}`).sort();
    expect(r.nouvelles).toBe(attendues.length);
    expect(r.jobs.map((j) => j.id).sort()).toEqual(attendues);
    expect(r.total).toBe(CAS.length);
  });

  it('rend le même total que /emplois pour la même recherche', async () => {
    for (const extra of [{}, { q: 'Conseiller' }, { lieu: 'Paris' }] as Partial<JobFilters>[]) {
      const page = await getJobs(filtres(extra));
      const examen = await examinerAlerte(filtres(extra), FILIGRANE, IL_Y_A_30_JOURS);
      expect(examen.total).toBe(page.total);
    }
  });

  it('la route rend le chemin de chaque fiche, calculé par offerPath', async () => {
    vi.stubEnv('CATALOGUE_API_KEY_BACKEND', 'cle-du-backend');
    try {
      const { GET } = await import('../../app/api/alertes/examen/route');
      const qs = new URLSearchParams({ marche: 'FR', groupe: groupe, entreeApres: FILIGRANE.toISOString(), publieeApres: IL_Y_A_30_JOURS.toISOString() });
      const r = await GET(new NextRequest(`http://catalogue.test/api/alertes/examen?${qs}`, { headers: { authorization: 'Bearer cle-du-backend' } }));
      expect(r.status).toBe(200);
      const corps = await r.json();
      expect(corps.nouvelles).toBe(3);
      expect(corps.jobs.map((j: { chemin: string }) => j.chemin).sort()).toEqual(
        CAS.filter((c) => c.nouvelle).map((c) => `/emplois/conseiller-de-vente-${prefixe}${c.id}`).sort());
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('un filigrane postérieur à toutes les entrées ne rend aucune nouvelle', async () => {
    const r = await examinerAlerte(filtres(), EXAMEN, IL_Y_A_30_JOURS);
    expect(r.nouvelles).toBe(0);
    expect(r.jobs).toEqual([]);
    expect(r.total).toBe(CAS.length);
  });

  it('ignore le pays du visiteur et le curseur (une alerte ne les connaît pas)', async () => {
    const r = await examinerAlerte(filtres({ prioritePays: 'MC', apres: 'nimporte-quoi' }), FILIGRANE, IL_Y_A_30_JOURS);
    expect(r.nouvelles).toBe(3);
  });
});
