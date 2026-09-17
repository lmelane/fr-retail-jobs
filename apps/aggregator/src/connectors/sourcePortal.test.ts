import { expect, it } from 'vitest';
import { belongsToOfficialDomain, configuredPortal, reviewedOfficialDomain } from './sourcePortal.js';

it.each(['com', 'co.uk', 'ashbyhq.com', 'recruitee.com', 'myworkdayjobs.com', 'https://maison.com', 'jobs.maison.com'])('does not treat %s as a reviewed registrable employer domain', value => {
  expect(() => reviewedOfficialDomain(value)).toThrow();
});
it('keeps official domain boundaries exact, including public suffixes', () => {
  expect(reviewedOfficialDomain('maison.co.uk')).toBe('maison.co.uk');
  expect(belongsToOfficialDomain('https://careers.maison.co.uk/page', 'maison.co.uk')).toBe(true);
  for (const url of ['https://maison.co.uk.evil.example/', 'https://othermaison.co.uk/', 'http://maison.co.uk/', 'https://user@maison.co.uk/']) {
    expect(belongsToOfficialDomain(url, 'maison.co.uk')).toBe(false);
  }
});
it('matches the configured Ashby board without accepting another board or a vendor mention', () => {
  const board = configuredPortal('ashby', { board: 'Maison', slug: 'ignored-native-alias' })!;
  expect(board.matches('https://jobs.ashbyhq.com/Maison/?utm_source=official')).toBe(true);
  for (const url of ['https://jobs.ashbyhq.com/', 'https://jobs.ashbyhq.com/maison', 'https://jobs.ashbyhq.com/Maison-other',
    'https://jobs.ashbyhq.com/Maison/job-id', 'https://jobs.ashbyhq.com/Maison?redirect=other', 'https://jobs.ashbyhq.com/Maison#/other',
    'https://jobs.ashbyhq.com.evil.example/Maison', 'https://other.example/?next=https://jobs.ashbyhq.com/Maison']) expect(board.matches(url)).toBe(false);
});
it('requires the Workday host, tenant and site, preserving site case', () => {
  const config = { tenant: 'maison', site: 'Stores', origin: 'https://maison.wd3.myworkdayjobs.com' };
  const board = configuredPortal('workday', config)!;
  expect(board.matches('https://maison.wd3.myworkdayjobs.com/en-US/Stores')).toBe(true);
  expect(board.matches('https://maison.wd3.myworkdayjobs.com/Stores/')).toBe(true);
  expect(board.matches('https://maison.wd3.myworkdayjobs.com/Stores?jobFamily=0bd4110fb9ee102f9e236f45683f9723&locations=143de3b0ec17101e18b11ae6da2fd2f1')).toBe(true);
  expect(board.matches('https://maison.wd3.myworkdayjobs.com/Stores?jobFamily=another-board')).toBe(false);
  expect(board.matches('https://maison.wd3.myworkdayjobs.com/Stores?tenant=other')).toBe(false);
  for (const url of ['https://maison.wd3.myworkdayjobs.com/en-US/Headquarters', 'https://maison.wd3.myworkdayjobs.com/stores',
    'https://maison.wd5.myworkdayjobs.com/en-US/Stores', 'https://other.wd3.myworkdayjobs.com/Stores',
    'https://maison.wd3.myworkdayjobs.com/en-US/Stores/job/1', 'https://maison.wd3.myworkdayjobs.com/StoresOther']) expect(board.matches(url)).toBe(false);
  expect(configuredPortal('workday', { ...config, tenant: 'other' })).toBeNull();
  expect(configuredPortal('workday', { ...config, origin: 'https://custom.maison.com' })).toBeNull();
});
it('matches a Recruitee board and its language landing page, never another tenant or a job detail', () => {
  const board = configuredPortal('recruitee', { subdomain: 'maison' })!;
  expect(board.matches('https://maison.recruitee.com/')).toBe(true);
  expect(board.matches('https://maison.recruitee.com/l/fr?lang=fr')).toBe(true);
  expect(configuredPortal('recruitee', { subdomain: 'Maison' })!.url).toBe(board.url);
  expect(board.matches('https://other.recruitee.com/')).toBe(false);
  expect(board.matches('https://maison.recruitee.com/o/job-1')).toBe(false);
});
it('matches a Teamtailor career site on its exact origin and listing, with native filters, never another tenant, host, redirection source or job page', () => {
  const site = configuredPortal('teamtailor', { origin: 'https://careers.ohmycream.com' })!;
  expect(site.url).toBe('https://careers.ohmycream.com/');
  expect(configuredPortal('teamtailor', { origin: 'https://careers.ohmycream.com/' })!.url).toBe(site.url);
  expect(site.matches('https://careers.ohmycream.com/')).toBe(true);
  expect(site.matches('https://careers.ohmycream.com/jobs')).toBe(true);
  expect(site.matches('https://careers.ohmycream.com/jobs/?utm_source=site&lang=fr')).toBe(true);
  // The map view Loïc provided: a display filter within the same tenant, never a coverage attestation.
  expect(site.matches('https://careers.ohmycream.com/jobs?geobound_coordinates%5Bne_lat%5D=49.1&geobound_coordinates%5Bsw_lng%5D=1.9&query=vendeur&split_view=true')).toBe(true);
  for (const url of ['https://ohmycream.teamtailor.com/', 'https://careers.other.example/', 'https://www.careers.ohmycream.com/',
    'http://careers.ohmycream.com/', 'https://careers.ohmycream.com:8443/', 'https://user@careers.ohmycream.com/',
    'https://careers.ohmycream.com/jobs/123456-vendeur', 'https://careers.ohmycream.com/jobs/internal', 'https://careers.ohmycream.com/#/jobs',
    'https://careers.ohmycream.com/jobs?redirect=https%3A%2F%2Fevil.example', 'https://careers.ohmycream.com/jobs?tenant=other&split_view=true',
    'https://careers.ohmycream.com/en/jobs', 'https://other.example/?next=https://careers.ohmycream.com/jobs']) expect(site.matches(url)).toBe(false);
  expect(configuredPortal('teamtailor', { origin: 'https://careers.ohmycream.com/jobs' })).toBeNull();
  expect(configuredPortal('teamtailor', { origin: 'http://careers.ohmycream.com' })).toBeNull();
  expect(configuredPortal('teamtailor', { origin: 'https://careers.ohmycream.com/?split_view=true' })).toBeNull();
  expect(() => configuredPortal('teamtailor', {})).toThrow();
  // A vendor host is an acceptable tenant identity when it is the configured one.
  expect(configuredPortal('teamtailor', { origin: 'https://maison.teamtailor.com' })!.matches('https://maison.teamtailor.com/jobs')).toBe(true);
});
it('matches Greenhouse boards on the vendor hosts, EU variants and the embed form, never a job, another board or a filtered view', () => {
  const board = configuredPortal('greenhouse', { board: 'Maison' })!;
  expect(board.url).toBe('https://boards.greenhouse.io/maison');
  for (const url of ['https://boards.greenhouse.io/maison', 'https://boards.greenhouse.io/Maison/', 'https://job-boards.greenhouse.io/maison', 'https://boards.eu.greenhouse.io/maison',
    'https://job-boards.eu.greenhouse.io/maison?utm_source=site', 'https://boards.greenhouse.io/embed/job_board?for=maison', 'https://boards.greenhouse.io/embed/job_board?for=Maison&utm_medium=footer']) expect(board.matches(url)).toBe(true);
  for (const url of ['https://boards.greenhouse.io/maison/jobs/123', 'https://boards.greenhouse.io/maisonparis', 'https://boards.greenhouse.io/', 'https://boards.greenhouse.io/embed/job_board?for=other',
    'https://boards.greenhouse.io/embed/job_board?for=maison&token=1', 'https://boards.greenhouse.io/maison?gh_jid=1', 'https://api.greenhouse.io/v1/boards/maison/jobs', 'http://boards.greenhouse.io/maison',
    'https://boards.greenhouse.io/maison?for=other']) expect(board.matches(url)).toBe(false);
  expect(configuredPortal('greenhouse', { board: 'mai son' })).toBeNull();
});
it('matches SmartRecruiters company pages on both vendor hosts, case-insensitively, never a posting or another company', () => {
  const company = configuredPortal('smartrecruiters-whitelabel', { company: 'MaisonParis' })!;
  expect(company.url).toBe('https://careers.smartrecruiters.com/MaisonParis');
  for (const url of ['https://careers.smartrecruiters.com/MaisonParis', 'https://jobs.smartrecruiters.com/maisonparis/', 'https://careers.smartrecruiters.com/MaisonParis?utm_source=site']) expect(company.matches(url)).toBe(true);
  for (const url of ['https://careers.smartrecruiters.com/MaisonParis/743999-vendeur', 'https://careers.smartrecruiters.com/MaisonParisOther', 'https://www.smartrecruiters.com/MaisonParis',
    'https://api.smartrecruiters.com/v1/companies/MaisonParis/postings', 'https://careers.smartrecruiters.com/']) expect(company.matches(url)).toBe(false);
});
it('matches Lever sites on the region host, never a posting or the other region', () => {
  const site = configuredPortal('lever', { site: 'maison' })!, eu = configuredPortal('lever', { site: 'maison', region: 'eu' })!;
  expect(site.url).toBe('https://jobs.lever.co/maison'); expect(eu.url).toBe('https://jobs.eu.lever.co/maison');
  expect(site.matches('https://jobs.lever.co/maison/')).toBe(true); expect(eu.matches('https://jobs.eu.lever.co/maison?lang=fr')).toBe(true);
  expect(site.matches('https://jobs.lever.co/maison?lever-source=site')).toBe(true);
  for (const url of ['https://jobs.lever.co/maison/2f1c1a1e-0000-4000-8000-000000000000', 'https://jobs.lever.co/other', 'https://jobs.eu.lever.co/maison', 'https://jobs.lever.co/maison?department=retail']) expect(site.matches(url)).toBe(false);
  expect(eu.matches('https://jobs.lever.co/maison')).toBe(false);
  expect(site.matchesPosting('https://jobs.lever.co/maison/2f1c1a1e-0000-4000-8000-000000000000?lever-origin=applicant')).toBe(true);
  for (const url of ['https://jobs.lever.co/other/2f1c1a1e-0000-4000-8000-000000000000', 'https://jobs.lever.co/maison/', 'https://jobs.lever.co/maison/not-a-uuid']) expect(site.matchesPosting(url)).toBe(false);
});
it('recognises one of the portal\'s own postings for every ATS family, never a listing, another tenant or a foreign page', () => {
  // Prémisse : chaque URL positive porte l'identité du tenant dans son chemin et N'EST PAS le listing (matches est faux).
  const cases: [string, Record<string, unknown>, string[], string[]][] = [
    ['ashby', { board: 'Maison' }, ['https://jobs.ashbyhq.com/Maison/2f1c1a1e-0000-4000-8000-000000000000'], ['https://jobs.ashbyhq.com/Other/2f1c1a1e-0000-4000-8000-000000000000', 'https://jobs.ashbyhq.com/Maison/job-slug']],
    ['recruitee', { subdomain: 'maison' }, ['https://maison.recruitee.com/o/vendeur-paris'], ['https://other.recruitee.com/o/vendeur-paris', 'https://maison.recruitee.com/l/fr']],
    ['teamtailor', { origin: 'https://careers.maison.example' }, ['https://careers.maison.example/jobs/123456-vendeur'], ['https://maison.teamtailor.com/jobs/123456-vendeur', 'https://careers.maison.example/jobs/internal']],
    ['greenhouse', { board: 'Maison' }, ['https://job-boards.greenhouse.io/maison/jobs/8161056?gh_src=site', 'https://boards.eu.greenhouse.io/maison/jobs/4922485101'], ['https://job-boards.greenhouse.io/other/jobs/8161056', 'https://boards.greenhouse.io/maison/jobs/abc']],
    ['smartrecruiters-whitelabel', { company: 'MaisonParis' }, ['https://jobs.smartrecruiters.com/MaisonParis/743999-vendeur', 'https://careers.smartrecruiters.com/maisonparis/743999'], ['https://jobs.smartrecruiters.com/Other/743999-vendeur', 'https://jobs.smartrecruiters.com/MaisonParis/vendeur']],
    ['personio', { host: 'maison.jobs.personio.de' }, ['https://maison.jobs.personio.de/job/123456'], ['https://other.jobs.personio.de/job/123456', 'https://maison.jobs.personio.de/job/abc']],
    ['workable', { account: 'maison' }, ['https://apply.workable.com/maison/j/AB12CD34EF/', 'https://maison.workable.com/jobs/123'], ['https://apply.workable.com/other/j/AB12CD34EF/', 'https://apply.workable.com/maison/']],
    ['successfactors', { origin: 'https://careers.maison.example' }, ['https://careers.maison.example/job/Paris/Vendeur/123'], ['https://other.maison.example/job/Paris/Vendeur/123', 'https://careers.maison.example/']],
    ['workday', { tenant: 'maison', site: 'Stores', origin: 'https://maison.wd3.myworkdayjobs.com' }, ['https://maison.wd3.myworkdayjobs.com/en-US/Stores/job/Paris/Vendeur_R123', 'https://maison.wd3.myworkdayjobs.com/Stores/job/Paris/Vendeur_R123'], ['https://maison.wd3.myworkdayjobs.com/Headquarters/job/Paris/Vendeur_R123', 'https://maison.wd3.myworkdayjobs.com/Stores']],
    ['lvmh_algolia', {}, ['https://www.lvmh.com/join-us/our-job-offers/vendeur-123'], ['https://www.lvmh.com/houses/vendeur-123']],
  ];
  for (const [kind, config, postings, others] of cases) {
    const portal = configuredPortal(kind, config)!;
    for (const url of postings) { expect(portal.matches(url), `${kind} listing ${url}`).toBe(false); expect(portal.matchesPosting(url), `${kind} posting ${url}`).toBe(true); }
    for (const url of others) expect(portal.matchesPosting(url), `${kind} refus ${url}`).toBe(false);
  }
  expect(configuredPortal('generic-listing', { listingUrl: 'https://www.maison.example/carrieres/' })!.matchesPosting('https://www.maison.example/carrieres/vendeur-1')).toBe(false);
  // Le chargeur d'embarquement Greenhouse est une référence au board lui-même.
  const board = configuredPortal('greenhouse', { board: 'Maison' })!;
  expect(board.matches('https://boards.greenhouse.io/embed/job_board/js?for=maison')).toBe(true);
  expect(board.matches('https://boards.greenhouse.io/embed/job_board/js?for=other')).toBe(false);
  expect(configuredPortal('generic-listing', { startUrl: 'https://www.maison.example/pages/careers' })!.url).toBe('https://www.maison.example/pages/careers');
});
it('matches a Personio host and its listing paths, never a job page or another host', () => {
  const host = configuredPortal('personio', { host: 'maison.jobs.personio.de' })!;
  expect(host.url).toBe('https://maison.jobs.personio.de/');
  expect(configuredPortal('personio', { subdomain: 'maison' })!.url).toBe(host.url);
  for (const url of ['https://maison.jobs.personio.de/', 'https://maison.jobs.personio.de/search', 'https://maison.jobs.personio.de/jobs/']) expect(host.matches(url)).toBe(true);
  for (const url of ['https://maison.jobs.personio.de/job/123456', 'https://other.jobs.personio.de/', 'https://maison.jobs.personio.com/', 'https://maison.jobs.personio.de/?department=1']) expect(host.matches(url)).toBe(false);
});
it('matches a Workable account on the apply host or its own subdomain, never a posting', () => {
  const account = configuredPortal('workable', { account: 'maison' })!;
  expect(account.url).toBe('https://apply.workable.com/maison/');
  for (const url of ['https://apply.workable.com/maison/', 'https://apply.workable.com/maison', 'https://maison.workable.com/']) expect(account.matches(url)).toBe(true);
  for (const url of ['https://apply.workable.com/maison/j/ABC123/', 'https://apply.workable.com/other/', 'https://apply.workable.com/', 'https://maison.workable.com/jobs/1']) expect(account.matches(url)).toBe(false);
});
it('matches career sites served on their own origin (SuccessFactors, Phenom, Jibe, Talentsoft, DigitalRecruiters) on their listing paths only', () => {
  const site = configuredPortal('successfactors', { origin: 'https://careers.maison.example' })!;
  expect(site.url).toBe('https://careers.maison.example/');
  for (const url of ['https://careers.maison.example/', 'https://careers.maison.example/search/', 'https://careers.maison.example/fr', 'https://careers.maison.example/fr_FR/search/', 'https://careers.maison.example/content/Home/']) expect(site.matches(url)).toBe(true);
  for (const url of ['https://careers.maison.example/job/Paris/Vendeur/123', 'https://other.maison.example/', 'http://careers.maison.example/', 'https://careers.maison.example/search/?q=vendeur']) expect(site.matches(url)).toBe(false);
  expect(configuredPortal('digitalrecruiters', { domainName: 'careers.maison.example' })!.matches('https://careers.maison.example/fr/annonces')).toBe(true);
  expect(configuredPortal('phenom', { origin: 'https://jobs.maison.example', localePath: '/en_us' })!.matches('https://jobs.maison.example/en_us/search-results')).toBe(true);
  expect(configuredPortal('talentsoft', { origin: 'https://maison-career.talent-soft.com' })!.matches('https://maison-career.talent-soft.com/accueil.aspx')).toBe(true);
  expect(configuredPortal('successfactors', { origin: 'https://careers.maison.example/search' })).toBeNull();
});
it('matches Flatchr, Talentview and LVMH listings exactly', () => {
  const flatchr = configuredPortal('flatchr', { listingUrl: 'https://careers.flatchr.io/company/maison' })!;
  expect(flatchr.matches('https://careers.flatchr.io/company/maison/')).toBe(true);
  expect(flatchr.matches('https://careers.flatchr.io/company/maison/vacancy/1')).toBe(false);
  expect(configuredPortal('flatchr', { listingUrl: 'https://careers.other.example/company/maison' })).toBeNull();
  const talentview = configuredPortal('talentview', { slug: 'Maison' })!;
  expect(talentview.url).toBe('https://maison.talentview.io/');
  expect(talentview.matches('https://maison.talentview.io/')).toBe(true); expect(talentview.matches('https://maison.talentview.io/jobs/1')).toBe(false);
  const lvmh = configuredPortal('lvmh_algolia', {})!;
  expect(lvmh.matches('https://www.lvmh.com/join-us/our-job-offers')).toBe(true); expect(lvmh.matches('https://www.lvmh.com/fr/rejoignez-nous/nos-offres-d-emploi/')).toBe(true);
  expect(lvmh.matches('https://www.lvmh.com/houses/')).toBe(false); expect(lvmh.matches('https://www.lvmh.com/join-us/our-job-offers/vendeur-123')).toBe(false);
});
it('matches a generic listing on its exact configured page, tolerating its own pagination keys, and a sitemap by the site root', () => {
  const listing = configuredPortal('generic-listing', { listingUrl: 'https://www.maison.example/carrieres/?page={page}' })!;
  expect(listing.url).toBe('https://www.maison.example/carrieres/');
  for (const url of ['https://www.maison.example/carrieres/', 'https://www.maison.example/carrieres', 'https://www.maison.example/carrieres/?page=3', 'https://www.maison.example/carrieres/?utm_source=home']) expect(listing.matches(url)).toBe(true);
  for (const url of ['https://www.maison.example/', 'https://www.maison.example/carrieres/vendeur-1', 'https://www.maison.example/carrieres/?sort=date', 'https://maison.example/carrieres/', 'https://www.maison.example/carrieres-2/']) expect(listing.matches(url)).toBe(false);
  const file = configuredPortal('generic-jsonld', { listingUrl: 'https://www.maison.example/jobs.html' })!;
  expect(file.matches('https://www.maison.example/jobs.html')).toBe(true); expect(file.matches('https://www.maison.example/')).toBe(false);
  const sitemap = configuredPortal('generic-jsonld', { sitemapUrl: 'https://www.maison.example/sitemap-jobs.xml' })!;
  expect(sitemap.url).toBe('https://www.maison.example/');
  expect(sitemap.matches('https://www.maison.example/')).toBe(true); expect(sitemap.matches('https://www.maison.example/sitemap-jobs.xml')).toBe(false);
  expect(configuredPortal('generic-listing', { listingUrl: 'https://user@www.maison.example/carrieres/' })).toBeNull();
});
it('refuses every vendor host a contract can build as a reviewed official domain, and marks vendor-hosted portals', () => {
  // Prémisse : ces contrats construisent leur URL sur l'hôte du vendeur ; si l'un manquait à la liste, un portail se prouverait par son propre hôte.
  const built: [string, Record<string, unknown>][] = [
    ['ashby', { board: 'maison' }], ['recruitee', { subdomain: 'maison' }], ['teamtailor', { origin: 'https://maison.teamtailor.com' }], ['greenhouse', { board: 'maison' }],
    ['smartrecruiters-whitelabel', { company: 'maison' }], ['lever', { site: 'maison' }], ['lever', { site: 'maison', region: 'eu' }], ['personio', { host: 'maison.jobs.personio.de' }],
    ['workable', { account: 'maison' }], ['workday', { tenant: 'maison', site: 'Stores', origin: 'https://maison.wd3.myworkdayjobs.com' }],
    ['flatchr', { listingUrl: 'https://careers.flatchr.io/company/maison' }], ['talentview', { slug: 'maison' }],
    ['successfactors', { origin: 'https://jobs.maison.successfactors.eu' }], ['talentsoft', { origin: 'https://maison-career.talent-soft.com' }], ['jibe', { origin: 'https://maison.jibeapply.com' }],
  ];
  for (const [kind, config] of built) {
    const portal = configuredPortal(kind, config)!;
    const host = new URL(portal.url).hostname; const registrable = host.split('.').slice(-2).join('.');
    expect(portal.vendorHosted, `${kind} ${host}`).toBe(true);
    expect(() => reviewedOfficialDomain(registrable), `${kind} ${registrable}`).toThrow();
  }
  for (const [kind, config] of [['teamtailor', { origin: 'https://careers.maison.example' }], ['successfactors', { origin: 'https://careers.maison.example' }], ['generic-listing', { listingUrl: 'https://www.maison.example/carrieres/' }]] as [string, Record<string, unknown>][]) {
    expect(configuredPortal(kind, config)!.vendorHosted, kind).toBe(false);
  }
});
it('does not guess unsupported portals from domain names or generic URL settings', () => {
  expect(configuredPortal('unknown', { origin: 'https://jobs.ashbyhq.com/maison' })).toBeNull();
  expect(configuredPortal('ashby', { board: { name: 'maison' } })).toBeNull();
});
