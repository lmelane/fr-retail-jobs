import { describe, expect, it } from 'vitest';
import { parseJibePage } from './jibe.js';

/** Une entrée telle que careers.ulta.com/api/jobs la rend (capturée le 2026-09-06, description abrégée). */
const PAGE = {
  totalCount: 9959,
  jobs: [
    {
      data: {
        slug: '515485',
        language: 'en-us',
        client_code: 'ulta',
        req_id: '515485',
        title: 'Specialty Beauty Advisor - Lancome',
        description:
          '<br><br><strong>OVERVIEW</strong><br><br><p style="margin: 0px;"><span>Experience a place of energy, passion, and excitement.</span></p>',
        location_name: 'Lakewood, Colorado',
        city: 'Lakewood',
        state: 'Colorado',
        country: 'United States',
        country_code: 'US',
        postal_code: '80226',
        latitude: 39.7047,
        longitude: '-105.0814',
        department: 'Retail',
        hiring_organization: 'Ulta Beauty',
        posted_date: '2026-09-05T23:46:00+0000',
        posting_expiry_date: '2026-12-05T23:46:00+0000',
        apply_url: 'https://fdcnmcareers-ulta.icims.com/jobs/515485/login',
        full_location: 'Lakewood, Colorado, US',
        meta_data: { canonical_url: 'https://careers.ulta.com/careers/jobs/515485?lang=en-us' },
      },
    },
  ],
};

describe('parseJibePage', () => {
  it('lit identifiant, titre, lieu structuré, dates et description sans balises', () => {
    const [job] = parseJibePage(PAGE, 'https://careers.ulta.com');
    expect(job.externalId).toBe('515485');
    expect(job.title).toBe('Specialty Beauty Advisor - Lancome');
    expect(job.location).toBe('Lakewood, Colorado, US');
    expect(job.city).toBe('Lakewood');
    expect(job.region).toBe('Colorado');
    expect(job.country).toBe('US');
    expect(job.latitude).toBeCloseTo(39.7047);
    expect(job.longitude).toBeCloseTo(-105.0814);
    expect(job.postedAt?.toISOString()).toBe('2026-09-05T23:46:00.000Z');
    expect(job.validThrough?.toISOString()).toBe('2026-12-05T23:46:00.000Z');
    expect(job.description).toContain('Experience a place of energy');
    expect(job.description).not.toContain('<');
    expect(job.company).toBe('Ulta Beauty');
  });

  it("pointe sur la page publique de l'offre, jamais sur la page de connexion iCIMS", () => {
    const [job] = parseJibePage(PAGE, 'https://careers.ulta.com');
    expect(job.url).toBe('https://careers.ulta.com/careers/jobs/515485?lang=en-us');
    expect(job.url).not.toContain('/login');
  });

  it("construit l'URL depuis le slug quand le portail ne donne pas de canonique", () => {
    const page = { jobs: [{ data: { ...PAGE.jobs[0].data, meta_data: undefined } }] };
    const [job] = parseJibePage(page, 'https://careers.ulta.com');
    expect(job.url).toBe('https://careers.ulta.com/careers/jobs/515485?lang=en-us');
  });

  it('ignore une entrée sans identifiant ni titre plutôt que de produire une ligne vide', () => {
    expect(parseJibePage({ jobs: [{ data: { title: 'Sans id' } }, { data: { req_id: '1' } }, {}] }, 'https://x')).toHaveLength(0);
  });

  it('rend une liste vide pour une page vide (la réponse sans cookie de session)', () => {
    expect(parseJibePage({ jobs: [], totalCount: 0 }, 'https://x')).toHaveLength(0);
  });
});

// ——— l2 (2026-09-06) : Ulta publie le contrat et le temps dans `tags1` / `tags2` (9 959 offres sans contrat) ———
import { readEmployment } from '../../normalize/employment.js';

