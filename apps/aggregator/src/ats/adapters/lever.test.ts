import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { fetchLeverJobs } from './lever.js';

const network = vi.mocked(fetchJson);
const page = (start: number, length: number) => Array.from({ length }, (_, i) => ({
  id: String(start + i), text: `Job ${start + i}`, hostedUrl: `https://jobs.lever.co/acme/${start + i}`,
}));
beforeEach(() => network.mockReset());

describe('Lever enumeration', () => {
  it('continues past 100 postings and supports the explicit EU region', async () => {
    network.mockResolvedValueOnce(page(0, 100)).mockResolvedValueOnce(page(100, 2));
    const result = await fetchLeverJobs({ site: 'acme', region: 'eu' });
    expect(result.jobs).toHaveLength(102);
    expect(result.complete).toBe(true);
    expect(network.mock.calls[1][0]).toBe('https://api.eu.lever.co/v0/postings/acme?mode=json&skip=100&limit=100');
  });
  it('keeps fetched jobs but denies completion after a page fails', async () => {
    network.mockResolvedValueOnce(page(0, 100)).mockRejectedValueOnce(new Error('503'));
    const result = await fetchLeverJobs({ site: 'acme' });
    expect(result.jobs).toHaveLength(100);
    expect(result).toMatchObject({ complete: false, truncated: true });
  });
  it('detects a repeated page without duplicating its postings', async () => {
    network.mockResolvedValue(page(0, 100));
    const result = await fetchLeverJobs({ site: 'acme' });
    expect(result.jobs).toHaveLength(100);
    expect(result.complete).toBe(false);
    expect(network).toHaveBeenCalledTimes(2);
  });
  it('does not call a page cap a completed crawl', async () => {
    network.mockResolvedValueOnce(page(0, 100));
    expect(await fetchLeverJobs({ site: 'acme', maxPages: 1 })).toMatchObject({ complete: false, truncated: true });
  });
});
