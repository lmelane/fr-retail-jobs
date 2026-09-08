import { describe, expect, it } from 'vitest';
import { parseFlatchrBoard } from './flatchr.js';

const url = 'https://adopt.flatchr.io/fr/company/adopt/';
const item = (id: string, country = 'France') => ({
  id: `publication-${id}`, published: true, status: 'published', created_at: '2026-09-08T14:38:36.825Z',
  vacancy: { id, slug: `${id}-vente`, title: 'Conseiller de vente', company: { id: 'company1', name: 'Adopt Parfums', slug: 'adopt' },
    description: '<p>Maison</p>', mission: '<p>Conseiller</p>', profile: '<p>Expérience</p>',
    show_address: true, address: { country, locality: 'Paris', location_lat: '0', location_lng: '2.3' },
    show_contract_type: true, contract_type: 'CDD', end_date: '2027-09-08T00:00:00Z',
    updated_at: '2026-09-09T00:00:00Z', language: 'fr_FR', show_salary: false, salary: 12345,
  },
});
const board = (items: unknown[], count: number | null = items.length, extra = {}) =>
  `${count === null ? '' : `<h2 class="jobs-found">${count} offres</h2>`}<script id="__NEXT_DATA__">${JSON.stringify({
    page: '/company/[companySlug]', query: { companySlug: 'adopt' },
    props: { data: { items }, baseUrlPath: '/fr/company', queryEndUrl: '', ...extra },
  })}</script>`;

describe('Flatchr public board', () => {
  it('reads every country and full description, without treating locale/contract end as job facts', () => {
    const result = parseFlatchrBoard(board([item('a'), item('b', 'Italie'), item('c', 'Canada')]), url);
    expect(result).toMatchObject({ declaredTotal: 3, complete: true, truncated: false });
    expect(result.jobs.map(j => j.country)).toEqual(['France', 'Italie', 'Canada']);
    expect(result.jobs[0]).toMatchObject({ externalId: 'company1:a', latitude: 0, longitude: 2.3,
      url: `${url}vacancy/a-vente`, description: 'Maison\nConseiller\nExpérience', contract: 'CDD',
      postedAt: new Date('2026-09-08T14:38:36.825Z') });
    expect(result.jobs[0].validThrough).toBeUndefined();
    expect(result.jobs[0].language).toBeUndefined();
    expect(result.jobs[0].salaryMin).toBeUndefined();
    expect(result.jobs[0].raw).toEqual(item('a'));
  });
  it('keeps public filter fields even when the detail template hides its blocks', () => {
    const posting = item('a'); posting.vacancy.show_address = false; posting.vacancy.show_contract_type = false;
    expect(parseFlatchrBoard(board([posting]), url).jobs[0]).toMatchObject({country:'France',contract:'CDD'});
  });
  it('preserves explicit group evidence without inventing one from absent or malformed fields', () => {
    for (const [group, expected] of [[' Armand Thiery ', 'Armand Thiery'], [null, undefined], [{ name: 'Guess' }, undefined]] as const) {
      const posting = item('a');
      Object.assign(posting.vacancy.company, { group });
      const job = parseFlatchrBoard(board([posting]), url).jobs[0];
      expect(job.group).toBe(expected);
      expect(job.raw).toEqual(posting);
    }
  });
  it('keeps vacancy identity through republication/title changes', () => {
    const original = item('a');
    const repost = { ...original, id: 'new-publication', vacancy: { ...original.vacancy, slug: 'a-new-title' } };
    expect(parseFlatchrBoard(board([original]), url).jobs[0].externalId)
      .toBe(parseFlatchrBoard(board([repost]), url).jobs[0].externalId);
  });
  it('does not attest completeness for a truncated or count-less response', () => {
    expect(parseFlatchrBoard(board([item('a')], 121), url)).toMatchObject({ complete: false, truncated: true });
    expect(parseFlatchrBoard(board([], null), url).complete).toBe(false);
  });
  it('fails on missing payload, missing items, duplicates or foreign employers', () => {
    expect(() => parseFlatchrBoard('<h1>Blocked</h1>', url)).toThrow('payload');
    expect(() => parseFlatchrBoard(board([], null, { data: {} }), url)).toThrow('shape');
    expect(() => parseFlatchrBoard(board([item('a'), item('a')]), url)).toThrow('duplicate');
    const foreign = item('a'); foreign.vacancy.company.slug = 'other';
    expect(() => parseFlatchrBoard(board([foreign]), url)).toThrow('foreign-tenant');
  });
  it('rejects filtered URLs and partial/malformed/unpublished items', () => {
    expect(() => parseFlatchrBoard(board([item('a')]), `${url}?country=FR`)).toThrow('unfiltered');
    expect(() => parseFlatchrBoard(board([item('a')]), url.replace('/adopt/', '/other/'))).toThrow('mismatch');
    expect(() => parseFlatchrBoard(board([{ ...item('a'), published: false }]), url)).toThrow('unpublished');
    expect(() => parseFlatchrBoard(board([{}]), url)).toThrow('invalid');
  });
});
