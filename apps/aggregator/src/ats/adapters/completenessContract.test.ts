import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn(), fetchJson: vi.fn() }));
vi.mock('../../observability/logger.js', () => ({ log: { error: vi.fn(async () => {}), info: vi.fn(async () => {}), warn: vi.fn(async () => {}), runId: () => undefined } }));
import { fetchJson, fetchText } from '../../lib/http.js';
import { fetchGenericJsonLdJobs } from './genericJsonLd.js';
import { fetchPinpointJobs } from './pinpoint.js';
import { fetchAshbyJobs } from './ashby.js';
import { normalizeAdapterResult } from '../index.js';
import { evaluateSourceHealth } from '../../pipeline/health.js';
import { readEnumeration } from '../../pipeline/enumerationReading.js';
import { failureLine, summarizeOrchestration } from '../../lib/runSummary.js';
import { classifySourceRun } from '../../pipeline/ingestOrchestrator.js';
import type { IngestStats } from '../../pipeline/ingest.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * LES TROIS LECTURES D'UNE ÉNUMÉRATION, À LA LETTRE DE D-453 §1 (arbitrage CEO du 24/09/2026, précisé le 25/09).
 *
 *   · ABSENTE (`complete` absent)  → inconnue : aucun incident (règle du 11/09) ;
 *   · NON PROUVÉE                  → échec BLOQUANT à instruire, dit « non prouvée » ;
 *   · RÉFUTÉE                      → échec BLOQUANT, dit « réfutée ».
 *
 * Au RUN du 24/09, cinq sources (attaquer, kastner-ohler, lumentee, marc-o-polo : lien depuis une page d'accueil ;
 * picard : flux Atom) étaient dites « réfutées » alors que rien n'avait été vu qui contredise leur énumération.
 * Le correctif porte sur l'ÉTIQUETTE et le CODE d'attribution, jamais sur l'incident, et jamais sur la sortie de
 * l'adaptateur : `complete: false` reste scellé tel quel, sans quoi le rejeu des collectes antérieures divergerait
 * (REPLAY_RESULT_CHANGED) et la validation lirait UNKNOWN au lieu d'INCOMPLETE.
 *
 * Le chemin est celui du RUN : adaptateur → `normalizeAdapterResult` → `readEnumeration` (ce qu'`ingest.ts`
 * enregistre) → `evaluateSourceHealth` → `issuesFromResult` → `summarizeOrchestration`.
 */
const posting = (id: string) => `<html><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: `Poste ${id}`,
  datePosted: '2026-09-01', description: 'Une annonce réelle, complète, suffisamment longue pour être lue.', hiringOrganization: { '@type': 'Organization', name: 'Maison' },
  jobLocation: { '@type': 'Place', address: { addressLocality: 'Paris', addressCountry: 'FR' } } })}</script></html>`;
const serve = (route: (url: string) => string | Error) => vi.mocked(fetchText).mockImplementation(async (url: string) => {
  const body = route(url); if (body instanceof Error) throw body; return body;
});
beforeEach(() => vi.resetAllMocks());

/** One established source run of this adapter result, read by the RUN exactly as `ingestOne` reads it. */
function runOf(normalized: AdapterResult, source = 'witness') {
  const jobs = normalized.jobs.length;
  const stat: IngestStats = { source, complete: normalized.complete, declaredTotal: normalized.declaredTotal, truncated: normalized.truncated,
    ...readEnumeration(normalized), fetched: jobs, inSector: jobs, france: jobs, created: 0, merged: 0, updated: jobs, errors: 0,
    withDescription: jobs, withDate: jobs, withCountry: jobs, withUrl: jobs, captureBatchId: 'batch', completionReportHash: 'report' };
  const health = evaluateSourceHealth(stat, jobs);
  const { issues, incidents } = classifySourceRun([stat], health.status === 'DEGRADED' || health.status === 'BROKEN' ? [health] : []);
  const summary = summarizeOrchestration({ total: 2, ok: issues.length ? 1 : 2, failed: issues.length ? 1 : 0, timedOut: 0,
    failures: issues.length ? [failureLine(source, issues, 'erreurs d’ingestion')] : [], incidents, issues: issues.map(issue => ({ ...issue, source })) });
  return { stat, health, incidents, issues, summary };
}

