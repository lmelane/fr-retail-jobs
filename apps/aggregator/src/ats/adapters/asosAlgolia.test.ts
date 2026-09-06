import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));

import { fetchJson, fetchText } from '../../lib/http.js';
import { fetchAsosJobs, parseAsosHit } from './asosAlgolia.js';

const mockJson = vi.mocked(fetchJson);
const mockText = vi.mocked(fetchText);
beforeEach(() => {
  mockJson.mockReset();
  mockText.mockReset();
});

/** Un hit de l'index production__asoscare2201__sort-rank (capturé le 2026-09-06). */
const HIT = {
  opening_date: '04/09/2026',
  opening_date_timestamp: 1788501619,
  title: 'Digital Trading Assistant',
  apply_url: 'https://jobs.smartrecruiters.com/ASOS/744000147479639-digital-trading-assistant?oga=true',
  category: 'Global Commerce',
  description:
    'As a Digital Trading Assistant, you will support the day-to-day management, trading and optimisation of the ASOS website(s) across devices. This includes site merchandising, search optimisation, and building and managing on-site pages.',
  qualifications: '<p><strong>About You </strong></p><ul><li>Organisational and coordination skills</li></ul>',
  team: 'Commercial + Customer',
  objectID: '162272635',
  contract_type: 'Full Time',
  town_city: 'London',
  ats_requisition_id: '744000147479639',
  department: 'Global Commerce',
  jd_url: '/job-search/commercial-customer/global-commerce/london/digital-trading-assistant/744000147479639',
  location: 'Nationwide',
};

describe('parseAsosHit', () => {
  it('lit la ville dans town_city — `location` vaut « Nationwide » sur tous les hits', () => {
    const job = parseAsosHit(HIT)!;
    expect(job.city).toBe('London');
    expect(job.location).toBe('London');
    expect(job.country).toBeUndefined();
  });

  it('résout jd_url (relatif) sur le site public', () => {
    expect(parseAsosHit(HIT)!.url).toBe(
      'https://www.asoscareers.com/job-search/commercial-customer/global-commerce/london/digital-trading-assistant/744000147479639',
    );
  });

  it('assemble description + qualifications en texte brut', () => {
    const job = parseAsosHit(HIT)!;
    expect(job.description).toContain('Digital Trading Assistant, you will support');
    expect(job.description).toContain('Organisational and coordination skills');
    expect(job.description).not.toContain('<li>');
  });

  it('prend le timestamp (secondes) quand il existe, sinon la date jj/mm/aaaa', () => {
    expect(parseAsosHit(HIT)!.postedAt?.toISOString()).toBe('2026-09-04T06:00:19.000Z');
    const noTs = parseAsosHit({ ...HIT, opening_date_timestamp: undefined, opening_date: '22/05/2026' })!;
    expect(noTs.postedAt?.toISOString()).toBe('2026-05-22T00:00:00.000Z');
  });
});

describe('fetchAsosJobs', () => {
  it('s’arrête après la dernière page annoncée par nbPages', async () => {
    mockJson.mockResolvedValueOnce({ hits: [HIT], nbHits: 1, nbPages: 1, page: 0 } as never);
    const { jobs, declaredTotal, truncated } = await fetchAsosJobs({});
    expect(mockJson).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(1);
    expect(declaredTotal).toBe(1);
    expect(truncated).toBe(false);
  });

  it('relit AG_KEY dans la page quand la clé épinglée est refusée', async () => {
    mockJson
      .mockResolvedValueOnce({ status: 403, message: 'Invalid Application-ID or API key' } as never)
      .mockResolvedValueOnce({ hits: [HIT], nbHits: 1, nbPages: 1 } as never);
    mockText.mockResolvedValueOnce('<script>const AG_ID = "RVMOB42DFH"; const AG_KEY = "0123456789abcdef0123456789abcdef";</script>');

    const { jobs } = await fetchAsosJobs({});

    expect(jobs).toHaveLength(1);
    const retryHeaders = mockJson.mock.calls[1][1]?.headers as Record<string, string>;
    expect(retryHeaders['x-algolia-api-key']).toBe('0123456789abcdef0123456789abcdef');
  });

  it('échoue FORT quand aucune clé de rechange n’est trouvée — jamais un « zéro offre » silencieux', async () => {
    mockJson.mockResolvedValueOnce({ status: 403, message: 'Invalid' } as never);
    mockText.mockResolvedValueOnce('<html>no key here</html>');
    await expect(fetchAsosJobs({})).rejects.toThrow(/key rejected/);
  });
});
