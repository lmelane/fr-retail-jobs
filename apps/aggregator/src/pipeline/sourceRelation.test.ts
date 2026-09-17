import '../test/setup-integration.js';
import { PrismaClient, type Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { captureSourceEvidence } from '../capture/sourceEvidence.js';
import { inspectSourceRelation } from '../connectors/sourceRelation.js';
import { syntheticFetch, type SyntheticRedirects } from '../test/sourceIdentityFixture.js';

const db = new PrismaClient(); const keys: string[] = [];
async function fixture(body: (portal: string) => string, options: { status?: number; type?: string; url?: string; purpose?: 'SOURCE_IDENTITY' | 'SOURCE_ACCESS' } = {}) {
  const key = `relation-${randomUUID()}`; keys.push(key);
  const source = await db.source.create({ data: { key, maison: 'Relation fixture', kind: 'ashby', config: { board: key }, tier: 'ATS_OFFICIAL', tenantKey: key, status: 'DRAFT' } });
  const portal = `https://jobs.ashbyhq.com/${key}`;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body(portal), { status: options.status ?? 200, headers: { 'content-type': options.type ?? 'text/html; charset=utf-8' } })));
  const receipt = await captureSourceEvidence(db, key, { revisionId: source.currentRevisionId, purpose: options.purpose ?? 'SOURCE_IDENTITY',
    url: options.url ?? 'https://www.maison.example/careers', deadlineMs: 15000 });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Relation inspection must stay offline'); }));
  return { source, portal, receipt, inspect: () => inspectSourceRelation(db, key, { captureBatchId: receipt.captureBatchId, officialDomain: 'maison.example' }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
/** Un site carrière rendu côté client : aucun lien vers lui-même dans le HTML archivé ; l'éditeur peut rediriger. */
async function siteFixture(kind: string, config: Record<string, unknown>, capturedUrl: string, redirects: SyntheticRedirects = {}, body = '<!doctype html><html><head><title>Careers</title></head><body><div id="app"></div></body></html>') {
  const key = `relation-${randomUUID()}`; keys.push(key);
  const source = await db.source.create({ data: { key, maison: 'Relation fixture', kind, config: config as Prisma.InputJsonObject, tier: 'EMPLOYER_DIRECT', tenantKey: key, status: 'DRAFT' } });
  vi.stubGlobal('fetch', syntheticFetch(() => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }), redirects));
  const receipt = await captureSourceEvidence(db, key, { revisionId: source.currentRevisionId, purpose: 'SOURCE_IDENTITY', url: capturedUrl, deadlineMs: 15000 });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Relation inspection must stay offline'); }));
  return { source, receipt, inspect: () => inspectSourceRelation(db, key, { captureBatchId: receipt.captureBatchId, officialDomain: 'maison.example' }) };
}
afterAll(async () => { await db.source.deleteMany({ where: { key: { in: keys } } }); await db.$disconnect(); });

it('finds an actual archived link without writing a review or changing the source', async () => {
  const f = await fixture(url => `<a href="${url}?utm_source=Maison&amp;utm_medium=footer">Rejoindre la Maison</a>`);
  expect(await f.inspect()).toMatchObject({ verdict: 'LINK_MATCHED', identityApproved: false, configuredPortal: f.portal,
    sourceRevisionId: f.source.currentRevisionId, witness: { element: 'a', attribute: 'href' } });
  expect(await db.sourceIdentityReview.count({ where: { sourceKey: f.source.key } })).toBe(0);
  expect(await db.source.findUniqueOrThrow({ where: { key: f.source.key } })).toEqual(f.source);
});

it.each([
  (url: string) => `<!-- <a href="${url}">Careers</a> -->`,
  (url: string) => `<script>const html = '<a href="${url}">Careers</a>';</script>`,
  (url: string) => `<template><a href="${url}">Careers</a></template>`,
  (url: string) => `<p>${url}</p>`,
  (url: string) => `<a data-target="${url}" href="https://other.example/">Careers</a>`,
  (url: string) => `<iframe src="${url}" srcdoc="<p>Unrelated content</p>"></iframe>`,
])('rejects a mention without an active matching reference %#', async body => {
  const f = await fixture(body);
  expect(await f.inspect()).toMatchObject({ verdict: 'NOT_PROVEN', reason: 'EXACT_PORTAL_REFERENCE_NOT_FOUND' });
});

