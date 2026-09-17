import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/http.js')>()),
  fetchJson: vi.fn(), fetchText: vi.fn(),
}));
import { fetchJson } from '../../lib/http.js';
import { fetchPhenomJobs, publicJobUrl } from './phenom.js';
import { normalizeAdapterResult } from '../index.js';

/** Audit A5 (2026-09-06) : 2 842/2 842 liens Foot Locker menaient à une page de login iCIMS. */
describe('publicJobUrl', () => {
  it('remplace l’étape de connexion iCIMS par la fiche publique', () => {
    expect(publicJobUrl('https://us-retail-footlocker.icims.com/jobs/71906/login')).toBe('https://us-retail-footlocker.icims.com/jobs/71906/login'.replace('/login', '/job'));
    expect(publicJobUrl('https://x.icims.com/jobs/71906/login?in_iframe=1')).toBe('https://x.icims.com/jobs/71906/job?in_iframe=1');
  });
  it('laisse une URL de fiche intacte', () => {
    expect(publicJobUrl('https://careers.footlocker.com/job/123')).toBe('https://careers.footlocker.com/job/123');
  });
});

// ——— l2 (2026-09-06) : marque réelle, contrat et temps depuis la charge Phenom (Foot Locker : 1 769 postes US sous « Foot Locker France ») ———
import { parsePhenomJob } from './phenom.js';
import { readEmployment } from '../../normalize/employment.js';

/** Entrée `/api/jobs` de careers.footlocker.com capturée le 2026-09-06 (a4-phenom), champs longs abrégés. */
const FOOT_LOCKER = {
  slug: '71906',
  req_id: '71906',
  title: 'Sales Lead',
  description: '<p>Overview Great brands reflect culture.</p>',
  city: 'Philadelphia',
  state: 'Pennsylvania',
  country: 'United States',
  country_code: 'US',
  postal_code: '19137',
  latitude: 39.99567649999999,
  longitude: -75.0911491,
  tags1: ['9/4/2026'],
  tags2: ['Regular Part-Time'],
  tags4: ['Kids Foot Locker'],
  tags9: ['North America'],
  employment_type: 'PART_TIME',
  hiring_organization: 'Foot Locker',
  posted_date: '2026-09-04T18:16:00+0000',
  apply_url: 'https://us-retail-footlocker.icims.com/jobs/71906/login',
};

describe('parsePhenomJob — l2', () => {
  it('crédite l’offre à l’employeur publié (hiring_organization), pas à la Maison de repli du catalogue', () => {
    const job = parsePhenomJob(FOOT_LOCKER, 'https://careers.footlocker.com', {})!;
    expect(job.company).toBe('Foot Locker');
    expect(job.country).toBe('US');
    expect(job.url).toBe('https://us-retail-footlocker.icims.com/jobs/71906/job');
  });

  it('prend l’enseigne dans le tag désigné par `brandTag` quand la source le configure', () => {
    const job = parsePhenomJob(FOOT_LOCKER, 'https://careers.footlocker.com', { brandTag: 'tags4' })!;
    expect(job.company).toBe('Kids Foot Locker');
  });

  it('lit le contrat dans le tag qui le nomme (Regular → CDI) et le temps dans employment_type (PART_TIME)', () => {
    const job = parsePhenomJob(FOOT_LOCKER, 'https://careers.footlocker.com', {})!;
    expect(readEmployment(job.contract).employmentTerm).toBe('PERMANENT');
    expect(readEmployment(job.workingTime).workTime).toBe('PART_TIME');
  });

  it('sans tag de contrat, employment_type seul reste un temps de travail (pas un faux contrat)', () => {
    const job = parsePhenomJob({ ...FOOT_LOCKER, tags2: undefined }, 'https://x', {})!;
    expect(readEmployment(job.contract).employmentTerm).toBeUndefined();
    expect(readEmployment(job.workingTime).workTime).toBe('PART_TIME');
  });
});

/**
 * LE CONTRAT DES IDENTIFIANTS CANONIQUES (lot 5G3C, suite).
 *
 * `canonicalIds` doit lister les identifiants NATIFS réellement servis — `slug ?? req_id` ici, `jobSeqNo` en
 * CareerConnect — page par page et pour TOUTES les pages : un contrat partiel n'est pas un contrat. Ces témoins
 * passent par `normalizeAdapterResult`, le seul endroit où le contrat est réellement jugé ; retirer
 * `canonicalIds` de l'adaptateur les fait ÉCHOUER (vérifié par retrait puis restauration).
 */
const fetch = vi.mocked(fetchJson);

