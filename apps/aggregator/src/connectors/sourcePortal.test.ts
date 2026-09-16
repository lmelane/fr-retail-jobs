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
it('does not guess unsupported portals from domain names or generic URL settings', () => {
  expect(configuredPortal('unknown', { origin: 'https://jobs.ashbyhq.com/maison' })).toBeNull();
  expect(configuredPortal('ashby', { board: { name: 'maison' } })).toBeNull();
});
