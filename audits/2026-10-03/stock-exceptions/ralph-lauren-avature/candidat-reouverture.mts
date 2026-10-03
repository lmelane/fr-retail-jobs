/**
 * D-522 §6 — lecture seule : le candidat que `source-add --registered-revision` construirait pour Ralph Lauren, avec le
 * vrai parseur (`sourceLaunchArguments`) et la vraie construction (`registeredSourceCandidate`), sur la ligne de production.
 * N'écrit rien. Invocation (depuis la racine du worktree) :
 *   CATWALKS_DB_ACCESS=…/backups/remediation-20260908 python3 apps/aggregator/scripts/ops/db.py readonly \
 *     npx tsx audits/2026-10-03/stock-exceptions/ralph-lauren-avature/candidat-reouverture.mts
 */
import { PrismaClient } from '@prisma/client';
import { sourceLaunchArguments, registeredSourceCandidate } from '../../../../apps/aggregator/src/onboarding/launch.js';

const args = ['--key=ralph-lauren-avature', '--registered-revision=de332ddf-b45d-42fa-a89e-9ab1106e0d62', '--official-domain=ralphlauren.com', '--reviewer=loic-melane-d522'];
const input = sourceLaunchArguments(args);
const db = new PrismaClient();
try {
  const row = await db.source.findUniqueOrThrow({ where: { key: input.registered!.key } });
  const candidate = registeredSourceCandidate(input.registered!, row, input.reviewer);
  console.log(JSON.stringify({ args, status: row.status, currentRevisionId: row.currentRevisionId, portalScope: row.portalScope, candidate }, null, 1));
} finally { await db.$disconnect(); }
