import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/offres/[id]/route';
import { getCompanyAside, getSimilarJobs, langueDesLibellesDuPays, resolveOfferParam } from '../jobs';
import type { JobRow } from '../jobs';

/**
 * D-468 §3 — LA FICHE D'UN MANDAT CATWALKS N'A PAS DE BLOC MAISON. « Catwalks » ne nomme pas un employeur commun aux
 * mandats sans Maison publique (D-456 §4) : le bloc « Catwalks recrute sur N postes » comptait tous les mandats, tous
 * métiers confondus. Une offre Catwalks qui affiche sa Maison, elle, garde son bloc. Le site n'affiche l'encadré que
 * si la fiche porte `maison` (`catwalks-website/src/components/emplois/FicheEmploi.tsx`).
 */
vi.mock('../jobs', () => ({
  resolveOfferParam: vi.fn(), getSimilarJobs: vi.fn(), getCompanyAside: vi.fn(), langueDesLibellesDuPays: vi.fn(),
  DatabaseUnavailableError: class extends Error {},
}));
vi.mock('../projection', () => ({ projeterFiche: (job: JobRow) => ({ id: job.id, company: job.company }), projeterLignes: () => [] }));
vi.mock('../job-posting-schema', () => ({ balisage: () => null }));
vi.mock('../offer-url', () => ({ offerPath: () => '/offre/temoin' }));

/** Ce que le compte d'une Maison rendrait : assez d'offres pour que le site affiche l'encadré (`openJobs > 1`). */
const BLOC = { openJobs: 35, cities: 6, countries: 3, domain: null, sector: null, group: null };
const fiche = async (job: Partial<JobRow>) => {
  vi.mocked(resolveOfferParam).mockResolvedValue({ status: 'active', canonicalId: String(job.id), matchedId: String(job.id), job: job as JobRow } as never);
  const reponse = await GET(new NextRequest(`https://example.com/api/offres/${job.id}`), { params: Promise.resolve({ id: String(job.id) }) });
  return { statut: reponse.status, corps: await reponse.json() as { maison: unknown; job: { company: string } } };
};

describe('D-468 §3 — le bloc Maison de la fiche', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    // Hors production et sans clé configurée, la route est désarmée : le témoin porte sur le corps, pas sur la clé.
    vi.stubEnv('CATALOGUE_API_KEY', '');
    vi.mocked(getSimilarJobs).mockResolvedValue([]);
    vi.mocked(langueDesLibellesDuPays).mockReturnValue('fr');
    vi.mocked(getCompanyAside).mockResolvedValue(BLOC);
  });

  it('un mandat Catwalks (employeur affiché « Catwalks ») : pas de bloc, et rien n’est compté', async () => {
    const { statut, corps } = await fiche({ id: 'cw_mandat1', origine: 'CATWALKS', company: 'Catwalks', countryCode: 'FR' });
    // PRÉMISSE : le compte, s'il était demandé, rendrait un bloc que le site afficherait.
    expect(BLOC.openJobs).toBeGreaterThan(1);
    expect(statut).toBe(200);
    expect(corps.job.company).toBe('Catwalks');
    expect(corps.maison).toBeNull();
    expect(getCompanyAside).not.toHaveBeenCalled();
  });

  it('une offre Catwalks qui affiche sa Maison garde son bloc', async () => {
    const { corps } = await fiche({ id: 'cw_maison1', origine: 'CATWALKS', company: 'Maison Témoin', countryCode: 'FR' });
    expect(corps.maison).toEqual(BLOC);
    expect(getCompanyAside).toHaveBeenCalledWith('Maison Témoin');
  });

  it('une offre agrégée garde son bloc, même d’un employeur nommé « Catwalks » : seul un mandat direct en est privé', async () => {
    const { corps } = await fiche({ id: 'agregee1', origine: 'AGREGEE', company: 'Catwalks', countryCode: 'FR' });
    expect(corps.maison).toEqual(BLOC);
    expect(getCompanyAside).toHaveBeenCalledWith('Catwalks');
  });
});
