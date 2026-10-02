import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient, type Prisma, type Source } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { runQualifiedIngest } from './ingestOrchestrator.js';
import { readAttestingCapture } from './attestingCapture.js';
import * as certification from '../connectors/sourceCertification.js';
import { maintainSourceAccess } from '../connectors/sourceAccessQualification.js';
import { captureSourceForValidation } from '../connectors/sourceValidation.js';
import { requireSourceAccess } from '../connectors/sourceAccess.js';
import { effectiveSourceConfig } from '../connectors/sourceConfig.js';
import { CAPTURE_ADOPTION_POLICY, SOURCE_ADMISSION_POLICY } from '../connectors/sourceAdmission.js';
import { adoptQualificationCapture, CAPTURE_ADOPTION_MAX_AGE_MS, singleReadEnabled } from '../capture/adoption.js';
import { captureExtraction } from '../capture/batch.js';
import { readIngestionCompletion } from '../capture/completion.js';
import { readRawBlob } from '../capture/store.js';
import * as manifest from '../capture/manifest.js';
import * as revision from '../capture/revision.js';
import { fetchAtsJobs } from '../ats/index.js';
import { syntheticFeed, type SyntheticPosting } from '../test/ingestionFixture.js';

/*
 * LECTURE UNIQUE DU RUN (lecture D-492 de D-516 §1, 02/10/2026) — base réelle, lecteur réel, publication réelle.
 *
 * Le 01/10/2026, le RUN a requalifié 411 sources sur 411 et lu presque chacune deux fois : 56 874 requêtes de
 * qualification, puis 54 893 d'ingestion. Ici, seul le réseau de l'éditeur est simulé (un flux Ashby) ; la
 * qualification, la décision d'accès, l'adoption, son garde SQL, l'admission, la publication et le rapport de fin
 * d'ingestion sont le chemin de production. Chaque témoin compte les lectures du flux : sur le code d'avant, la source
 * qualifiée dans le tour est lue DEUX fois.
 */
const db = new PrismaClient();
const keys: string[] = [];
const create = async () => {
  const key = `lecture-unique-${randomUUID()}`; keys.push(key);
  return db.source.create({ data: { key, maison: key, kind: 'ashby', config: { board: key }, portalScope: 'SINGLE_BRAND',
    tier: 'EMPLOYER_DIRECT', tenantKey: key, status: 'ACTIVE' } });
};
const registry = (key: string) => db.source.findUniqueOrThrow({ where: { key } });
const adoptionSource = (source: Source) => ({ key: source.key, revisionId: source.currentRevisionId,
  config: effectiveSourceConfig(source.config as Record<string, unknown>) });

/** Le réseau de l'éditeur : le flux (compté) et robots.txt (compté à part). */
function network(feed: () => string, moved = false) {
  const calls = { feed: 0, robots: 0 };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === '/robots.txt') { calls.robots++; return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } }); }
    if (moved && !url.pathname.endsWith('/v2')) return new Response(null, { status: 301, headers: { location: `${url.pathname}/v2${url.search}` } });
    calls.feed++;
    return new Response(feed(), { headers: { 'content-type': 'application/json' } });
  }));
  return calls;
}
const POSTINGS: SyntheticPosting[] = [
  { id: 'vendeur-paris', title: 'Conseiller de vente', description: 'Accueil et conseil en boutique, Paris' },
  { id: 'chef-produit', title: 'Chef de produit maroquinerie', description: 'Développement des collections' },
  // D-511 et D-512 : retenues natives, qui doivent sortir identiques d'une lecture neuve et du rejeu adopté.
  { id: 'initiativ', title: 'Initiativbewerbung', description: 'Bewerben Sie sich initiativ' },
  { id: 'vivier', title: 'Talent Pool', description: 'Join our talent community' },
];
/** La qualification du jour est périmée (24 h) : le tour la refait, comme chaque jour du RUN mesuré le 01/10. */
const staleOnce = () => vi.spyOn(certification, 'requireSourceValidation').mockRejectedValueOnce(
  new certification.SourceValidationGateError('CAPTURE_STALE', 'native capture must have been observed within 24 hours'));
const latestJobs = (key: string) => db.captureBatch.findFirstOrThrow({ where: { sourceKey: key, purpose: 'JOBS' }, orderBy: { attemptOrdinal: 'desc' },
  include: { ingestionAdmission: true, ingestionCompletion: true, captureAdoption: true, outcome: true } });
const outputHashes = async (batchId: string) => (await db.sourceExtraction.findMany({ where: { batchId }, orderBy: { ordinal: 'asc' } }))
  .map(row => [row.externalId, row.outputHash]);
