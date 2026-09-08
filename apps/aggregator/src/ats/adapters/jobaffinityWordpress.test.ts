import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeJobaffinityPost, parseJobaffinityGrid, parseJobaffinityApplication } from './jobaffinityWordpress.js';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/jobaffinity-real-posts.json', import.meta.url), 'utf8'));
const config = (f: any) => ({ listingUrl: f.origin + '/', employer: f.origin.includes('blackstore') ? 'Blackstore' : 'Intersport', brands: { Intersport: 'Intersport' } });
const norm = (f: any) => normalizeJobaffinityPost(f.row, f.post, config(f), f.geo);
describe('JobAffinity public board — real Intersport/Blackstore witnesses', () => {
  it('keeps the employer UTC date, full text and direct application token', () => {
    const job = norm(fixtures[0]);
    expect(job.postedAt?.toISOString()).toBe('2026-09-08T13:08:27.000Z');
    expect(job.externalId).toBe('rpp3vwzazs9dmsf9f9');
    expect(job.description).toContain('cellule');
    expect(job.country).toBe('FR');
    expect(job.workingTime).toBeUndefined();
    expect(job.validThrough).toBeUndefined();
  });
  it('holds the real azert source artifact without inventing a job description', () => {
    expect(norm(fixtures[1]).publicationHold).toBe('MISSING_EMPLOYER_MISSION');
  });
  it('uses explicit part-time title despite the contradictory full-time template', () => {
    expect(fixtures[2].row.attrs['data-temps-travail']).toBe('Temps plein');
    expect(norm(fixtures[2]).workingTime).toBe('part-time');
  });
  it('never claims French geography from the domain or mismatched coordinates', () => {
    const f = structuredClone(fixtures[0]); f.row.attrs['data-codepostal'] = '94521'; f.row.attrs['data-ville'] = 'THIAIS BELLE EPINE';
    const job = norm(f); expect(job.country).toBeUndefined(); expect(job.latitude).toBeUndefined();
  });
  it('accepts exact government city/postal evidence without using contradictory coordinates', () => {
    const f = structuredClone(fixtures[0]);
    f.geo.communes = [];
    f.geo.postalLookup = { url: 'https://geo.api.gouv.fr/communes?codePostal=43700', communes: fixtures[0].geo.communes };
    const job = norm(f); expect(job.country).toBe('FR'); expect(job.latitude).toBeUndefined();
  });
  it('refuses foreign or missing detail IDs and unreviewed employer labels', () => {
    const f = structuredClone(fixtures[0]); f.post.id = 2376; expect(() => norm(f)).toThrow('identity');
    f.post.id = fixtures[0].post.id; f.row.attrs['data-marque'] = 'unreviewed'; expect(() => norm(f)).toThrow('unreviewed');
  });
  it('rejects incomplete grids, filters and HTML error pages instead of returning zero', () => {
    expect(() => parseJobaffinityGrid('<p>maintenance</p>', fixtures[0].origin + '/')).toThrow('counter');
    expect(() => parseJobaffinityGrid('<span id="job-counter">993</span>', fixtures[0].origin + '/')).toThrow('partial');
    expect(() => parseJobaffinityGrid('<span id="job-counter">0</span>', fixtures[0].origin + '/?ville=Paris')).toThrow('unfiltered');
  });
  it('requires a matching application form, never treats a generic HTTP 200 as open', () => {
    expect(() => parseJobaffinityApplication('<html>maintenance</html>', norm(fixtures[0]).url)).toThrow('matching');
    const expired = "<h1>‼️ modèle expiré‼️ Skiman H/F</h1><h1>Ce poste n'est plus ouvert</h1>";
    expect(parseJobaffinityApplication(expired, norm(fixtures[0]).url).state).toBe('CLOSED');
    expect(parseJobaffinityApplication(expired.replace('ouvert<', 'ouvert.<'), norm(fixtures[0]).url).state).toBe('CLOSED');
  });
});
