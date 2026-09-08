import { afterAll, describe, expect, it, vi } from 'vitest';

vi.stubEnv('FASHIONJOBS_MIN_COMPANIES', '1');
const { parseFashionJobsCompanies } = await import('./companyDirectory.js');
afterAll(() => vi.unstubAllEnvs());

describe('FashionJobs employer directory count metadata', () => {
  it('does not concatenate the numeric employer suffix with the offer count', () => {
    // Structure observed on the live directory, 2026-09-08. No offer content.
    const [row] = parseFashionJobsCompanies('<li><div><h3><a href="/recrutement/maison-1-2-3.html">MAISON 1-2-3</a></h3><div><span>40&nbsp;</span><span>offres d’emploi</span></div></div></li>');
    expect(row.name).toBe('MAISON 1-2-3');
    expect(row.offerCount).toBe(40);
  });
  it('reads the alphabetical list and deduplicates its featured employer card', () => {
    const rows = parseFashionJobsCompanies('<li><a href="/recrutement/maison-1-2-3.html">MAISON 1-2-3</a><span> (40)</span></li><li><a href="/recrutement/maison-1-2-3.html">MAISON 1-2-3</a><span>40 offres d’emploi</span></li>');
    expect(rows).toHaveLength(1);
    expect(rows[0].offerCount).toBe(40);
  });
  it('does not invent a count from a numeric company name alone', () => {
    expect(parseFashionJobsCompanies('<li><a href="/recrutement/16paris.html">16PARIS</a></li>')[0].offerCount).toBeUndefined();
  });
});

describe('international directory scope and explicit empty evidence', () => {
  it.each([
    ['uk','/careers/maison-123.html'],
    ['it','/lavora-con-noi/maison-123.html'],
    ['pl','/en-pl/careers/maison-123.html'],
    ['de','/karriere-arbeitspl%C3%A4tze/maison-123.html'],
    ['cn','/%E6%8B%9B%E8%81%98/maison-123.html'],
  ])('keeps the %s edition and its relative profile path', (edition, path) => {
    const rows=parseFashionJobsCompanies(`<li><a href="${path}">MAISON 1-2-3</a><span> (40)</span></li>`,{directoryUrl:`https://${edition}.fashionjobs.com/societesrecrutent/`,minExpected:1});
    expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({fashionjobsUrl:`https://${edition}.fashionjobs.com${path}`,fashionjobsSlug:'maison-123',offerCount:40});
  });
  it('refuses foreign-domain profiles and job-detail pages',()=>{
    const html='<li><a href="https://elsewhere.example/recrutement/brand.html">Wrong</a></li><a href="/job/brand/foo.html">Job</a>';
    expect(()=>parseFashionJobsCompanies(html,{minExpected:1})).toThrow('only 0');
  });
  it('requires explicit empty-directory text to accept zero, not a missing selector',()=>{
    const opts={directoryUrl:'https://et.fashionjobs.com/societesrecrutent/',minExpected:1,allowExplicitEmpty:true};
    expect(parseFashionJobsCompanies('<body>There are no items in this category.</body>',opts)).toEqual([]);
    expect(()=>parseFashionJobsCompanies('<body>Access denied</body>',opts)).toThrow('only 0');
  });
});

it('does not use a translation string in JavaScript as proof of an empty directory',()=>{
  expect(()=>parseFashionJobsCompanies('<script>const message="There are no items in this category."</script><body>Challenge</body>',{minExpected:1,allowExplicitEmpty:true})).toThrow('only 0');
});
it('refuses a partly recognized alphabetical directory when a new profile route appears',()=>{
  const html='<li><a href="/recrutement/known.html">Known</a></li><li class="tw-text-12"><a class="tw-font-secondary" href="/new-profile-route/unknown.html">Unknown</a><span> (2)</span></li>';
  expect(()=>parseFashionJobsCompanies(html,{minExpected:1})).toThrow('Unparsed FashionJobs directory row');
});