it('resolves document base URLs and genuine iframe sources', async () => {
  const f = await fixture(url => `<base href="${url}/"><iframe src="./"></iframe>`);
  expect(await f.inspect()).toMatchObject({ verdict: 'LINK_MATCHED', witness: { element: 'iframe', attribute: 'src' } });
});

it.each([
  [{ status: 403 }, 'HTTP_RESPONSE_NOT_USABLE'],
  [{ type: 'text/plain' }, 'HTML_DOCUMENT_REQUIRED'],
  [{ url: 'https://www.maison.example.evil.example/careers' }, 'PAGE_OUTSIDE_REVIEWED_DOMAIN'],
  [{ purpose: 'SOURCE_ACCESS' as const }, 'IDENTITY_CAPTURE_REQUIRED'],
] as const)('refuses unusable evidence %j', async (options, reason) => {
  const f = await fixture(url => `<a href="${url}">Careers</a>`, options);
  expect(await f.inspect()).toMatchObject({ verdict: 'NOT_PROVEN', reason });
});

it('proves the relation by the portal itself when it is served under the reviewed official domain (custom domain), never for a vendor host', async () => {
  // Prémisse : la page archivée EST le portail (aucun lien HTML vers lui), et son hôte est un sous-domaine propre de maison.example.
  const custom = await siteFixture('teamtailor', { origin: 'https://careers.maison.example' }, 'https://careers.maison.example/');
  expect(await custom.inspect()).toMatchObject({ verdict: 'LINK_MATCHED', configuredPortal: 'https://careers.maison.example/', witness: { element: 'document', attribute: 'url', ordinal: 0, queryKeys: [] } });
  // Le listing du même site, avec un filtre natif d'affichage, reste le portail ; l'apex n'en est jamais un.
  const listing = await siteFixture('teamtailor', { origin: 'https://careers.maison.example' }, 'https://careers.maison.example/jobs?split_view=true');
  expect(await listing.inspect()).toMatchObject({ verdict: 'LINK_MATCHED', witness: { element: 'document', queryKeys: ['split_view'] } });
  const vendor = await siteFixture('teamtailor', { origin: 'https://maison.teamtailor.com' }, 'https://maison.teamtailor.com/');
  expect(await vendor.inspect()).toMatchObject({ verdict: 'NOT_PROVEN', reason: 'PAGE_OUTSIDE_REVIEWED_DOMAIN' });
  const apexPage = await siteFixture('teamtailor', { origin: 'https://careers.maison.example' }, 'https://www.maison.example/');
  expect(await apexPage.inspect()).toMatchObject({ verdict: 'NOT_PROVEN', reason: 'EXACT_PORTAL_REFERENCE_NOT_FOUND' });
});

