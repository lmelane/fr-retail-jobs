import '../test/setup-integration.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { applyRegistryReview, previewRegistryReview, readRegistrySources, type RegistryEntry } from '../registry/explicitRegistry.js';

/**
 * D-520 §2 — `registry-review` sur base réelle : l'aperçu n'écrit rien, l'application n'écrit que l'aperçu relu et le
 * refuse s'il a changé, la base ferme les vocabulaires et exige la date d'une pause expliquée.
 */
const db = new PrismaClient();
const P = 'reg-test-';
const wipe = async () => {
  await db.jobSource.deleteMany({ where: { sourceKey: { startsWith: P } } });
  await db.job.deleteMany({ where: { externalId: { startsWith: P } } });
  await db.company.deleteMany({ where: { canonicalKey: 'REG_TEST' } });
  await db.source.deleteMany({ where: { key: { startsWith: P } } });
};
beforeEach(wipe);
afterAll(async () => { await wipe(); await db.$disconnect(); });

async function fixture() {
  for (const [suffix, status] of [['pause', 'PAUSED'], ['homonyme', 'PAUSED'], ['retiree', 'RETIRED'], ['active', 'ACTIVE']] as const) {
    await db.source.create({ data: { key: P + suffix, maison: suffix, kind: 'greenhouse', config: {}, tier: 'ATS_OFFICIAL', tenantKey: P + suffix, status } });
  }
  const company = await db.company.create({ data: { name: 'Reg Test', canonicalKey: 'REG_TEST', fashionjobsUrl: P + 'company' } });
  const job = await db.job.create({ data: { companyId: company.id, externalId: P + '1', source: 'GREENHOUSE', title: 'Poste', url: 'https://ats.example/reg/1' } });
  await db.jobSource.create({ data: { jobId: job.id, sourceKey: P + 'homonyme', externalId: P + '1', sourceTier: 'ATS_OFFICIAL', url: 'https://ats.example/reg/1' } });
  return { job };
}

const base = { maison: 'x', decision: 'Aucune décision CEO : preuve du test', reason: 'Motif du test.', nextAction: 'Action du test.', question: null };
const mine: RegistryEntry[] = [
  { ...base, key: P + 'pause', currentStatus: 'PAUSED', targetStatus: 'PAUSED', intention: 'COLLECTER', trajectory: 'A_REPARER', basis: 'PREUVE', reviewAt: '2026-10-09' },
  { ...base, key: P + 'homonyme', currentStatus: 'PAUSED', targetStatus: 'RETIRED', intention: 'NE_PAS_COLLECTER', trajectory: 'DECISION', basis: 'PREUVE', reviewAt: null },
  { ...base, key: P + 'retiree', currentStatus: 'RETIRED', targetStatus: 'RETIRED', intention: 'A_TRANCHER', trajectory: 'REVUE_HUMAINE', basis: 'PREUVE', reviewAt: '2026-10-09', question: 'Ce tenant est-il la Maison ?' },
];
/** La base de test peut porter d'autres sources non ACTIVE (autres fichiers) : le registre doit être complet, on les explique. */
async function plan(entries = mine) {
  const others = (await readRegistrySources(db)).filter(s => s.status !== 'ACTIVE' && !s.key.startsWith(P)).map((s): RegistryEntry => ({
    ...base, key: s.key, currentStatus: s.status, targetStatus: s.status, intention: 'A_TRANCHER', trajectory: 'REVUE_HUMAINE', basis: 'PREUVE',
    reviewAt: '2026-10-09', question: 'Source d’un autre fichier de test ?' }));
  return { kind: 'registre-explicite/1', reviewer: 'test D-520', entries: [...entries, ...others] };
}

