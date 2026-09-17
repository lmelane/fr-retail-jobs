import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseWordpressPost, fetchWordpressJobs } from './wordpress.js';
import { fetchWithRetry } from '../../lib/http.js';
import { normalizeAdapterResult } from '../index.js';
vi.mock('../../lib/http.js', () => ({ fetchWithRetry: vi.fn() }));
const raw = { id: 42, title: { rendered: 'Advisor' }, content: { rendered: '<p>Native description</p>' },
  link: 'https://jobs.example/42', date: '2026-09-15T16:00:00', date_gmt: '2026-09-15T14:00:00' };
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('WordPress publication time', () => {
  it.each(['UTC', 'America/Los_Angeles', 'Pacific/Auckland'])('reads GMT independently of worker TZ=%s', zone => {
    vi.stubEnv('TZ', zone);
    expect(parseWordpressPost(raw)?.postedAt?.toISOString()).toBe('2026-09-15T14:00:00.000Z');
  });
  it.each([undefined, null, '', '2026-02-30T10:00:00'])('never substitutes a site-local or malformed date: %s', date_gmt => {
    expect(parseWordpressPost({ ...raw, date_gmt })?.postedAt).toBeUndefined();
  });
  it('uses the same date and exact RAW through the live collector', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(new Response(JSON.stringify([raw]), { headers: { 'x-wp-totalpages': '1' } }));
    const { jobs: [job] } = await fetchWordpressJobs({ origin: 'https://jobs.example', categoryId: 1 });
    expect(job.postedAt?.toISOString()).toBe('2026-09-15T14:00:00.000Z');
    expect(job.raw).toEqual(raw);
  });
});

/**
 * LE CONTRAT DES IDENTIFIANTS CANONIQUES.
 *
 * `post.id` est la clé primaire que l'API WordPress sert dans sa réponse, et le chemin d'identité de
 * `externalId`. Son ancien repli — `post.link` — est une URL : le contrat interdit d'en dériver un identifiant.
 * Chaque page de l'API porte sa preuve ; le témoin passe au rouge si `canonicalIds` est retiré.
 */
describe('WordPress — contrat des identifiants canoniques', () => {
  const page = (posts: unknown[], headers: Record<string, string>) =>
    new Response(JSON.stringify(posts), { headers });

  it('déclare canonicalIds sur chaque page, exactement les post.id observés', async () => {
    const second = { ...raw, id: 43, link: 'https://jobs.example/43' };
    vi.mocked(fetchWithRetry)
      .mockResolvedValueOnce(page([raw], { 'x-wp-total': '2', 'x-wp-totalpages': '2' }))
      .mockResolvedValueOnce(page([second], { 'x-wp-total': '2', 'x-wp-totalpages': '2' }));

    const r = await fetchWordpressJobs({ origin: 'https://jobs.example', categoryId: 1 });

    const pages = r.enumeration!.pageEvidence!;
    expect(pages).toHaveLength(2);
    for (const pe of pages) expect(Object.hasOwn(pe, 'canonicalIds')).toBe(true);
    expect(pages.map(pe => pe.canonicalIds)).toEqual([['42'], ['43']]);
    expect(r.declaredTotal).toBe(2);
    expect(r.enumeration!.canonicalAbsenceProofUsable).toBe(true);

    const canonical = pages.flatMap(pe => pe.canonicalIds ?? []);
    expect(canonical).toEqual(r.jobs.map(j => j.externalId));
    const n = normalizeAdapterResult(r);
    expect(n.enumeration?.canonicalIdViolations).toBeUndefined();
    expect(n.enumeration?.issues ?? []).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
  });

  it('un billet sans titre reste une DISPOSITION nommée, pas un trou', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      page([raw, { id: 44, link: 'https://jobs.example/44', title: { rendered: '' } }], { 'x-wp-totalpages': '1' }));

    const r = await fetchWordpressJobs({ origin: 'https://jobs.example', categoryId: 1 });
    expect(r.jobs.map(j => j.externalId)).toEqual(['42']);
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual(['42', '44']);
    expect(r.rejectedRows?.map(row => row.canonicalId)).toEqual(['44']);
    expect(normalizeAdapterResult(r).enumeration?.canonicalIdViolations).toBeUndefined();
  });

  it("un billet sans id n'est jamais publié sous l'identifiant de son URL", async () => {
    const sansId = { ...raw, id: undefined, link: 'https://jobs.example/sans-id' };
    // PRÉMISSE : le billet a bien un titre et un lien, donc l'ancien repli aurait produit une offre.
    expect(sansId.title.rendered && sansId.link).toBeTruthy();
    vi.mocked(fetchWithRetry).mockResolvedValue(page([raw, sansId], { 'x-wp-totalpages': '1' }));

    const r = await fetchWordpressJobs({ origin: 'https://jobs.example', categoryId: 1 });
    expect(r.jobs.map(j => j.externalId)).toEqual(['42']);
    expect(r.rejectedRows?.map(row => row.reason)).toEqual(['POST_WITHOUT_NATIVE_ID']);
    expect(r.enumeration!.canonicalAbsenceProofUsable).toBe(false);
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual(['42']);
    expect(normalizeAdapterResult(r).enumeration?.canonicalIdViolations).toBeUndefined();
  });
});