/**
 * Les sorties scellées d'une collecte, où l'instant de SA collecte (le début du lot, qui date un retrait D-511/D-512)
 * est remplacé par un repère : deux lectures du même contenu ne diffèrent que par cet instant, et rien d'autre.
 */
const outputsModuloInstant = async (batchId: string) => {
  const { startedAt } = await db.captureBatch.findUniqueOrThrow({ where: { id: batchId } });
  const rows = await db.sourceExtraction.findMany({ where: { batchId }, orderBy: { ordinal: 'asc' } });
  const instants: string[] = [];
  const outputs = await Promise.all(rows.map(async row => JSON.parse((await readRawBlob(db, row.outputHash)).toString('utf8'),
    (_key, value) => value === startedAt.toISOString() ? (instants.push(value), '<début de la collecte>') : value)));
  return { outputs, instants: instants.length };
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.INGEST_SINGLE_READ; });
afterAll(async () => {
  await db.$executeRaw`TRUNCATE "SourceIngestionAdmission", "SourceIdentityReview"`;
  await db.$disconnect();
});

describe('lecture unique : la source qualifiée dans le tour n’est lue qu’une fois', () => {
  it('une seule lecture du flux, publiée depuis la capture de qualification adoptée (le code d’avant en faisait deux)', async () => {
    const source = await create();
    const calls = network(() => syntheticFeed(POSTINGS));
    const [stats] = await runQualifiedIngest(db, source.key, true, 60_000);
    // Prémisse : le tour a bien dû qualifier la source (aucune décision, aucune validation avant lui).
    const batches = await db.captureBatch.findMany({ where: { sourceKey: source.key, purpose: 'JOBS' }, include: { validations: true } });
    expect(batches).toHaveLength(1);
    expect(batches[0].accessDecisionId).toBeNull();
    expect(batches[0].validations.map(v => v.verdict)).toEqual(['VALIDATED']);
    expect(calls).toEqual({ feed: 1, robots: 1 });
    const batch = await latestJobs(source.key);
    const { decision } = await requireSourceAccess(db, source);
    expect(batch.ingestionAdmission).toMatchObject({ policyVersion: CAPTURE_ADOPTION_POLICY, sourceValidationId: batches[0].validations[0].id });
    expect(batch.captureAdoption).toMatchObject({ accessDecisionId: decision.id, sourceValidationId: batches[0].validations[0].id });
    expect(batch.ingestionCompletion).toMatchObject({ published: 2, held: 2, writeFailed: 0, skipped: 0 });
    expect(stats).toMatchObject({ fetched: 4, created: 2, held: 2, errors: 0 });
    expect(await db.jobSource.count({ where: { sourceKey: source.key } })).toBe(2);
  });

  it('une validation encore fraîche : aucune qualification, une lecture sous décision, admission inchangée', async () => {
    const source = await create();
    network(() => syntheticFeed(POSTINGS));
    await runQualifiedIngest(db, source.key, true, 60_000);
    const calls = network(() => syntheticFeed(POSTINGS));
    await runQualifiedIngest(db, source.key, true, 60_000);
    expect(calls).toEqual({ feed: 1, robots: 0 });
    const batch = await latestJobs(source.key);
    expect(batch.accessDecisionId).not.toBeNull();
    expect(batch.ingestionAdmission?.policyVersion).toBe(SOURCE_ADMISSION_POLICY);
    expect(batch.captureAdoption).toBeNull();
  });

  it('le rejeu adopté publie exactement ce qu’une lecture neuve du même contenu publie : sorties, retenues, attestation', async () => {
    const source = await create();
    network(() => syntheticFeed(POSTINGS));
    await runQualifiedIngest(db, source.key, true, 60_000); // premier tour : sans passé (NEW)
    // Tour B, l'ancien comportement (interrupteur) : qualification refaite PUIS seconde lecture sous décision.
    process.env.INGEST_SINGLE_READ = 'off';
    const live = network(() => syntheticFeed(POSTINGS)); staleOnce();
    await runQualifiedIngest(db, source.key, true, 60_000);
    expect(live.feed).toBe(2);
    const b = await latestJobs(source.key);
    expect(b.ingestionAdmission?.policyVersion).toBe(SOURCE_ADMISSION_POLICY);
    const attestedB = await readAttestingCapture(db, source.key, new Date());
    // Tour C, la lecture unique : la même qualification refaite, adoptée, publiée sans seconde lecture.
    delete process.env.INGEST_SINGLE_READ;
    const single = network(() => syntheticFeed(POSTINGS)); staleOnce();
    await runQualifiedIngest(db, source.key, true, 60_000);
    expect(single.feed).toBe(1);
    const c = await latestJobs(source.key);
    expect(c.ingestionAdmission?.policyVersion).toBe(CAPTURE_ADOPTION_POLICY);
    const attestedC = await readAttestingCapture(db, source.key, new Date());
    // Mêmes sorties scellées, mêmes devenirs (D-511, D-512 retenues comprises), même droit d'attester l'absence.
    // Les sorties publiables sont identiques à l'octet près ; les retenues datent leur retrait du début de LEUR collecte.
    const [hashesB, hashesC] = await Promise.all([outputHashes(b.id), outputHashes(c.id)]);
    expect(hashesC.slice(0, 2)).toEqual(hashesB.slice(0, 2));
    const [modB, modC] = await Promise.all([outputsModuloInstant(b.id), outputsModuloInstant(c.id)]);
    expect(modC.outputs).toEqual(modB.outputs);
    // Prémisse : la seule différence est bien cet instant (deux retenues datées), pas un champ ignoré par le témoin.
    expect(modB.instants).toBe(2); expect(modC.instants).toBe(2);
    expect(hashesC.slice(2)).not.toEqual(hashesB.slice(2));
    const [reportB, reportC] = await Promise.all([readIngestionCompletion(db, b.id), readIngestionCompletion(db, c.id)]);
    expect(reportC!.report.fates).toEqual(reportB!.report.fates);
    expect(reportC!.report.fates.map(fate => fate.reason).sort()).toEqual(['NATIVE_SPONTANEOUS_APPLICATION', 'NATIVE_SPONTANEOUS_APPLICATION']);
    expect(attestedB.ok && attestedC.ok).toBe(true);
    if (!attestedB.ok || !attestedC.ok) return;
    const facts = (f: typeof attestedB.capture.facts) => ({ ...f, captureBatchId: undefined, startedAt: undefined });
    expect(facts(attestedC.capture.facts)).toEqual(facts(attestedB.capture.facts));
    expect(attestedC.capture.facts.canAttestAbsence).toBe(true);
    expect([...attestedC.capture.evidence.canonicalSet].sort()).toEqual([...attestedB.capture.evidence.canonicalSet].sort());
    expect(attestedC.capture.dispositions).toEqual(attestedB.capture.dispositions);
  });
});

