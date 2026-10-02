import '../test/setup-integration.js';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ingestSyntheticFeed, qualifiedSource, releaseQualifiedSources } from '../test/ingestionFixture.js';
import { checkSourceHealth } from './health.js';
import { classifySourceRun } from './ingestOrchestrator.js';
import { summarizeOrchestration } from '../lib/runSummary.js';
import { log } from '../observability/logger.js';
import { syncIdentityQueue, readIdentityQueue } from '../identity/reviewQueue.js';
import type { NormalizedJob } from '../types.js';

/**
 * D-520, CLASSE IDENTITÉ D'EMPLOYEUR, PAR L'INGESTION DE PRODUCTION. Seul l'amont HTTP est synthétique
 * (`ingestionFixture.ts`) ; comme `publisher-follow.ingest.test.ts`, le flux Ashby lit `employerName` comme un libellé
 * natif. Sans `employer`, l'offre ne nomme pas d'employeur : le registre la propose (`SOURCE_CATALOGUE_LABEL`).
 *
 * Chaque cas affirme d'abord sa PRÉMISSE (le défaut est bien atteint), puis le comportement. Sur la version d'avant ce
 * lot, chacun échoue : l'offre au libellé omis et la nouvelle graphie de la Maison étaient refusées, et tout refus
 * d'identité faisait échouer le RUN (`UNRESOLVED_FAILURE`) sans file de revue.
 */
vi.mock('../ats/adapters/ashby.js', async importOriginal => {
  const original = await importOriginal<typeof import('../ats/adapters/ashby.js')>();
  const named = (job: NormalizedJob): NormalizedJob => {
    const label = (job.raw as { employerName?: unknown } | undefined)?.employerName;
    return typeof label === 'string' ? { ...job, company: label, employerEvidence: { rawName: label, path: 'synthetic.employerName', rule: 'SYNTHETIC_NATIVE_LABEL' } } : job;
  };
  return {
    ...original,
    fetchAshbyJobs: async (config: Record<string, unknown>) => {
      const result = await original.fetchAshbyJobs(config);
      return { ...result, jobs: result.jobs.map(named) };
    },
    parseAshbyJob: (...args: Parameters<typeof original.parseAshbyJob>) => {
      const job = original.parseAshbyJob(...args);
      return job && named(job);
    },
  };
});

