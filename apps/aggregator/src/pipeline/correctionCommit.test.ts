import '../test/setup-integration.js';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { publicationFixture } from '../test/publication-fixture.js';
import { attestSyntheticFeed, releaseQualifiedSources } from '../test/ingestionFixture.js';

/** The embedded release of a registry image; null is a local worktree. Only `release` is replaced. */
const runtime = vi.hoisted(() => ({ release: null as { gitSha: string; contractSha256: string } | null }));
vi.mock('@catwalks/runtime', async importOriginal => ({ ...await importOriginal<typeof import('@catwalks/runtime')>(), get release() { return runtime.release; } }));
import { runRefresh } from './refresh.js';

const db = new PrismaClient();
afterEach(() => { runtime.release = null; vi.unstubAllEnvs(); });
afterAll(async () => { await releaseQualifiedSources(db); await db.$disconnect(); });

/**
 * D-453 : les corrections de cycle de vie des RUN de production des 23 et 24/09/2026 (755 puis 54 lignes)
 * portent `commitHash = LOCAL_WORKTREE` parce que l'écrivain ne lisait que RAILWAY_GIT_COMMIT_SHA, absent des
 * images du registre. Le SHA attesté est celui de la release embarquée — le même que PipelineRun.revision.
 */
it('journals a refresh closure with the embedded release SHA of a registry image', async () => {
  const key = `trace-${randomUUID()}`;
  // The whole run happens under the image's release: qualification, collection and refresh share one reader.
  const sha = 'b'.repeat(40);
  runtime.release = { gitSha: sha, contractSha256: 'c'.repeat(64) };
  vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', undefined);
  const company = await db.company.create({ data: { name: key, canonicalKey: key, fashionjobsUrl: `resolved:${key}-${randomUUID()}` } });
  await attestSyntheticFeed(db, key, []); // the source proves an empty board
  const seen = new Date(Date.now() - 72 * 3_600_000);
  const gone = await db.job.create({ data: { companyId: company.id, externalId: `${key}-gone`, source: 'GENERIC_JSONLD', title: 'Conseiller de vente',
    url: `https://x/${key}-gone`, isActive: true, lastSeenAt: seen, sources: { create: { sourceKey: key, sourceTier: 'ATS_OFFICIAL', externalId: `s-${key}`,
      ...publicationFixture({ sourceKey: key, externalId: `s-${key}`, url: `https://x/${key}-gone`, title: 'Conseiller de vente' }),
      url: `https://x/${key}-gone`, isActive: true, lastSeenAt: seen } } } });
  // Premise: exactly the registry image situation — a sealed release, no platform Git SHA.
  expect(process.env.RAILWAY_GIT_COMMIT_SHA).toBeUndefined();
  expect(await runRefresh(db, { onlyKeys: [key] })).toMatchObject({ closedJobs: 1 });
  const rows = await db.dataCorrection.findMany({ where: { finding: 'REFRESH_LIFECYCLE', entityId: gone.id } });
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.map(row => row.commitHash)).toEqual(rows.map(() => sha));
});

it('keeps LOCAL_WORKTREE only for a local run without any embedded release', async () => {
  const { deployedCommitHash } = await import('../capture/revision.js');
  vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', undefined);
  expect(deployedCommitHash()).toBe('LOCAL_WORKTREE');
  runtime.release = { gitSha: 'A'.repeat(40), contractSha256: 'c'.repeat(64) };
  expect(deployedCommitHash()).toBe('a'.repeat(40));
  // A platform SHA can never replace the embedded one.
  vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', 'd'.repeat(40));
  expect(() => deployedCommitHash()).toThrow('differs from the embedded release');
});
