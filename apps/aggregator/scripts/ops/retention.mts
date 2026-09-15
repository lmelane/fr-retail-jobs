/** Retention preview/apply. No schedule is activated by this command. */
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { planRetention, applyRetention, ARCHIVE_MINIMUM_MONTHS, type RetentionPlan } from '../../src/retention/retention.js';
import { objectStoreFromEnv } from '../../src/retention/objectStore.js';

const arg = (key: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const db = new PrismaClient();
try {
  if (process.argv.includes('--apply')) {
    if (!arg('plan') || !arg('hash')) throw new Error('Apply requires --plan=<file> --hash=<reviewed hash>');
    const plan = JSON.parse(readFileSync(arg('plan')!, 'utf8')) as RetentionPlan;
    const store = objectStoreFromEnv();
    console.log(JSON.stringify(await applyRetention(db, plan, arg('hash')!, store)));
  } else {
    if (arg('keys') === undefined || !arg('out')) throw new Error('Preview requires --keys=<source keys> --out=<plan.json>');
    const keys = arg('keys')!.split(',').map(key => key.trim()).filter(Boolean);
    const plan = await planRetention(db, keys);
    writeFileSync(arg('out')!, JSON.stringify(plan, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ planHash: plan.planHash, observations: plan.observations.length, blobs: plan.blobs.length, cutoff: plan.cutoff,
      archiveMinimumMonths: ARCHIVE_MINIMUM_MONTHS, referencedEvidencePreserved: true }));
  }
} finally { await db.$disconnect(); }