const db = new PrismaClient();
afterAll(async () => { await releaseQualifiedSources(db); await db.$disconnect(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

type Posting = { id: string; employer?: string };
const feed = (postings: Posting[]) => JSON.stringify({ apiVersion: '1', jobs: postings.map(({ id, employer }) => ({
  id, title: `Conseiller de vente ${id}`, isListed: true, descriptionPlain: 'Native responsibilities',
  ...(employer === undefined ? {} : { employerName: employer }) })) });
const ingest = (key: string, postings: Posting[]) => ingestSyntheticFeed(db, key, feed(postings));
const employerOf = async (key: string, externalId: string) => (await db.jobSource.findUniqueOrThrow({
  where: { sourceKey_externalId: { sourceKey: key, externalId } }, select: { job: { select: { companyId: true, company: { select: { name: true } } } } } })).job!;
const lastRule = async (key: string, externalId: string) => (await db.employerObservation.findFirstOrThrow({
  where: { sourceKey: key, externalId }, orderBy: [{ observedAt: 'desc' }, { id: 'desc' }] })).rule;
const queueOf = (key: string) => db.employerIdentityQueue.findMany({ where: { sourceKey: key }, orderBy: { normalizedLabel: 'asc' } });
/** Le verdict du RUN pour cette seule source, tel que l'orchestrateur et le bilan l'appliquent. */
async function runVerdict(key: string, stats: Awaited<ReturnType<typeof ingest>>) {
  const health = await checkSourceHealth(db, [stats]);
  const { issues, incidents } = classifySourceRun([stats], health.incidents);
  const summary = summarizeOrchestration({ total: 1, ok: issues.length ? 0 : 1, failed: issues.length ? 1 : 0, timedOut: 0,
    failures: issues.length ? [`${key} (x)`] : [], incidents, issues: issues.map(issue => ({ ...issue, source: key })) } as never);
  return { incidents, summary };
}

const NORD = 'Atelier Nord SAS';

describe('D-520 — identité d’employeur : ce qui se prouve est absorbé, le reste est retenu en file de revue', () => {
  it('libellé omis : l’offre que l’éditeur avait nommée garde son employeur sur un portail non relu', async () => {
    const key = `identite-omis-${randomUUID()}`;
    await ingest(key, [{ id: 'p1', employer: NORD }]);
    const before = await employerOf(key, 'p1');
    // PRÉMISSE : le portail n'est pas relu (aucun périmètre), et p1 a été rattachée par le libellé natif de l'éditeur.
    expect((await db.source.findUniqueOrThrow({ where: { key } })).portalScope).toBeNull();
    expect(before.company.name).toBe(NORD);
    expect(await lastRule(key, 'p1')).toBe('NATIVE_SOURCE_LABEL');

    const stats = await ingest(key, [{ id: 'p1' }]);
    expect(stats).toMatchObject({ errors: 0, updated: 1 });
    expect(stats.writeFailures).toBeUndefined();
    expect((await employerOf(key, 'p1')).companyId).toBe(before.companyId);
    expect(await db.employerObservation.findFirst({ where: { sourceKey: key, externalId: 'p1', rule: 'NATIVE_LABEL_OMITTED_KEPT' } }))
      .toMatchObject({ labelOrigin: 'SOURCE_CATALOGUE_LABEL', canonicalEmployerId: before.companyId });
    expect(await queueOf(key)).toEqual([]);
  });

  it('libellé omis : rien n’est gardé si la dernière déclaration de l’éditeur a été refusée, ni pour une offre neuve', async () => {
    const key = `identite-omis-refuse-${randomUUID()}`;
    const EST = `Atelier Est ${randomUUID().slice(0, 8)} SAS`;
    await ingest(key, [{ id: 'p1', employer: NORD }]);
    // L'éditeur nomme ensuite un employeur jamais vu : refusé, en revue.
    const refused = await ingest(key, [{ id: 'p1', employer: EST }]);
    expect(refused).toMatchObject({ errors: 1, writeFailures: { 'EmployerIdentityReviewRequired:EMPLOYER_SPELLING_DIVERGED': 1 } });
    // Puis il ne nomme plus personne : sa dernière déclaration (refusée) ne désigne pas Atelier Nord, rien n'est gardé.
    const stats = await ingest(key, [{ id: 'p1' }, { id: 'neuve' }]);
    expect(stats).toMatchObject({ errors: 2, writeFailures: { 'EmployerIdentityReviewRequired:PORTAL_OWNER_NOT_CERTIFIED': 2 } });
    expect(await db.jobSource.findUnique({ where: { sourceKey_externalId: { sourceKey: key, externalId: 'neuve' } } })).toBeNull();
  });

  it('même Maison du registre : une nouvelle graphie de la Maison de la source ne bloque plus, l’offre ne bouge pas', async () => {
    const tag = randomUUID().slice(0, 8);
    const key = `maison${tag}`;
    await qualifiedSource(db, key);
    await db.source.update({ where: { key }, data: { portalScope: 'SINGLE_BRAND' } });
    // PRÉMISSE : la Maison au registre est le nom de la source ; p1 y est rattachée par le registre.
    await ingest(key, [{ id: 'p1' }, { id: 'p2' }]);
    const before = await employerOf(key, 'p1');
    expect((await db.employerObservation.findFirstOrThrow({ where: { sourceKey: key, externalId: 'p1' } })).labelOrigin).toBe('SOURCE_CATALOGUE_LABEL');

    // L'éditeur nomme désormais l'entité juridique de la Maison (nom complet prolongé) — et, pour p2, un autre employeur.
    const stats = await ingest(key, [{ id: 'p1', employer: `MAISON${tag.toUpperCase()} S.A.S.` }, { id: 'p2', employer: 'Atelier Sud SAS' }]);
    expect(stats).toMatchObject({ errors: 1, writeFailures: { 'EmployerIdentityReviewRequired:EMPLOYER_SPELLING_DIVERGED': 1 } });
    expect(await employerOf(key, 'p1')).toEqual(before);
    expect(await lastRule(key, 'p1')).toBe('SAME_REGISTRY_MAISON');
    // p2 (un autre nom) reste en revue, avec sa question.
    expect((await queueOf(key)).map(e => [e.motif, e.rawLabel, e.offers])).toEqual([['EMPLOYER_SPELLING_DIVERGED', 'Atelier Sud SAS', 1]]);
  });

  it('le refus non prouvé est retenu, mis en file avec sa question, et ne fait plus échouer le RUN', async () => {
    const key = `identite-file-${randomUUID()}`;
    const events = vi.spyOn(log, 'info');
    const stats = await ingest(key, [{ id: 'a' }, { id: 'b' }, { id: 'c', employer: NORD }]);
    // PRÉMISSE : deux offres sans employeur sur un portail non relu, refusées comme avant ce lot.
    expect(stats).toMatchObject({ errors: 2, created: 1, writeFailures: { 'EmployerIdentityReviewRequired:PORTAL_OWNER_NOT_CERTIFIED': 2 } });
    for (const id of ['a', 'b']) expect(await db.jobSource.findUnique({ where: { sourceKey_externalId: { sourceKey: key, externalId: id } } })).toBeNull();

    const [entry] = await queueOf(key);
    expect(entry).toMatchObject({ motif: 'PORTAL_OWNER_NOT_CERTIFIED', normalizedLabel: key, proposedKey: '', proposedName: null, offers: 2,
      sampleExternalIds: ['a', 'b'], collections: 1, resolvedAt: null, escalatedAt: null });
    expect(entry.missingProof).toContain('R-142 §3');
    expect(entry.question).toContain(`Le portail ${key}`);
    expect(entry.question).toContain('Offres sans employeur nommé : 2.');
    // Une source qui publie encore : échéance à 7 jours.
    expect(entry.escalateAt.getTime() - entry.firstSeenAt.getTime()).toBe(7 * 24 * 3_600_000);
    expect(stats.identityReview).toEqual({ open: 1, opened: 1, escalated: 0, resolved: 0, offers: 2 });
    expect(events.mock.calls.filter(call => call[0] === 'employer.identity_review_opened')).toHaveLength(1);

    const { incidents, summary } = await runVerdict(key, stats);
    expect(incidents).toMatchObject([{ source: key, blocking: false }]);
    expect(summary.blockingReasons).toEqual([]);
    expect(summary.outcome).toBe('COMPLETED_WITH_ERRORS');
    expect(summary.nonBlockingCauses).toContain('EMPLOYER_IDENTITY_REVIEW');
    expect(summary.identityReview).toMatchObject({ sources: 1, postings: 2 });

    // La collecte suivante, identique, met l'entrée à jour sans en ouvrir une autre.
    const again = await ingest(key, [{ id: 'a' }, { id: 'b' }, { id: 'c', employer: NORD }]);
    expect(again.identityReview).toMatchObject({ open: 1, opened: 0 });
    expect((await queueOf(key))[0]).toMatchObject({ id: entry.id, collections: 2, firstSeenAt: entry.firstSeenAt });

    // Le portail est relu : la collecte complète suivante publie sous le registre et résout l'entrée.
    await db.source.update({ where: { key }, data: { portalScope: 'SINGLE_BRAND' } });
    const resolved = await ingest(key, [{ id: 'a' }, { id: 'b' }, { id: 'c', employer: NORD }]);
    expect(resolved).toMatchObject({ errors: 0 });
    expect(resolved.identityReview).toMatchObject({ open: 0, resolved: 1 });
    expect((await queueOf(key))[0].resolvedAt).not.toBeNull();
  });

  it('une entrée échue est escaladée une fois ; la file ouverte la met en tête', async () => {
    const key = `identite-echue-${randomUUID()}`;
    await qualifiedSource(db, key);
    const t0 = new Date('2026-09-24T16:00:00Z');
    const refusals = [{ externalId: 'x1', rawEmployerName: 'Altex S.A.', proposedName: 'Funky Buddha', motif: 'EMPLOYER_SPELLING_DIVERGED' as const }];
    const first = await syncIdentityQueue(db, { sourceKey: key, refusals, captureBatchId: 'b1', published: 0, complete: true, now: t0 });
    expect(first).toMatchObject({ opened: 1, escalated: 0 });
    // Source qui ne publie plus rien : échéance à 48 h.
    const [entry] = await queueOf(key);
    expect(entry.escalateAt.toISOString()).toBe('2026-09-26T16:00:00.000Z');
    expect(entry.question).toContain('« Altex S.A. » est-il « Funky Buddha »');
    const warnings = vi.spyOn(log, 'warn');
    expect(await syncIdentityQueue(db, { sourceKey: key, refusals, captureBatchId: 'b2', published: 0, complete: true, now: new Date('2026-09-25T16:00:00Z') }))
      .toMatchObject({ escalated: 0 });
    expect(await syncIdentityQueue(db, { sourceKey: key, refusals, captureBatchId: 'b3', published: 0, complete: true, now: new Date('2026-09-26T16:00:00Z') }))
      .toMatchObject({ escalated: 1 });
    expect(await syncIdentityQueue(db, { sourceKey: key, refusals, captureBatchId: 'b4', published: 0, complete: true, now: new Date('2026-09-27T16:00:00Z') }))
      .toMatchObject({ escalated: 0, open: 1 });
    expect(warnings.mock.calls.filter(call => call[0] === 'employer.identity_review_escalated')).toHaveLength(1);
    const open = (await readIdentityQueue(db, new Date('2026-09-27T16:00:00Z'))).filter(e => e.sourceKey === key);
    expect(open).toMatchObject([{ overdue: true, collections: 4, ageDays: 3 }]);
    // Une collecte incomplète ne résout rien ; une complète sans ce refus la résout.
    expect(await syncIdentityQueue(db, { sourceKey: key, refusals: [], captureBatchId: 'b5', published: 1, complete: false, now: new Date('2026-09-28T16:00:00Z') }))
      .toMatchObject({ resolved: 0, open: 1 });
    expect(await syncIdentityQueue(db, { sourceKey: key, refusals: [], captureBatchId: 'b6', published: 1, complete: true, now: new Date('2026-09-28T17:00:00Z') }))
      .toMatchObject({ resolved: 1, open: 0 });
  });
});