describe('ABSENTE — `complete` absent : inconnue, aucun incident (règle du 11/09)', () => {
  it('a whole-board feed that announces no total (Pinpoint) stays unknown and raises nothing', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ jobs: [{ id: '1', title: 'Conseiller de vente', status: 'open' }, { id: '2', title: 'Responsable boutique', status: 'open' }] });
    const normalized = normalizeAdapterResult(await fetchPinpointJobs({ origin: 'https://joinus.example' }));
    // Premise: the adapter claims nothing — `complete` is ABSENT, not false.
    expect(normalized.jobs).toHaveLength(2);
    expect(normalized).toMatchObject({ enumerationVerdict: 'UNKNOWN' });
    expect(normalized.complete).toBeUndefined();
    const { stat, incidents, issues, summary } = runOf(normalized);
    expect(stat.enumerationReading).toBe('UNKNOWN');
    expect(incidents).toEqual([]);
    expect(issues).toEqual([]);
    expect(summary.outcome).toBe('COMPLETED');
  });
});

describe('NON PROUVÉE — `complete: false` sans aucune coupure observée ni limite de famille nommée : bloquante, jamais « réfutée »', () => {
  const expectNotProven = (normalized: AdapterResult) => {
    const { stat, health, issues, summary } = runOf(normalized);
    expect(stat.enumerationReading).toBe('NOT_PROVEN');
    expect(health).toMatchObject({ status: 'DEGRADED', finding: 'ENUMERATION_NOT_PROVEN' });
    expect(health.note).toContain('énumération non prouvée');
    expect(health.note).not.toContain('réfutée');
    expect(issues).toEqual([{ origin: 'UNKNOWN', code: 'ENUMERATION_NOT_PROVEN', count: 1 }]);
    // Still a failure to instruct (D-453 §1): the RUN fails on it.
    expect(summary).toMatchObject({ outcome: 'FAILED', blockingReasons: ['UNRESOLVED_FAILURE'] });
  };

  it('an Ashby feed with one explained rejection among twenty: the adapter declines the proof, nothing refutes it', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: `job-${i}`, title: `Poste ${i}`, isListed: true, jobUrl: `https://jobs.ashbyhq.com/maison/job-${i}` }));
    vi.mocked(fetchJson).mockResolvedValue({ apiVersion: '1', jobs: [...rows, { id: 'job-untitled', isListed: true, jobUrl: 'https://jobs.ashbyhq.com/maison/job-untitled' }] });
    const raw = await fetchAshbyJobs({ board: 'maison' });
    // Premise: a single explained rejection makes the adapter refuse its proof; coverage 20/21 is not a cut.
    expect(raw).toMatchObject({ complete: false, declaredTotal: 21 });
    expect(raw.rejectedRows?.map(row => row.reason)).toEqual(['MISSING_ID_TITLE_OR_PUBLICATION_FLAG']);
    expectNotProven(normalizeAdapterResult(raw));
  });
});