describe('phenom — contrat des identifiants canoniques', () => {
  beforeEach(() => vi.resetAllMocks());

  it('dialecte /api/jobs : chaque page déclare les identifiants natifs observés, et ils couvrent les offres écrites', async () => {
    fetch.mockResolvedValueOnce({ totalCount: 2, jobs: [{ data: FOOT_LOCKER }, { data: { ...FOOT_LOCKER, slug: '71907', req_id: '71907', title: 'Stock Associate' } }] });
    const result = await fetchPhenomJobs({ origin: 'https://careers.footlocker.com' });

    const pages = result.enumeration!.pageEvidence!;
    expect(pages.length).toBeGreaterThan(0);
    // Toutes les pages déclarent : une seule page muette vaudrait contrat ROMPU.
    expect(pages.every(p => Object.hasOwn(p, 'canonicalIds'))).toBe(true);
    expect(pages.flatMap(p => p.canonicalIds ?? [])).toEqual(['71906', '71907']);
    // Les identifiants observés sont EXACTEMENT ceux des offres publiées.
    expect(pages.flatMap(p => p.canonicalIds ?? []).sort()).toEqual(result.jobs.map(j => j.externalId).sort());
    expect(result.enumeration!.canonicalAbsenceProofUsable).toBe(true);

    // Le contrat est jugé ici, pas dans l'adaptateur : la preuve doit survivre à la normalisation.
    const normalized = normalizeAdapterResult(result);
    expect(normalized.enumeration?.issues ?? []).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
    expect(normalized.enumeration?.canonicalIdViolations).toBeUndefined();
  });

  it('une ligne sans slug ni req_id est comptée ANONYME, jamais nommée par son titre', async () => {
    // `externalId` se replie sur le titre ; un titre n'est pas un identifiant natif et n'entre pas dans la preuve.
    fetch.mockResolvedValueOnce({ totalCount: 2, jobs: [{ data: FOOT_LOCKER }, { data: { ...FOOT_LOCKER, slug: undefined, req_id: undefined, title: 'Sans identifiant' } }] });
    const result = await fetchPhenomJobs({ origin: 'https://careers.footlocker.com' });

    expect(result.enumeration!.pageEvidence!.flatMap(p => p.canonicalIds ?? [])).toEqual(['71906']);
    // La ligne innommable interdit de déclarer une absence, et n'est pas inventée.
    expect(result.enumeration!.canonicalAbsenceProofUsable).toBe(false);
    expect(result.enumeration!.pageEvidence![0].canonicalIds).not.toContain('Sans identifiant');
  });

  it('une ligne vue puis écartée faute de titre garde son identifiant comme DISPOSITION', async () => {
    fetch.mockResolvedValueOnce({ totalCount: 2, jobs: [{ data: FOOT_LOCKER }, { data: { ...FOOT_LOCKER, slug: '71908', req_id: '71908', title: undefined } }] });
    // La ligne écartée n'est pas une offre : le total annoncé n'est pas atteint et la lecture continue jusqu'à la page vide.
    fetch.mockResolvedValueOnce({ totalCount: 2, jobs: [] });
    const result = await fetchPhenomJobs({ origin: 'https://careers.footlocker.com' });

    expect(result.enumeration!.pageEvidence!.flatMap(p => p.canonicalIds ?? [])).toEqual(['71906', '71908']);
    expect(result.rejectedRows?.map(r => r.canonicalId)).toEqual(['71908']);
    // Sans cette disposition, « 71908 » serait un identifiant observé orphelin et le contrat tomberait.
    const normalized = normalizeAdapterResult(result);
    expect(normalized.enumeration?.canonicalIdViolations).toBeUndefined();
  });

  it('dialecte CareerConnect : jobSeqNo est l’identifiant canonique, sur toutes les pages', async () => {
    const hugo = { jobSeqNo: 'HUBOGLOBAL143861EXTERNALENGLOBAL', jobId: '143861', title: 'Sales Advisor', city: 'Paris', country: 'France' };
    fetch.mockResolvedValueOnce({ refineSearch: { totalHits: 1, data: { jobs: [hugo] } } });
    const result = await fetchPhenomJobs({ origin: 'https://careers.hugoboss.com', dialect: 'CAREER_CONNECT_WIDGETS' });

    const pages = result.enumeration!.pageEvidence!;
    expect(pages.every(p => Object.hasOwn(p, 'canonicalIds'))).toBe(true);
    expect(pages.flatMap(p => p.canonicalIds ?? [])).toEqual([hugo.jobSeqNo]);
    expect(result.jobs.map(j => j.externalId)).toEqual([hugo.jobSeqNo]);
    expect(normalizeAdapterResult(result).enumeration?.canonicalIdViolations).toBeUndefined();
  });
});
