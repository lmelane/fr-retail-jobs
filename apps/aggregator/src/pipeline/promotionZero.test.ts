import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient, type Source } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { captureExtraction } from '../capture/batch.js';
import { fetchAtsJobs } from '../ats/index.js';
import { effectiveSourceConfig } from '../connectors/sourceConfig.js';
import { promoteSource, SourcePromotionGateError } from '../connectors/sourceStore.js';
import { admissionFixture } from '../test/sourceAdmissionFixture.js';
import { ingestSyntheticFeed, qualifiedSource, releaseQualifiedSources, resolvedCompany } from '../test/ingestionFixture.js';
import { computeSourceState } from './sourceState.js';
import { checkSourceHealth } from './health.js';

/**
 * D-523 et l'arbitrage du CTO sur la lecture technique (03/10/2026) : depuis D-523, une lecture vide sans protocole de zéro
 * natif est VALIDÉE, pour qu'une source ACTIVE vide reste qualifiée et lue. Une source qui n'a jamais montré qu'on sait la
 * lire n'est pas encore « valide » : sa PROMOTION exige une offre réellement lue ou un zéro natif prouvé. Le premier témoin
 * échoue sans la garde `READER_UNPROVEN` : la source passait ACTIVE sur une réponse vide bien formée.
 */
const db = new PrismaClient();
const keys: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => { await releaseQualifiedSources(db); await db.source.deleteMany({ where: { key: { in: keys } } }); await db.$disconnect(); });

/** A DRAFT Greenhouse source qualified (capture, identity, validation, access) on `body`, never promoted. */
async function draftQualifiedOn(prefix: string, body: object): Promise<Source> {
  const key = `${prefix}-${randomUUID().slice(0, 8)}`; keys.push(key);
  const board = key.replace(/[^a-z0-9]/g, '');
  const source = await db.source.create({ data: { key, maison: key, tenantKey: `greenhouse:${board}`, kind: 'greenhouse', config: { board }, tier: 'ATS_OFFICIAL' } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))));
  const probe = await captureExtraction(db, key, effectiveSourceConfig(source.config as Record<string, unknown>), undefined,
    settings => fetchAtsJobs('GREENHOUSE', settings), 'GREENHOUSE');
  const { validation } = await admissionFixture(db, source, probe.captureBatchId);
  expect(validation.verdict).toBe('VALIDATED');
  return source;
}

describe('D-523 — promouvoir exige une preuve qu’on sait lire la source', () => {
  it('nouvelle source, réponse vide bien formée sans zéro natif : validée, mais jamais promue (lecteur à vérifier)', async () => {
    const source = await draftQualifiedOn('vide-non-prouve', { jobs: [] });
    // Prémisse : la seule qualification est une lecture vide NON prouvée (mauvais board, mauvais chemin : indiscernables).
    const validations = await db.sourceValidation.findMany({ where: { sourceRevisionId: source.currentRevisionId! } });
    expect(validations.map(v => v.report)).toEqual([expect.objectContaining({ observed: 0, nativeEmpty: false })]);
    const refused = await promoteSource(db, source.key, source.currentRevisionId!).catch(error => error);
    expect(refused).toBeInstanceOf(SourcePromotionGateError);
    expect(refused).toMatchObject({ code: 'READER_UNPROVEN' });
    expect((await db.source.findUniqueOrThrow({ where: { key: source.key } })).status).toBe('DRAFT');
  });

  it('nouvelle source au zéro natif prouvé : promue ACTIVE', async () => {
    const source = await draftQualifiedOn('vide-prouve', { jobs: [], meta: { total: 0 } });
    expect((await db.sourceValidation.findFirstOrThrow({ where: { sourceRevisionId: source.currentRevisionId! } })).report)
      .toMatchObject({ observed: 0, nativeEmpty: true });
    expect(await promoteSource(db, source.key, source.currentRevisionId!)).toMatchObject({ from: 'DRAFT', to: 'ACTIVE' });
  });

  it('source ACTIVE qui retombe à zéro prouvé : reste ACTIVE et NORMALE', async () => {
    const key = `active-vide-${randomUUID().slice(0, 8)}`; keys.push(key);
    await qualifiedSource(db, key);
    await checkSourceHealth(db, [await ingestSyntheticFeed(db, key, [{ id: 'a' }, { id: 'b' }])]);
    const proven = await ingestSyntheticFeed(db, key, []);
    expect(proven).toMatchObject({ fetched: 0, declaredTotal: 0, complete: true });
    await checkSourceHealth(db, [proven]);
    const provenRun = await db.sourceRun.findFirstOrThrow({ where: { sourceKey: key }, orderBy: { ranAt: 'desc' } });
    expect(provenRun).toMatchObject({ status: 'OK', jobs: 0 });
    const intent = { key, status: (await db.source.findUniqueOrThrow({ where: { key } })).status, note: null };
    expect(intent.status).toBe('ACTIVE');
    expect(computeSourceState({ source: intent, now: new Date(), previous: null,
      outcome: { kind: 'RUN', at: new Date(), runId: null, runStatus: 'OK', jobs: 0, issues: [] } })).toMatchObject({ state: 'NORMALE' });
    // L'intention ne bouge pas, et une nouvelle promotion d'une source déjà ACTIVE ne lui demande aucune preuve de plus.
    const source = await db.source.findUniqueOrThrow({ where: { key } });
    expect(await promoteSource(db, key, source.currentRevisionId!)).toMatchObject({ from: 'ACTIVE', to: 'ACTIVE' });
    expect((await db.source.findUniqueOrThrow({ where: { key } })).status).toBe('ACTIVE');
  });

  it('jour 11 : la purge de SourceRun ne change pas un zéro non prouvé en zéro prouvé tant que les offres sont en catalogue', async () => {
    const key = `jour-onze-${randomUUID().slice(0, 8)}`; keys.push(key);
    await qualifiedSource(db, key);
    await db.source.update({ where: { key }, data: { portalScope: 'SINGLE_BRAND' } });
    await resolvedCompany(db, key);
    await checkSourceHealth(db, [await ingestSyntheticFeed(db, key, [{ id: 'a' }, { id: 'b' }, { id: 'c' }])]);
    // La purge des 10 jours a effacé tout l'historique de la source ; ses offres sont toujours en catalogue.
    await db.sourceRun.deleteMany({ where: { sourceKey: key } });
    expect(await db.sourceRun.count({ where: { sourceKey: key } })).toBe(0);
    expect(await db.jobSource.count({ where: { sourceKey: key, isActive: true } })).toBe(3);
    const emptyListing = { source: key, complete: true, fetched: 0, inSector: 0, france: 0, created: 0, merged: 0, updated: 0, errors: 0,
      withDescription: 0, withDate: 0, withCountry: 0, withUrl: 0 };
    expect((await checkSourceHealth(db, [emptyListing])).incidents[0]).toMatchObject({ status: 'BROKEN', finding: 'ZERO_NOT_PROVEN' });
  });
});

