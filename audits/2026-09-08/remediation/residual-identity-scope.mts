import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const p = new PrismaClient();
try {
  const archive = JSON.parse(readFileSync('backups/remediation-20260908/source-identity-chain.json', 'utf8')) as Array<{ key: string; status: string; history: Array<{ verified: string }> }>;
  const keys = archive.filter(row => row.status === 'ACTIVE' && row.history.length === 1 && row.history[0].verified === 'validated-name').map(row => row.key);
  const result = await p.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const remaining = await tx.source.findMany({ where: { key: { in: keys }, status: 'ACTIVE' }, select: { key: true, maison: true } });
    return {
      at: new Date().toISOString(), readOnly: true, historicalNameOnlySources: keys.length,
      remainingActive: remaining.length,
      remainingUniqueActiveJobs: await tx.job.count({ where: { isActive: true, sources: { some: { isActive: true, sourceKey: { in: remaining.map(s => s.key) } } } } }),
      interpretation: 'Requalification backlog, not a count of demonstrated errors.',
      sources: remaining,
    };
  }, { timeout: 20000 });
  console.log(JSON.stringify(result, null, 2));
} finally { await p.$disconnect(); }
