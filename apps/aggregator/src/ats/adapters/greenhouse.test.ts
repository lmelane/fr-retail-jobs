import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { fetchGreenhouseJobs, greenhouseCountry } from './greenhouse.js';

const network = vi.mocked(fetchJson);
// Real response of boards-api.greenhouse.io/v1/boards/onrunning/jobs?content=true, 2026-09-10 (4 postings, content shortened).
const sample = JSON.parse(readFileSync(new URL('./__fixtures__/lot4-greenhouse-onrunning-sample.json', import.meta.url), 'utf8'));
beforeEach(() => { network.mockReset(); });

describe('Greenhouse country', () => {
  it('reads the country from the office address when location.name is a bare city', () => {
    expect(greenhouseCountry({ location: { name: 'London' }, offices: [{ name: 'HQ London', location: 'London, England, United Kingdom' }] })).toBe('GB');
    expect(greenhouseCountry({ location: { name: 'Zurich' }, offices: [{ name: 'Zürich', location: 'Förrlibuckstrasse 190, 8005 Zürich, Switzerland' }] })).toBe('CH');
    expect(greenhouseCountry({ location: { name: 'Ho Chi Minh City' }, offices: [{ name: 'HCMC', location: 'Hồ Chí Minh, Vietnam' }] })).toBe('VN');
  });
  it('never infers a country from a city alone: an office without address leaves the country empty', () => {
    expect(greenhouseCountry({ location: { name: 'Melbourne' }, offices: [{ name: 'Melbourne', location: null }] })).toBeUndefined();
    expect(greenhouseCountry({ location: { name: 'Paris' }, offices: [] })).toBeUndefined();
  });
  it('maps the real On board: the London posting gets GB, the three address-less offices stay empty', async () => {
    network.mockResolvedValueOnce(sample);
    const jobs = await fetchGreenhouseJobs({ board: 'onrunning' });
    expect(network.mock.calls[0][0]).toBe('https://boards-api.greenhouse.io/v1/boards/onrunning/jobs?content=true');
    expect(jobs).toHaveLength(4);
    expect(jobs.map((j) => [j.location, j.country])).toEqual([['London', 'GB'], ['Melbourne', undefined], ['Paris', undefined], ['Amsterdam', undefined]]);
    expect(jobs[0]!.externalId).toBe(String(sample.jobs[0].id));
  });
});