describe('parseJibePage — l2 : contrat et temps depuis les tags', () => {
  const withTags = (tags: Record<string, string[]>) => ({ jobs: [{ data: { ...PAGE.jobs[0].data, ...tags } }] });

  it('lit « Regular » (contrat) et « Part Time » (temps) dans les tags', () => {
    const [job] = parseJibePage(withTags({ tags1: ['Part Time'], tags2: ['Regular'] }), 'https://careers.ulta.com');
    expect(readEmployment(job.contract).employmentTerm).toBe('PERMANENT');
    expect(readEmployment(job.workingTime).workTime).toBe('PART_TIME');
  });

  it('ignore les tags qui ne nomment ni un contrat ni un temps (date, enseigne, région)', () => {
    const [job] = parseJibePage(withTags({ tags1: ['9/4/2026'], tags4: ['Kids Foot Locker'], tags9: ['North America'] }), 'https://x');
    expect(job.contract).toBeUndefined();
    expect(job.workingTime).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LE CONTRAT CANONIQUE — `req_id` (à défaut `slug`) EST l'`externalId` écrit.
//
// Retirer `canonicalIds` de la preuve fait tomber ces témoins : sans la propriété,
// `normalizeAdapterResult` classe la source « contrat non implémenté » et aucune absence n'y est
// démontrable (`UNVERIFIABLE` à la prévisualisation).
// ---------------------------------------------------------------------------
import { vi, beforeEach } from 'vitest';
vi.mock('../../lib/http.js', () => ({
  fetchJson: vi.fn(),
  fetchWithRetry: vi.fn(async () => ({ text: async () => '', headers: new Headers() })),
}));
import { fetchJson } from '../../lib/http.js';
import { fetchJibeJobs, jibeCanonicalId } from './jibe.js';

const api = vi.mocked(fetchJson);
const entry = (over: Record<string, unknown>) => ({ data: { ...PAGE.jobs[0].data, ...over } });

describe('Jibe — identifiants canoniques', () => {
  beforeEach(() => api.mockReset());

  it('déclare canonicalIds sur CHAQUE page de preuve, identiques aux externalId produits', async () => {
    api.mockResolvedValueOnce({ totalCount: 2, jobs: [entry({ req_id: 'A', slug: 'a' })] } as never)
       .mockResolvedValueOnce({ totalCount: 2, jobs: [entry({ req_id: 'B', slug: 'b' })] } as never);
    const r = await fetchJibeJobs({ origin: 'https://careers.ulta.com', pageSize: 1 });
    // PRÉMISSE : deux pages de preuve, sans quoi ce témoin n'exercerait pas la règle « tout ou rien ».
    expect(r.enumeration?.pageEvidence).toHaveLength(2);
    expect(r.enumeration!.pageEvidence!.every((pe) => Object.hasOwn(pe, 'canonicalIds'))).toBe(true);
    const canonical = r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? []);
    expect([...canonical].sort()).toEqual(r.jobs.map((j) => j.externalId).sort());
    expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(true);
  });

  it("une entrée VUE mais sans titre garde son identifiant : disposition, pas trou", async () => {
    api.mockResolvedValue({ totalCount: 1, jobs: [entry({ req_id: 'A' }), entry({ req_id: 'ORPHELINE', title: '' })] } as never);
    const r = await fetchJibeJobs({ origin: 'https://careers.ulta.com' });
    // PRÉMISSE : l'entrée orpheline porte bien un identifiant exploitable, mais aucun titre.
    expect(jibeCanonicalId({ req_id: 'ORPHELINE', title: '' } as never)).toBe('ORPHELINE');
    const canonical = r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? []);
    expect(canonical).toContain('ORPHELINE');                           // observée
    expect(r.jobs.map((j) => j.externalId)).not.toContain('ORPHELINE'); // non produite
    expect(r.rejectedRows?.find((x) => (x as { canonicalId?: string }).canonicalId === 'ORPHELINE')?.reason)
      .toBe('MISSING_TITLE_OR_REPEATED_ID');
  });

  it("une entrée SANS req_id ni slug interdit toute preuve d'absence", async () => {
    api.mockResolvedValue({ totalCount: 1, jobs: [entry({ req_id: 'A' }), entry({ req_id: undefined, slug: undefined })] } as never);
    const r = await fetchJibeJobs({ origin: 'https://careers.ulta.com' });
    expect(r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? [])).toEqual(['A']);
    expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(false);
  });
});