describe('LISTE INDÉMONTRABLE EN L’ÉTAT (D-520) — le lecteur nomme pourquoi : classée à part, BLOQUANTE (D-453 §1, D-482), sauf échec connu de D-480 §1', () => {
  const expectFamilyLimit = (normalized: AdapterResult, marker: string) => {
    const { stat, health, issues, summary } = runOf(normalized);
    // The reading stays NOT PROVEN — only its class changes; nothing observed refutes it.
    expect(stat).toMatchObject({ enumerationReading: 'NOT_PROVEN', enumerationUnprovable: marker });
    expect(normalized.complete).toBe(false);
    expect(health).toMatchObject({ status: 'DEGRADED', finding: 'ENUMERATION_UNPROVABLE' });
    expect(health.note).toContain('liste indémontrable');
    expect(issues).toEqual([{ origin: 'UNKNOWN', code: 'ENUMERATION_UNPROVABLE', count: 1 }]);
    // Any other source of the family still fails the RUN: no extension of D-480 (D-482).
    expect(summary).toMatchObject({ outcome: 'FAILED', blockingReasons: ['UNRESOLVED_FAILURE'] });
    // The four sources D-480 §1 names keep their known, non-blocking failure under the more precise code.
    const known = runOf(normalized, 'attaquer');
    expect(known.incidents).toEqual([expect.objectContaining({ blocking: false, knownFailure: 'D-480' })]);
    expect(known.summary.blockingReasons).toEqual([]);
  };

  it('picard — a careers Atom feed announces no extent', async () => {
    const entry = readFileSync(new URL('../../connectors/generic/fixtures/picard-atom-entry.xml', import.meta.url), 'utf8');
    serve(() => `<feed xmlns="http://www.w3.org/2005/Atom">${entry}</feed>`);
    const raw = await fetchGenericJsonLdJobs({ feedUrl: 'https://picard-fashion.com/blogs/karriere.atom' });
    // Premise: `complete: false` stays sealed; the feed now NAMES why it cannot prove its extent (D-520).
    expect(raw.jobs).toHaveLength(1);
    expect(raw.complete).toBe(false);
    expect(raw.enumeration).toMatchObject({ method: 'PUBLISHER_FEED_NO_ENUMERATION_PROOF', issues: ['PUBLISHER_FEED_WITHOUT_TOTAL', 'ENUMERATION_NOT_PROVEN'] });
    const normalized = normalizeAdapterResult(raw);
    expect(normalized).toMatchObject({ complete: false, enumerationVerdict: 'REFUTED' });
    expectFamilyLimit(normalized, 'PUBLISHER_FEED_WITHOUT_TOTAL');
  });

  it('attaquer — a start-page link crawl names its missing proof and saw no cut', async () => {
    const start = 'https://www.attaquer.example/pages/careers';
    serve(url => url === start ? '<a href="/jobs/one">1</a><a href="/jobs/two">2</a><a href="/about">x</a>' : posting(url.split('/').pop()!));
    const raw = await fetchGenericJsonLdJobs({ startUrl: start });
    expect(raw.enumeration).toMatchObject({ method: 'START_PAGE_LINK_CRAWL_NO_ENUMERATION_PROOF', termination: 'LINKS_EXHAUSTED',
      issues: ['NO_PUBLISHER_LISTING_OR_SITEMAP', 'ENUMERATION_NOT_PROVEN'] });
    expect(raw).toMatchObject({ complete: false, truncated: false });
    expect(raw.jobs).toHaveLength(2);
    expectFamilyLimit(normalizeAdapterResult(raw), 'NO_PUBLISHER_LISTING_OR_SITEMAP');
  });

  it('the same crawl stopped at its 150-link cap is a cut, not a limit: refuted, blocking', async () => {
    const start = 'https://www.maison.example/careers';
    serve(url => url === start ? Array.from({ length: 151 }, (_, i) => `<a href="/jobs/p${i}">${i}</a>`).join('') : posting(url.split('/').pop()!));
    const normalized = normalizeAdapterResult(await fetchGenericJsonLdJobs({ startUrl: start }));
    const { stat, health, issues, summary } = runOf(normalized);
    expect(stat.enumerationReading).toBe('REFUTED'); expect(stat.enumerationUnprovable).toBeUndefined();
    expect(health.finding).toBe('ENUMERATION_TRUNCATED');
    expect(issues.map(issue => issue.code)).toEqual(['ENUMERATION_TRUNCATED']);
    expect(summary).toMatchObject({ outcome: 'FAILED', blockingReasons: ['UNRESOLVED_FAILURE'] });
  });

  it('a list defect never hides a collapse nor a field coverage gone: 40 → 1 offers, 0 % descriptions — blocking, even for a D-480 source', () => {
    const base: IngestStats = { source: 'attaquer', complete: false, enumerationReading: 'NOT_PROVEN', enumerationUnprovable: 'NO_PUBLISHER_LISTING_OR_SITEMAP',
      fetched: 1, inSector: 1, france: 1, created: 0, merged: 0, updated: 1, errors: 0, withDescription: 1, withDate: 1, withCountry: 1, withUrl: 1,
      captureBatchId: 'batch', completionReportHash: 'report' };
    const collapse = evaluateSourceHealth(base, 40);
    expect(collapse.finding).toBeUndefined(); expect(collapse.note).toContain('98 % d’offres en moins');
    expect(classifySourceRun([base], [collapse]).incidents[0]).toMatchObject({ blocking: true });
    const empty = { ...base, fetched: 30, inSector: 30, updated: 30, withDescription: 0, withDate: 30, withCountry: 30, withUrl: 30 };
    const fields = evaluateSourceHealth(empty, 30);
    expect(fields.finding).toBe('DESCRIPTION_COVERAGE_BELOW_FLOOR');
    expect(classifySourceRun([empty], [fields]).incidents[0]).toMatchObject({ blocking: true });
    // Fewer than ten postings gone (D-491) is no collapse: the list defect is what is named.
    expect(evaluateSourceHealth({ ...base, fetched: 3, inSector: 3, updated: 3, withDescription: 3, withDate: 3, withCountry: 3, withUrl: 3 }, 9).finding).toBe('ENUMERATION_UNPROVABLE');
  });

  it('a retention to instruct next to the family limit is named and blocks: the limit never hides another defect', () => {
    const stat: IngestStats = { source: 'witness', complete: false, enumerationReading: 'NOT_PROVEN', enumerationUnprovable: 'NO_PUBLISHER_LISTING_OR_SITEMAP',
      fetched: 5, inSector: 4, france: 4, created: 0, merged: 0, updated: 4, errors: 0, withDescription: 4, withDate: 4, withCountry: 4, withUrl: 4,
      held: 1, heldReasons: { DETAIL_READ_FAILED: 1 }, captureBatchId: 'batch', completionReportHash: 'report' };
    const health = evaluateSourceHealth(stat, 4);
    expect(health.finding).toBe('RETENTION_TO_INSTRUCT');
    const { issues, incidents } = classifySourceRun([stat], [health]);
    expect(issues.map(issue => issue.code)).toEqual(['RETENTION_TO_INSTRUCT']);
    expect(incidents[0]).toMatchObject({ blocking: true }); expect(incidents[0]!.knownFailure).toBeUndefined();
  });
});

