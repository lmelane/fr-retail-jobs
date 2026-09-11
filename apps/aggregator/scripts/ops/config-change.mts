/**
 * A REAL configuration change on a source the pipeline uses, and what it invalidates.
 *
 * The identity review is bound to the configuration by `sourceIdentityHash`, which covers key, maison, kind,
 * config, careersDomain, tenantKey and tier. Changing the configuration must make the existing certification
 * stop applying — that is the guarantee, and `assertIdentityReview` (the promotion gate's own predicate) is what
 * states it. A file hash would prove nothing about the source.
 *
 * Note what this scenario does NOT cover: re-running an UNCHANGED validator after editing the config proves the
 * config binding. A corrected VALIDATOR is a different scenario — see `validator-regression.mts`.
 *
 * Clone only — the guard is the database name. Without `--apply` it only reports the current verdict.
 *
 * usage: config-change.mts <sourceKey> [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { assertIdentityReview, sourceIdentityHash } from '../../src/connectors/sourceIdentity.js';

const key = process.argv[2];
if (!key) { console.error('usage: config-change.mts <sourceKey> [--apply]'); process.exit(2); }
const apply = process.argv.includes('--apply');

const SELECT = { key: true, maison: true, kind: true, config: true, careersDomain: true, tenantKey: true, tier: true, status: true } as const;

const p = new PrismaClient();
try {
  const [{ current_database: db }]: any[] = await p.$queryRaw`SELECT current_database()`;
  if (!/replay|clone|test/.test(db)) throw new Error(`refusing: ${db} is not a clone/replay/test database`);

  const before = await p.source.findUniqueOrThrow({ where: { key }, select: SELECT });
  const review = await p.sourceIdentityReview.findFirst({ where: { sourceKey: key }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const verdict = (src: any) => {
    if (!review) return 'NO_REVIEW';
    try { assertIdentityReview(src, review); return 'CERTIFIED'; } catch (e) { return `INVALID: ${(e as Error).message.replace(/^promote: /, '').slice(0, 70)}`; }
  };

  const out: Record<string, unknown> = { database: db, key, hashBefore: sourceIdentityHash(before as any), verdictBefore: verdict(before) };
  if (apply) {
    // The tenant's own setting, exactly what an operator would edit — not a synthetic field.
    const config = { ...(before.config as any), maxPages: ((before.config as any)?.maxPages ?? 1) + 1 };
    await p.source.update({ where: { key }, data: { config } });
    const after = await p.source.findUniqueOrThrow({ where: { key }, select: SELECT });
    out.configAfter = config;
    out.hashAfter = sourceIdentityHash(after as any);
    out.verdictAfter = verdict(after);
    out.hashChanged = out.hashBefore !== out.hashAfter;
  }
  console.log(JSON.stringify(out, null, 1));
} finally { await p.$disconnect(); }
