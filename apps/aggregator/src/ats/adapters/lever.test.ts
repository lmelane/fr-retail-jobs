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
  it('keeps HTML-only text, named lists, compensation text and closing content without duplicating the opening', async () => {
    network.mockResolvedValueOnce([{ id: 'x', text: 'Advisor', hostedUrl: 'https://jobs.lever.co/acme/x',
      descriptionPlain: '', description: '<p>Opening and body</p>', openingPlain: 'Opening', descriptionBodyPlain: 'body',
      lists: [{ text: 'Requirements', content: '<ul><li>Client service</li></ul>' }],
      salaryDescriptionPlain: 'Declared compensation note', additionalPlain: 'Closing information' }]);
    const { jobs } = await fetchLeverJobs({ site: 'acme' });
    expect(jobs[0].description).toBe('Opening and body\n\nRequirements\n• Client service\n\nDeclared compensation note\n\nClosing information');
  });
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

import { readFileSync } from 'node:fs';
describe('Lever — real Arc\'teryx postings (api.lever.co, 2026-09-10)', () => {
  it('keeps the country the API states (ISO-2) and the workplace type, next to the location text', async () => {
    const rows = JSON.parse(readFileSync(new URL('./fixtures/lot4-lever-arcteryx-sample.json', import.meta.url), 'utf8'));
    network.mockResolvedValueOnce(rows);
    const { jobs, complete } = await fetchLeverJobs({ site: 'arcteryx.com' });
    expect(complete).toBe(true);
    expect(jobs.map((j) => [j.country, j.remote, j.location])).toEqual([
      ['CA', 'hybrid', 'North Vancouver, BC (Corporate)'], ['CA', 'hybrid', 'North Vancouver, BC (Corporate)'], ['KR', 'hybrid', 'Seoul'],
    ]);
    expect(jobs[0]!.raw).toMatchObject({ country: 'CA', workplaceType: 'hybrid' });
  });
  it('declares canonicalIds on EVERY evidence page, identical to the written externalIds', async () => {
    network.mockResolvedValueOnce(page(0, 100)).mockResolvedValueOnce(page(100, 2));
    const r = await fetchLeverJobs({ site: 'acme' });
    // PRÉMISSE : deux pages de preuve, sans quoi ce témoin n'exercerait pas la règle « tout ou rien ».
    expect(r.enumeration?.pageEvidence).toHaveLength(2);
    expect(r.enumeration!.pageEvidence!.every((pe) => Object.hasOwn(pe, 'canonicalIds'))).toBe(true);
    const canonical = r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? []);
    expect([...canonical].sort()).toEqual(r.jobs.map((j) => j.externalId).sort());
    expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(true);
    expect(r.complete).toBe(true);
  });

  it('never publishes a posting the enumeration proof does not name, even after a failed page', async () => {
    network.mockResolvedValueOnce(page(0, 100)).mockRejectedValueOnce(new Error('503'));
    const r = await fetchLeverJobs({ site: 'acme' });
    const canonical = new Set(r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? []));
    expect(r.jobs.every((j) => canonical.has(j.externalId))).toBe(true);
    expect(r.enumeration!.pageEvidence!.every((pe) => Object.hasOwn(pe, 'canonicalIds'))).toBe(true);
    expect(r.complete).toBe(false);
  });

  it('leaves country and workplace empty when the API does not state them, never guessed from the location', async () => {
    network.mockResolvedValueOnce([{ id: 'x', text: 'Job', hostedUrl: 'https://jobs.lever.co/acme/x', workplaceType: 'unspecified', categories: { location: 'Paris' } }]);
    const { jobs } = await fetchLeverJobs({ site: 'acme' });
    expect(jobs[0]!.country).toBeUndefined(); expect(jobs[0]!.remote).toBeUndefined(); expect(jobs[0]!.location).toBe('Paris');
  });
});
