import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { checkSourceHealth } from './health.js';
import type { IngestStats } from './ingest.js';

/**
 * Integration tests for source health (against the local audit DB).
 *
 * The detector must compare a run to the PREVIOUS run recorded in SourceRun —
 * never to the live JobSource state it just wrote, which would compare a run to
 * itself and never flag a source that broke.
 */

const prisma = new PrismaClient();

function stat(source: string, created: number): IngestStats {
  return { source, complete: true, fetched: created, inSector: created, france: created, created, merged: 0, updated: 0, errors: 0, withDescription: created, withDate: created, withCountry: created, withUrl: created };
}

async function wipe() {
  await prisma.sourceRun.deleteMany({});
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('checkSourceHealth', () => {
  it('persists the original failed-page cause and denies absence attestation', async () => {
    const failed = { ...stat('l-oreal-professionnel', 0), errors: 1, complete: false,
      errorNote: 'HTTP 406 for https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=240' };
    const report = await checkSourceHealth(prisma, [failed]);
    const run = await prisma.sourceRun.findFirstOrThrow({ where: { sourceKey: failed.source } });
    expect(report.broken).toBe(1);
    expect(run.note).toContain(failed.errorNote);
    expect(run.errors).toBe(1);
    expect(run.canAttestAbsence).toBe(false);
  });

  /**
   * Révisé deux fois le 2026-09-11.
   *
   * D'abord : une énumération INCONNUE n'est plus traitée comme une incomplétude PROUVÉE — 149 sources sur 440
   * ne déclarent aucun total (teamtailor 113, recruitee 22, personio 14) et étaient marquées DEGRADED alors
   * qu'elles lisaient parfaitement leur board.
   *
   * Ensuite, sur arbitrage du propriétaire : une énumération inconnue **ne ferme rien**, même avec un volume de
   * référence stable. Un volume stable ne prouve pas que le même périmètre a été parcouru. Elle reste suivie et
   * mesurée, sans droit de fermeture.
   */
  it('never grants attestation to an unmeasured enumeration, reference volume or not', async () => {
    // Premier run : aucune référence. Aucun droit d'attester, et aucun incident non plus.
    const first = await checkSourceHealth(prisma, [{ ...stat('legacy-adapter', 100), complete: undefined }]);
    expect(first.degraded).toBe(0);
    const firstRun = await prisma.sourceRun.findFirstOrThrow({ where: { sourceKey: 'legacy-adapter' }, orderBy: { ranAt: 'desc' } });
    expect(firstRun.complete).toBeNull();
    expect(firstRun.canAttestAbsence).toBe(false);

    // Second run, volume parfaitement stable : toujours aucun droit de fermer. Le volume n'est pas une preuve.
    const second = await checkSourceHealth(prisma, [{ ...stat('legacy-adapter', 100), complete: undefined }]);
    expect(second.degraded).toBe(0);
    const secondRun = await prisma.sourceRun.findFirstOrThrow({ where: { sourceKey: 'legacy-adapter' }, orderBy: { ranAt: 'desc' } });
    expect(secondRun.complete).toBeNull();
    expect(secondRun.canAttestAbsence).toBe(false);
  });

  it('grants attestation when the adapter demonstrates the end of its traversal', async () => {
    // Un PREMIER run n'atteste jamais (`result.previous === null`) : il n'a aucun passé. Il en faut donc deux,
    // et c'est bien la démonstration de parcours — non le volume — qui ouvre le droit au second.
    await checkSourceHealth(prisma, [stat('proven-adapter', 100)]);
    await checkSourceHealth(prisma, [stat('proven-adapter', 100)]);
    const run = await prisma.sourceRun.findFirstOrThrow({ where: { sourceKey: 'proven-adapter' }, orderBy: { ranAt: 'desc' } });
    expect(run.complete).toBe(true);
    expect(run.canAttestAbsence).toBe(true);
  });

  it('still refuses attestation when an unmeasured enumeration collapses against its reference', async () => {
    await checkSourceHealth(prisma, [{ ...stat('legacy-collapse', 100), complete: undefined }]);
    await checkSourceHealth(prisma, [{ ...stat('legacy-collapse', 100), complete: undefined }]);
    // Chute de 90 % : la seule preuve disponible dit que le balayage n'a pas vu le board.
    await checkSourceHealth(prisma, [{ ...stat('legacy-collapse', 10), complete: undefined }]);
    const run = await prisma.sourceRun.findFirstOrThrow({ where: { sourceKey: 'legacy-collapse' }, orderBy: { ranAt: 'desc' } });
    expect(run.canAttestAbsence).toBe(false);
  });
  it('measures accepted postings, and records coverage even on the first run', async () => {
    const report = await checkSourceHealth(prisma, [{ ...stat('filtered-board', 30), fetched: 1000 }]);
    expect(report.incidents).toHaveLength(0);
    const run = await prisma.sourceRun.findFirstOrThrow({ where: { sourceKey: 'filtered-board' } });
    expect(run.descriptionRate).toBe(1);
    expect(run.accepted).toBe(30);
    expect(run.fetched).toBe(1000);
    expect(run.canAttestAbsence).toBe(false);
  });

  it('does not hide truncation with an unknown total on a first run', async () => {
    const report = await checkSourceHealth(prisma, [{ ...stat('partial', 30), truncated: true }]);
    expect(report.degraded).toBe(1);
    expect(report.incidents[0].note).toContain('total inconnu');
    expect((await prisma.sourceRun.findFirstOrThrow({ where: { sourceKey: 'partial' } })).canAttestAbsence).toBe(false);
  });

  it('does not grant attestation after a partial write failure despite stable volume', async () => {
    await checkSourceHealth(prisma, [stat('partial-write', 100)]);
    const report = await checkSourceHealth(prisma, [{ ...stat('partial-write', 99), errors: 1 }]);
    expect(report.degraded).toBe(1);
    const run = await prisma.sourceRun.findFirstOrThrow({ where: { sourceKey: 'partial-write' }, orderBy: { ranAt: 'desc' } });
    expect(run.errors).toBe(1);
    expect(run.canAttestAbsence).toBe(false);
  });

  it('allows complete runs with weak descriptions to attest, using structured evidence', async () => {
    await checkSourceHealth(prisma, [stat('weak-descriptions', 100)]);
    await checkSourceHealth(prisma, [{ ...stat('weak-descriptions', 100), withDescription: 10 }]);
    const run = await prisma.sourceRun.findFirstOrThrow({ where: { sourceKey: 'weak-descriptions' }, orderBy: { ranAt: 'desc' } });
    expect(run.status).toBe('DEGRADED');
    expect(run.canAttestAbsence).toBe(true);
  });
  it('marks a source NEW on its first run (no history)', async () => {
    const report = await checkSourceHealth(prisma, [stat('kering', 100)]);
    expect(report.incidents).toHaveLength(0);
    const run = report as unknown as { ok: number };
    expect(run.ok).toBe(0); // NEW is neither ok, degraded nor broken
    // The run was recorded for next time.
    expect(await prisma.sourceRun.count({ where: { sourceKey: 'kering' } })).toBe(1);
  });

  it('marks a source BROKEN when it produced before and now returns zero', async () => {
    // First run: 100 offers -> recorded.
    await checkSourceHealth(prisma, [stat('kering', 100)]);
    // Second run: 0 offers -> BROKEN vs the previous 100.
    const report = await checkSourceHealth(prisma, [stat('kering', 0)]);
    expect(report.broken).toBe(1);
    expect(report.incidents[0]?.source).toBe('kering');
    expect(report.incidents[0]?.status).toBe('BROKEN');
    expect(report.incidents[0]?.previous).toBe(100);
  });

  it('marks a source DEGRADED when it drops below half', async () => {
    await checkSourceHealth(prisma, [stat('loreal', 200)]);
    const report = await checkSourceHealth(prisma, [stat('loreal', 50)]);
    expect(report.degraded).toBe(1);
    expect(report.incidents[0]?.status).toBe('DEGRADED');
  });

  it('is OK when a source holds steady', async () => {
    await checkSourceHealth(prisma, [stat('courir', 300)]);
    const report = await checkSourceHealth(prisma, [stat('courir', 290)]);
    expect(report.broken).toBe(0);
    expect(report.degraded).toBe(0);
    expect(report.ok).toBe(1);
  });

  it('does not compare a run to itself: two runs of the same source do not inflate the baseline', async () => {
    // If previous were read from live state, a source that ran twice at 100 then
    // returned 0 would still see "before=100" only by luck; the point is the
    // baseline is the LAST RECORDED RUN, so a 0 after a 100 is always BROKEN.
    await checkSourceHealth(prisma, [stat('kering', 100)]);
    await checkSourceHealth(prisma, [stat('kering', 100)]);
    const report = await checkSourceHealth(prisma, [stat('kering', 0)]);
    expect(report.broken).toBe(1);
  });
});

describe('truncation gate (F-04)', () => {
  it('a source announcing more than it delivered is DEGRADED, not OK', async () => {
    // Previous run: healthy volume.
    await checkSourceHealth(prisma, [stat('printemps', 110)]);
    // This run: same-ish volume, but the source DECLARED 112 and we got 20 —
    // the Talentsoft failure mode (RSS cap) that used to look perfectly green.
    const truncatedStat: IngestStats = { ...stat('printemps', 90), truncated: true, declaredTotal: 112 };
    const report = await checkSourceHealth(prisma, [truncatedStat]);
    expect(report.degraded).toBe(1);
    expect(report.incidents[0]?.note).toContain('troncature');
    expect(report.incidents[0]?.note).toContain('112');
  });

  it('rates ride to SourceRun columns on every run (L-02)', async () => {
    await checkSourceHealth(prisma, [stat('hermes', 50)]);
    await checkSourceHealth(prisma, [stat('hermes', 50)]);
    const run = await prisma.sourceRun.findFirstOrThrow({
      where: { sourceKey: 'hermes' },
      orderBy: { ranAt: 'desc' },
    });
    expect(run.descriptionRate).toBe(1);
    expect(run.urlRate).toBe(1);
  });
});

/**
 * Audit A2 (2026-09-06) : après un BROKEN, un second run à 0 se comparait à
 * 0 et passait OK — 66 runs « OK à 0 » sur 17 sources ; le refresh fermait
 * leurs offres et le digest ne prévenait qu'une fois.
 */
describe('checkSourceHealth — zéro après zéro', () => {
  it('BROKEN puis 0 → toujours BROKEN, référence = dernier run productif', async () => {
    await checkSourceHealth(prisma, [stat('nordstrom', 1294)]);
    await checkSourceHealth(prisma, [stat('nordstrom', 0)]);
    const report = await checkSourceHealth(prisma, [stat('nordstrom', 0)]);
    expect(report.broken).toBe(1);
    expect(report.incidents[0]?.previous).toBe(1294);
  });
});
