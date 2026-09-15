/** Versioned, evidence-bound repair. Preview is read-only; apply requires the exact reviewed plan hash. */
import { PrismaClient } from '@prisma/client';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { planFactsRepair, applyFactsRepair, type FactsRepairPlan } from '../../src/facts/repair.js';
const arg = (key: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const db = new PrismaClient();
try {
  if (process.argv.includes('--apply')) {
    if (!arg('plan') || !arg('hash')) throw new Error('Apply requires --plan=<file> --hash=<reviewed hash>');
    const plan = JSON.parse(readFileSync(arg('plan')!, 'utf8')) as FactsRepairPlan;
    console.log(JSON.stringify(await applyFactsRepair(db, plan, arg('hash')!)));
  } else {
    if (!arg('keys') || !arg('out')) throw new Error('Preview requires --keys=<source keys> --out=<plan.json>');
    const plan = await planFactsRepair(db, arg('keys')!.split(',').map(key => key.trim()), { limit: arg('limit') ? Number(arg('limit')) : undefined, cursor: arg('cursor') });
    writeFileSync(arg('out')!, JSON.stringify(plan, null, 2) + '\n', { mode: 0o600 });
    chmodSync(arg('out')!, 0o600);
    console.log(JSON.stringify({ planHash: plan.planHash, entries: plan.entries.length, nextCursor: plan.nextCursor }));
  }
} finally { await db.$disconnect(); }
