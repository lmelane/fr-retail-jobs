import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { fetchGreenhouseJobs, greenhouseCountry, parseGreenhouseJob } from './greenhouse.js';

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
  /*
   * D-520, offres sans pays (02/10/2026) : 157 offres On (« United States », « China », « Japan »…) et 26 Molton Brown
   * (« United Kingdom », « Ireland ») portaient le pays dans le NOM de leur bureau Greenhouse, que la lecture ignorait.
   */
  it('reads the country from an office whose name is a country, after the address and the location', () => {
    expect(greenhouseCountry({ location: { name: 'Seattle' }, offices: [{ name: 'United States', location: null }] })).toBe('US');
    expect(greenhouseCountry({ location: { name: 'York' }, offices: [{ name: 'United Kingdom', location: null }] })).toBe('GB');
    expect(greenhouseCountry({ location: { name: 'Shanghai' }, offices: [{ name: 'China', location: null }] })).toBe('CN');
    // L'adresse d'un bureau passe avant son nom.
    expect(greenhouseCountry({ location: { name: 'Zurich' }, offices: [{ name: 'Germany', location: 'Förrlibuckstrasse 190, 8005 Zürich, Switzerland' }] })).toBe('CH');
  });
  it('never reads a country from an office name that is a code, a US state, a city or a mix of countries', () => {
    expect(greenhouseCountry({ location: { name: 'London' }, offices: [{ name: 'UK', location: null }] })).toBeUndefined();
    expect(greenhouseCountry({ location: { name: 'Atlanta' }, offices: [{ name: 'Georgia', location: null }] })).toBeUndefined();
    expect(greenhouseCountry({ location: { name: 'Shanghai' }, offices: [{ name: 'HQ Shanghai', location: null }] })).toBeUndefined();
    expect(greenhouseCountry({ location: { name: 'Remote' }, offices: [{ name: 'Germany', location: null }, { name: 'France', location: null }] })).toBeUndefined();
    expect(greenhouseCountry({ location: { name: 'Remote' }, offices: [{ name: 'Remote (United States)', location: null }] })).toBeUndefined();
  });
  it('maps the real On board: the London posting gets GB from its address, the three address-less offices their name', async () => {
    network.mockResolvedValueOnce(sample);
    const { jobs } = await fetchGreenhouseJobs({ board: 'onrunning' });
    expect(network.mock.calls[0][0]).toBe('https://boards-api.greenhouse.io/v1/boards/onrunning/jobs?content=true');
    expect(jobs).toHaveLength(4);
    // Bureaux « Australia », « France », « Netherlands » sans adresse : jusqu'au 02/10/2026, ces trois offres restaient sans pays.
    expect(jobs.map((j) => [j.location, j.country])).toEqual([['London', 'GB'], ['Melbourne', 'AU'], ['Paris', 'FR'], ['Amsterdam', 'NL']]);
    expect(jobs[0]!.externalId).toBe(String(sample.jobs[0].id));
  });
});

describe('Greenhouse publication time', () => {
  const raw = { id: 1, title: 'Advisor', absolute_url: 'https://jobs.example/1', updated_at: '2026-09-15T14:00:00Z' };
  it('uses first publication even when an edit is more recent', () => {
    expect(parseGreenhouseJob({ ...raw, first_published: '2024-01-01T12:00:00Z' }).postedAt?.toISOString()).toBe('2024-01-01T12:00:00.000Z');
  });
  it.each([undefined, '', '2026-02-30T12:00:00Z', '2026-09-15T12:00:00'])('does not fall back to updated_at: %s', first_published => {
    expect(parseGreenhouseJob({ ...raw, first_published }).postedAt).toBeUndefined();
  });
});

it('keeps the publisher zero counter and rejects a contradictory positive total', async () => {
  network.mockResolvedValueOnce({ jobs: [], meta: { total: 0 } });
  expect(await fetchGreenhouseJobs({ board: 'witness' })).toMatchObject({ jobs: [], complete: true, declaredTotal: 0 });
  network.mockResolvedValueOnce({ jobs: [], meta: { total: 2 } });
  expect(await fetchGreenhouseJobs({ board: 'witness' })).toMatchObject({ jobs: [], complete: false, declaredTotal: 2 });
});