describe('RÉFUTÉE — un fait observé contredit la fin du parcours : bloquante, dite « réfutée »', () => {
  it('an Ashby feed that repeats one identifier among twenty-one rows: we cannot say what we read', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: `job-${i}`, title: `Poste ${i}`, isListed: true, jobUrl: `https://jobs.ashbyhq.com/maison/job-${i}` }));
    vi.mocked(fetchJson).mockResolvedValue({ apiVersion: '1', jobs: [...rows, { ...rows[0], title: 'Poste 0 bis' }] });
    const normalized = normalizeAdapterResult(await fetchAshbyJobs({ board: 'maison' }));
    // Premise: no truncation (20 distinct of 21 declared is above the coverage floor) — only the repeated identifier refutes.
    expect(normalized).toMatchObject({ complete: false, enumerationVerdict: 'REFUTED', truncated: false });
    const { stat, health, issues, summary } = runOf(normalized);
    expect(stat).toMatchObject({ enumerationReading: 'REFUTED', enumerationRefutedBy: ['REPEATED_OUTPUT_ID'] });
    expect(health).toMatchObject({ status: 'DEGRADED', finding: 'ENUMERATION_REFUTED' });
    expect(health.note).toContain('énumération réfutée');
    expect(health.note).toContain('REPEATED_OUTPUT_ID');
    expect(issues).toEqual([{ origin: 'UNKNOWN', code: 'ENUMERATION_REFUTED', count: 1 }]);
    expect(summary).toMatchObject({ outcome: 'FAILED', blockingReasons: ['UNRESOLVED_FAILURE'] });
  });

  it('a start-page crawl cut at its 150-link cap is a truncation, observed: blocking', async () => {
    const start = 'https://www.cap.example/careers';
    serve(url => url === start ? Array.from({ length: 151 }, (_, i) => `<a href="/jobs/${i}">${i}</a>`).join('') : posting(url.split('/').pop()!));
    const normalized = normalizeAdapterResult(await fetchGenericJsonLdJobs({ startUrl: start }));
    expect(normalized).toMatchObject({ truncated: true, enumerationVerdict: 'REFUTED', complete: false });
    const { stat, health, summary } = runOf(normalized);
    expect(stat.enumerationReading).toBe('REFUTED');
    expect(stat.enumerationRefutedBy).toContain('TRUNCATED');
    expect(health).toMatchObject({ status: 'DEGRADED', note: expect.stringContaining('troncature') });
    expect(summary.outcome).toBe('FAILED');
  });

  it('a named traversal defect refutes even without a count: the positive list of absence-of-proof markers is closed', () => {
    const jobs = [{ externalId: 'a', title: 'A', url: 'https://x.example/a' }] as NormalizedJob[];
    const base = { jobs, complete: false } satisfies AdapterResult;
    const withIssues = (issues: string[]) => readEnumeration({ ...base, enumeration: { method: 'M', endpoint: 'E', pages: 1, rawCount: 1, termination: 'T', issues } });
    expect(withIssues(['ENUMERATION_NOT_PROVEN'])).toEqual({ enumerationReading: 'NOT_PROVEN' });
    expect(withIssues(['REPEATED_IDS_ACROSS_PAGES', 'ENUMERATION_NOT_PROVEN'])).toEqual({ enumerationReading: 'REFUTED', enumerationRefutedBy: ['REPEATED_IDS_ACROSS_PAGES'] });
    // A per-posting defect (a description missing at the source) never refutes the traversal.
    expect(withIssues(['DESCRIPTION_MISSING:144681', 'ENUMERATION_NOT_PROVEN'])).toEqual({ enumerationReading: 'NOT_PROVEN' });
    // A row we failed to read is a hole in the collection, not a witness of it.
    expect(readEnumeration({ ...base, rejectedRows: [{ reason: 'DETAIL_FETCH_FAILED', raw: null }] }))
      .toEqual({ enumerationReading: 'REFUTED', enumerationRefutedBy: ['REJECTED:DETAIL_FETCH_FAILED'] });
    // A declared total not reached, or a zero contradicted by outputs.
    expect(readEnumeration({ ...base, declaredTotal: 2 }).enumerationReading).toBe('REFUTED');
    expect(readEnumeration({ ...base, declaredTotal: 0 }).enumerationRefutedBy).toEqual(['DECLARED_ZERO_WITH_OUTPUTS']);
  });
});