describe('chaque refus de rejeu relit le site', () => {
  /** Une source qualifiée par le chemin de production ; rend la capture de qualification du tour (sans décision). */
  const qualified = async () => {
    const source = await create(); network(() => syntheticFeed(POSTINGS));
    const access = await maintainSourceAccess(db, source.key, 60_000);
    expect(access.qualificationCaptureId).toBeTruthy();
    return { source, captureId: access.qualificationCaptureId! };
  };
  const admitted = (batchId: string) => db.sourceIngestionAdmission.findUnique({ where: { batchId } });
  /** Prémisse commune : sans la perturbation, cette capture serait adoptable (contrôle positif de chaque refus). */
  const refusedThenAdoptable = async (perturb: (ctx: { source: Source; captureId: string }) => Promise<Parameters<typeof adoptQualificationCapture>[4] | void>,
    code: string) => {
    const ctx = await qualified();
    const options = await perturb(ctx);
    const outcome = await adoptQualificationCapture(db, adoptionSource(await registry(ctx.source.key)), 'ASHBY', ctx.captureId, options ?? {});
    expect(outcome).toMatchObject({ refused: code });
    expect(await admitted(ctx.captureId)).toBeNull();
    return ctx;
  };

  it('contrôle positif : la capture du tour, intacte, est adoptée', async () => {
    const { source, captureId } = await qualified();
    expect(await adoptQualificationCapture(db, adoptionSource(source), 'ASHBY', captureId)).toHaveProperty('adopted');
    expect(await admitted(captureId)).toMatchObject({ policyVersion: CAPTURE_ADOPTION_POLICY });
  });

  it('DISABLED : l’interrupteur d’exploitation rétablit la double lecture, de bout en bout', async () => {
    expect(singleReadEnabled(undefined)).toBe(true);
    expect(['off', '0', 'false', 'OFF '].map(singleReadEnabled)).toEqual([false, false, false, false]);
    process.env.INGEST_SINGLE_READ = 'off';
    const source = await create(); const calls = network(() => syntheticFeed(POSTINGS));
    await runQualifiedIngest(db, source.key, true, 60_000);
    expect(calls.feed).toBe(2);
    expect((await latestJobs(source.key)).ingestionAdmission?.policyVersion).toBe(SOURCE_ADMISSION_POLICY);
  });

  it('OTHER_RUN : une capture d’un autre run (une passe légère, R-143 §1) n’est jamais adoptée', async () => {
    await refusedThenAdoptable(async () => ({ runId: `autre-run-${randomUUID()}` }), 'OTHER_RUN');
  });

  it('STALE : une capture de plus de 60 minutes se relit', async () => {
    await refusedThenAdoptable(async () => ({ now: () => new Date(Date.now() + CAPTURE_ADOPTION_MAX_AGE_MS + 60_000) }), 'STALE');
  });

  it('OTHER_REVISION : la configuration de la source a changé depuis la capture', async () => {
    await refusedThenAdoptable(async ({ source }) => {
      await db.source.update({ where: { key: source.key }, data: { config: { board: source.key, country: 'FR' } } });
    }, 'OTHER_REVISION');
  });

  it('READER_CHANGED : la capture a été lue par une autre révision du lecteur', async () => {
    await refusedThenAdoptable(async () => { vi.spyOn(revision, 'captureReaderRevision').mockReturnValue('git:' + '2'.repeat(40)); }, 'READER_CHANGED');
  });

  it('NOT_VALIDATED : une validation plus récente refuse cette capture (capture invalidée)', async () => {
    await refusedThenAdoptable(async ({ source, captureId }) => {
      const current = await db.sourceValidation.findFirstOrThrow({ where: { captureBatchId: captureId } });
      await db.sourceValidation.create({ data: { sourceRevisionId: source.currentRevisionId, captureBatchId: captureId,
        readerRevision: current.readerRevision, policyVersion: current.policyVersion, verdict: 'REJECTED',
        report: { ...(current.report as Prisma.JsonObject), reasons: { REPLAY_RESULT_CHANGED: 1 } } } });
    }, 'NOT_VALIDATED');
  });

  it('TRUNCATED : une énumération incomplète ou coupée se relit, et le garde SQL la refuse aussi', async () => {
    const { source, captureId } = await refusedThenAdoptable(async ({ source, captureId }) => {
      const current = await db.sourceValidation.findFirstOrThrow({ where: { captureBatchId: captureId } });
      await db.sourceValidation.create({ data: { sourceRevisionId: source.currentRevisionId, captureBatchId: captureId,
        readerRevision: current.readerRevision, policyVersion: current.policyVersion, verdict: 'VALIDATED',
        report: { ...(current.report as Prisma.JsonObject), enumerationClaim: 'INCOMPLETE', reasons: { ENUMERATION_INCOMPLETE: 1 } } } });
    }, 'TRUNCATED');
    await expect(insertAdoption(source, captureId)).rejects.toThrow(/latest validation of this complete capture/);
  });

  it('NOT_LATEST_ATTEMPT : une tentative plus récente existe', async () => {
    await refusedThenAdoptable(async ({ source }) => {
      await captureExtraction(db, source.key, effectiveSourceConfig(source.config as Record<string, unknown>), undefined,
        settings => fetchAtsJobs('ASHBY', settings), 'ASHBY', { revisionId: source.currentRevisionId, requireActive: true });
    }, 'NOT_LATEST_ATTEMPT');
  });

  it('GOVERNED_CAPTURE : une collecte déjà gouvernée par une décision garde son admission normale', async () => {
    const { source } = await qualified();
    const live = await captureExtraction(db, source.key, effectiveSourceConfig(source.config as Record<string, unknown>), undefined,
      settings => fetchAtsJobs('ASHBY', settings), 'ASHBY', { revisionId: source.currentRevisionId, requireActive: true });
    expect(await adoptQualificationCapture(db, adoptionSource(source), 'ASHBY', live.captureBatchId)).toMatchObject({ refused: 'GOVERNED_CAPTURE' });
  });

  it('ACCESS_NOT_COVERING : une capture qui sort du périmètre de la décision courante se relit sous décision', async () => {
    const { source } = await qualified();
    network(() => syntheticFeed(POSTINGS), true); // l'éditeur a déplacé son flux : la décision ne couvre pas /v2
    const moved = await captureSourceForValidation(db, source.key, 60_000);
    expect(moved.verdict).toBe('VALIDATED');
    const outcome = await adoptQualificationCapture(db, adoptionSource(source), 'ASHBY', moved.captureBatchId);
    expect(outcome).toMatchObject({ refused: 'ACCESS_NOT_COVERING' });
    expect((outcome as { detail: string }).detail).toMatch(/hors périmètre/);
  });

  it('REPLAY_DIVERGED : un rejeu qui ne rend pas le manifeste scellé ne publie rien', async () => {
    await refusedThenAdoptable(async () => {
      vi.spyOn(manifest, 'compareExtractionResult').mockResolvedValueOnce({ matchesRecordedOutput: false, matchesRecordedMetadata: true, exact: false });
    }, 'REPLAY_DIVERGED');
  });

  it('le rejeu adopté n’utilise jamais le réseau', async () => {
    const { source, captureId } = await qualified();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Adoption tried to use the network'); }));
    expect(await adoptQualificationCapture(db, adoptionSource(source), 'ASHBY', captureId)).toHaveProperty('adopted');
  });
});

