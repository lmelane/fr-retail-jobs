import '../test/setup-integration.js';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { captureSourceEvidence } from '../capture/sourceEvidence.js';
import { inspectSourceRelation } from '../connectors/sourceRelation.js';

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