describe('D-520 §2 — registry-review : aperçu relu, puis application de ce seul fichier', () => {
  it("l'aperçu n'écrit rien ; l'application écrit l'explication, la revue immuable, et retire l'homonyme par retire-source", async () => {
    const { job } = await fixture();
    const preview = await previewRegistryReview(db, await plan());
    expect(preview.refused).toEqual([]);
    expect(preview.retirements).toEqual([{ key: P + 'homonyme', from: 'PAUSED', activeJobs: 1 }]);
    expect((await db.source.findUniqueOrThrow({ where: { key: P + 'pause' } })).statusReviewId).toBeNull();

    const report = await applyRegistryReview(db, JSON.parse(JSON.stringify(preview)));
    expect(report.reviewId).toBe(preview.hash);
    const pause = await db.source.findUniqueOrThrow({ where: { key: P + 'pause' } });
    expect(pause).toMatchObject({ status: 'PAUSED', statusExplainedFor: 'PAUSED', statusTrajectory: 'A_REPARER', statusBasis: 'PREUVE',
      statusReason: 'Motif du test.', statusReviewId: preview.hash });
    expect(pause.statusReviewAt?.toISOString().slice(0, 10)).toBe('2026-10-09');
    expect(await db.source.findUniqueOrThrow({ where: { key: P + 'homonyme' } })).toMatchObject({ status: 'RETIRED', statusExplainedFor: 'RETIRED' });
    expect((await db.jobSource.findFirstOrThrow({ where: { jobId: job.id } })).isActive).toBe(false);
    expect(report.withdrawn).toMatchObject([{ key: P + 'homonyme', sourcesDeactivated: 1 }]);
    expect(await db.sourceRegistryReview.count({ where: { id: preview.hash } })).toBe(1);
    expect((await db.source.findUniqueOrThrow({ where: { key: P + 'active' } })).statusReviewId).toBeNull();

    // Appliqué : l'état d'avant a changé, le même fichier est refusé sans rien écrire.
    await expect(applyRegistryReview(db, preview)).rejects.toThrow('REVIEWED_PLAN_REFUSED');
  });

  it('refuse, sans rien écrire, un aperçu devenu périmé ou retouché', async () => {
    await fixture();
    const preview = await previewRegistryReview(db, await plan());
    await db.source.update({ where: { key: P + 'pause' }, data: { note: 'retouchée après la relecture' } });
    await expect(applyRegistryReview(db, preview)).rejects.toThrow('REVIEWED_PLAN_MISMATCH');
    const fresh = await previewRegistryReview(db, await plan());
    const tampered = { ...fresh, plan: { ...fresh.plan, entries: fresh.plan.entries.map(e => e.key === P + 'pause' ? { ...e, reason: 'autre motif' } : e) } };
    await expect(applyRegistryReview(db, tampered)).rejects.toThrow('REVIEWED_PLAN_MISMATCH');
    expect((await db.source.findUniqueOrThrow({ where: { key: P + 'pause' } })).statusReviewId).toBeNull();
    expect((await db.jobSource.findFirstOrThrow({ where: { sourceKey: P + 'homonyme' } })).isActive).toBe(true);
  });

  it("refuse un registre incomplet : une source non ACTIVE oubliée bloque l'application", async () => {
    await fixture();
    const preview = await previewRegistryReview(db, await plan(mine.slice(0, 2)));
    expect(preview.refused).toContainEqual({ key: P + 'retiree', code: 'NOT_IN_PLAN', detail: 'RETIRED' });
    await expect(applyRegistryReview(db, preview)).rejects.toThrow('REVIEWED_PLAN_REFUSED');
  });

  it('la base ferme le vocabulaire et exige la date de réexamen d’une pause expliquée', async () => {
    await fixture();
    await applyRegistryReview(db, await previewRegistryReview(db, await plan()));
    await expect(db.source.update({ where: { key: P + 'pause' }, data: { statusTrajectory: 'HISTORIQUE' } })).rejects.toThrow(/source_status_trajectory/);
    await expect(db.source.update({ where: { key: P + 'pause' }, data: { statusReviewAt: null } })).rejects.toThrow(/source_status_pause_review/);
    await expect(db.source.update({ where: { key: P + 'retiree' }, data: { statusQuestion: ' ' } })).rejects.toThrow(/source_status_human_question/);
    await expect(db.sourceRegistryReview.deleteMany()).rejects.toThrow(/immutable/);
  });
});