it('proves the relation by the portal\'s own canonical redirect to the reviewed official domain, never through another tenant, domain or page', async () => {
  // Prémisse : l'origine configurée est l'hôte vendeur ; demandée telle quelle, l'éditeur la redirige (301) vers careers.maison.example, qui rend le listing sans lien HTML.
  const vendor = 'https://maison.teamtailor.com';
  const proven = await siteFixture('teamtailor', { origin: vendor }, `${vendor}/`, { [`${vendor}/`]: { status: 301, location: 'https://careers.maison.example/' } });
  const report = await proven.inspect() as { verdict: string; proofUrl?: string; canonicalPortal?: string; redirectChain?: unknown[] };
  expect(report).toMatchObject({ verdict: 'LINK_MATCHED', configuredPortal: `${vendor}/`, canonicalPortal: 'https://careers.maison.example/', witness: { element: 'document', attribute: 'url', ordinal: 1, queryKeys: [] },
    redirectChain: [{ url: `${vendor}/`, status: 301 }, { url: 'https://careers.maison.example/', status: 200 }] });
  expect(report.proofUrl).toBe(report.canonicalPortal);
  // Témoins négatifs : redirection vers un autre domaine, via un autre tenant du vendeur, vers une page d'offre, ou depuis une page d'offre.
  for (const [captured, redirects, reason] of [
    [`${vendor}/`, { [`${vendor}/`]: { status: 301, location: 'https://careers.other.example/' } }, 'PAGE_OUTSIDE_REVIEWED_DOMAIN'],
    [`${vendor}/`, { [`${vendor}/`]: { status: 302, location: 'https://other.teamtailor.com/' }, 'https://other.teamtailor.com/': { status: 301, location: 'https://careers.maison.example/' } }, 'PAGE_OUTSIDE_REVIEWED_DOMAIN'],
    [`${vendor}/`, { [`${vendor}/`]: { status: 301, location: 'https://careers.maison.example/jobs/1-vendeur' } }, 'PAGE_OUTSIDE_REVIEWED_DOMAIN'],
    [`${vendor}/jobs/1-vendeur`, { [`${vendor}/jobs/1-vendeur`]: { status: 301, location: 'https://careers.maison.example/' } }, 'PAGE_OUTSIDE_REVIEWED_DOMAIN'],
    [`${vendor}/`, { [`${vendor}/`]: { status: 301, location: 'https://www.maison.example/' } }, 'PAGE_OUTSIDE_REVIEWED_DOMAIN'],
  ] as const) {
    const f = await siteFixture('teamtailor', { origin: vendor }, captured, redirects as SyntheticRedirects);
    expect(await f.inspect()).toMatchObject({ verdict: 'NOT_PROVEN', reason });
  }
});

it('proves a generic listing configured on the official www host by its own page, never by the homepage or a deeper page', async () => {
  const config = { listingUrl: 'https://www.maison.example/carrieres/?page={page}' };
  const listing = await siteFixture('generic-listing', config, 'https://www.maison.example/carrieres/?page=2');
  expect(await listing.inspect()).toMatchObject({ verdict: 'LINK_MATCHED', configuredPortal: 'https://www.maison.example/carrieres/', witness: { element: 'document', ordinal: 0, queryKeys: ['page'] } });
  const home = await siteFixture('generic-listing', config, 'https://www.maison.example/');
  expect(await home.inspect()).toMatchObject({ verdict: 'NOT_PROVEN', reason: 'EXACT_PORTAL_REFERENCE_NOT_FOUND' });
  const deeper = await siteFixture('generic-listing', config, 'https://www.maison.example/carrieres/vendeur-paris-1');
  expect(await deeper.inspect()).toMatchObject({ verdict: 'NOT_PROVEN', reason: 'EXACT_PORTAL_REFERENCE_NOT_FOUND' });
});

it('accepts an official page that lists the board\'s own postings, prefers the exact listing, and refuses another board\'s postings', async () => {
  // Prémisse : la page officielle ne lie PAS le board (aucune référence exacte), seulement deux de ses offres.
  const postings = await fixture(url => `<a href="${url}/2f1c1a1e-0000-4000-8000-000000000001">Vendeur</a><a href="${url}/2f1c1a1e-0000-4000-8000-000000000002">Manager</a>`);
  expect(await postings.inspect()).toMatchObject({ verdict: 'LINK_MATCHED', witness: { element: 'a', attribute: 'href', ordinal: 0, reference: 'posting' } });
  const both = await fixture(url => `<a href="${url}/2f1c1a1e-0000-4000-8000-000000000001">Vendeur</a><a href="${url}">Toutes les offres</a>`);
  expect(await both.inspect()).toMatchObject({ verdict: 'LINK_MATCHED', witness: { ordinal: 1, reference: 'portal' } });
  const other = await fixture(url => `<a href="${url}-other/2f1c1a1e-0000-4000-8000-000000000001">Vendeur</a>`);
  expect(await other.inspect()).toMatchObject({ verdict: 'NOT_PROVEN', reason: 'EXACT_PORTAL_REFERENCE_NOT_FOUND' });
});