/** Insère directement, sans le collecteur, une adoption et son admission : seul le garde SQL décide. */
async function insertAdoption(source: Source, batchId: string, options: { validationId?: string; admission?: boolean } = {}) {
  const validation = await db.sourceValidation.findFirstOrThrow({ where: { sourceRevisionId: source.currentRevisionId }, orderBy: { sequence: 'desc' } });
  const { decision } = await requireSourceAccess(db, source);
  return db.$transaction(async tx => {
    await tx.sourceCaptureAdoption.create({ data: { batchId, sourceValidationId: options.validationId ?? validation.id,
      accessDecisionId: decision.id, policyVersion: CAPTURE_ADOPTION_POLICY } });
    if (options.admission !== false) await tx.sourceIngestionAdmission.create({ data: { batchId, identityReviewId: null,
      sourceValidationId: options.validationId ?? validation.id, policyVersion: CAPTURE_ADOPTION_POLICY } });
  });
}

describe('le garde SQL de l’adoption (migration 20261002190000), sans le collecteur', () => {
  const qualify = async () => {
    const source = await create(); network(() => syntheticFeed(POSTINGS));
    const access = await maintainSourceAccess(db, source.key, 60_000);
    return { source, captureId: access.qualificationCaptureId! };
  };

  it('contrôle positif : la capture fraîche, dernière, validée, sous la décision courante est acceptée', async () => {
    const { source, captureId } = await qualify();
    await expect(insertAdoption(source, captureId)).resolves.toBeUndefined();
  });

  it('refuse une collecte gouvernée, une tentative dépassée, la validation d’une autre capture', async () => {
    const { source, captureId } = await qualify();
    const live = await captureExtraction(db, source.key, effectiveSourceConfig(source.config as Record<string, unknown>), undefined,
      settings => fetchAtsJobs('ASHBY', settings), 'ASHBY', { revisionId: source.currentRevisionId, requireActive: true });
    await expect(insertAdoption(source, live.captureBatchId)).rejects.toThrow(/latest fresh sealed qualification capture/);
    await expect(insertAdoption(source, captureId)).rejects.toThrow(/latest fresh sealed qualification capture/);
    // La validation d'une autre capture (celle de la première source) ne peut pas porter l'adoption de celle-ci.
    const other = await qualify();
    const foreign = await db.sourceValidation.findFirstOrThrow({ where: { captureBatchId: captureId } });
    await expect(insertAdoption(other.source, other.captureId, { validationId: foreign.id })).rejects.toThrow(/latest validation of this complete capture/);
    await expect(insertAdoption(other.source, other.captureId)).resolves.toBeUndefined();
  });

  it('refuse l’admission « adoption » sans adoption dans la même transaction, et une seconde admission', async () => {
    const { source, captureId } = await qualify();
    const validation = await db.sourceValidation.findFirstOrThrow({ where: { captureBatchId: captureId } });
    await expect(db.sourceIngestionAdmission.create({ data: { batchId: captureId, identityReviewId: null, sourceValidationId: validation.id,
      policyVersion: CAPTURE_ADOPTION_POLICY } })).rejects.toThrow(/adoption in this transaction/);
    await insertAdoption(source, captureId, { admission: false });
    await expect(db.sourceIngestionAdmission.create({ data: { batchId: captureId, identityReviewId: null, sourceValidationId: validation.id,
      policyVersion: CAPTURE_ADOPTION_POLICY } })).rejects.toThrow(/adoption in this transaction/);
    // L'ancienne politique ne s'applique jamais après coup à une capture déjà reçue.
    await expect(db.sourceIngestionAdmission.create({ data: { batchId: captureId, identityReviewId: null, sourceValidationId: validation.id,
      policyVersion: SOURCE_ADMISSION_POLICY } })).rejects.toThrow(/newly allocated/);
  });

  it('l’adoption est immuable', async () => {
    const { source, captureId } = await qualify();
    await insertAdoption(source, captureId);
    await expect(db.sourceCaptureAdoption.delete({ where: { batchId: captureId } })).rejects.toThrow();
  });
});