it('accepts the Greenhouse embed loader as an active script reference, never the board named only in inline script text', async () => {
  const page = 'https://www.maison.example/careers';
  const embed = await siteFixture('greenhouse', { board: 'maisonboard' }, page, {}, '<html><body><div id="grnhse_app"></div><script src="https://boards.greenhouse.io/embed/job_board/js?for=maisonboard"></script></body></html>');
  expect(await embed.inspect()).toMatchObject({ verdict: 'LINK_MATCHED', configuredPortal: 'https://boards.greenhouse.io/maisonboard', witness: { element: 'script', attribute: 'src', ordinal: 0, reference: 'portal' } });
  const otherBoard = await siteFixture('greenhouse', { board: 'maisonboard' }, page, {}, '<html><body><script src="https://boards.greenhouse.io/embed/job_board/js?for=other"></script></body></html>');
  expect(await otherBoard.inspect()).toMatchObject({ verdict: 'NOT_PROVEN', reason: 'EXACT_PORTAL_REFERENCE_NOT_FOUND' });
  const inline = await siteFixture('greenhouse', { board: 'maisonboard' }, page, {}, '<html><body><script>fetch("https://boards-api.greenhouse.io/v1/boards/maisonboard/jobs");const a=\'<a href="https://boards.greenhouse.io/maisonboard">jobs</a>\';</script></body></html>');
  expect(await inline.inspect()).toMatchObject({ verdict: 'NOT_PROVEN', reason: 'EXACT_PORTAL_REFERENCE_NOT_FOUND' });
});

it('does not qualify a 200 challenge document with a matching link', async () => {
  const f = await fixture(url => `<title>Just a moment...</title><a href="${url}">Careers</a>`);
  expect(await f.inspect()).toMatchObject({ verdict: 'NOT_PROVEN', reason: 'CHALLENGE_DOCUMENT' });
});

it('rejects a reference to another board even when the vendor is correct', async () => {
  const f = await fixture(url => `<a href="${url}-other">Careers</a>`);
  expect(await f.inspect()).toMatchObject({ verdict: 'NOT_PROVEN', reason: 'EXACT_PORTAL_REFERENCE_NOT_FOUND' });
});

it('keeps the relation bound to its captured registry revision and observation date', async () => {
  const f = await fixture(url => `<a href="${url}">Careers</a>`);
  expect(await inspectSourceRelation(db, f.source.key, { captureBatchId: f.receipt.captureBatchId, officialDomain: 'maison.example' }, undefined,
    new Date(Date.now() + 31 * 86_400_000))).toMatchObject({ verdict: 'NOT_PROVEN', reason: 'CAPTURE_STALE' });
  await db.source.update({ where: { key: f.source.key }, data: { config: { board: 'changed' } } });
  await db.source.update({ where: { key: f.source.key }, data: { config: f.source.config! } });
  expect(await f.inspect()).toMatchObject({ verdict: 'NOT_PROVEN', reason: 'CAPTURE_REVISION_MISMATCH' });
});

it('refuses a source that changes while its archived page is being read', async () => {
  const f = await fixture(url => `<a href="${url}">Careers</a>`); let changed = false;
  const instrumented = new Proxy(db, { get(target, key) {
    if (key !== 'rawBlob') return Reflect.get(target, key);
    return new Proxy(target.rawBlob, { get(model, field) {
      if (field !== 'findUniqueOrThrow') return Reflect.get(model, field);
      return async (args: Parameters<typeof model.findUniqueOrThrow>[0]) => {
        if (!changed) { changed = true; await db.source.update({ where: { key: f.source.key }, data: { config: { board: 'changed' } } }); }
        return model.findUniqueOrThrow(args);
      };
    } });
  } });
  expect(await inspectSourceRelation(instrumented, f.source.key, { captureBatchId: f.receipt.captureBatchId, officialDomain: 'maison.example' }))
    .toMatchObject({ verdict: 'NOT_PROVEN', reason: 'SOURCE_CHANGED_DURING_INSPECTION' });
});

it('does not hide storage failures as an absent official link', async () => {
  const f = await fixture(url => `<a href="${url}">Careers</a>`);
  vi.spyOn(db.rawBlob, 'findUniqueOrThrow').mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(f.inspect()).rejects.toThrow('Storage unavailable');
});
