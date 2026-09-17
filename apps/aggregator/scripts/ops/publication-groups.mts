/** Preview and apply one complete, bounded publication partition. */
import { PrismaClient } from '@prisma/client';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { planPublicationGroups, applyPublicationGroups, type GroupRepairPlan, type GroupRepairRequest } from '../../src/dedup/repair.js';
import { objectStoreConfigured, objectStoreFromEnv } from '../../src/retention/objectStore.js';

const args = new Map<string, string>();
for (const value of process.argv.slice(2)) {
  const match = /^--(request|out|plan|hash)=(.+)$/.exec(value);
  const name = value === '--apply' ? 'apply' : match?.[1];
  if (!name || args.has(name) || name !== 'apply' && !match?.[2].trim()) throw new Error('Unknown, duplicate or empty publication repair option');
  args.set(name, match?.[2] ?? 'true');
}
const applying = args.has('apply');
if ([...args.keys()].some(key => !(applying ? ['apply', 'plan', 'hash'] : ['request', 'out']).includes(key))) throw new Error('Preview and apply options cannot be mixed');
const arg = (key: string) => args.get(key);
const db = new PrismaClient();
try {
  const store = objectStoreConfigured() ? objectStoreFromEnv() : undefined;
  if (applying) {
    if (!arg('plan') || !arg('hash')) throw new Error('Apply requires --plan=<file> --hash=<reviewed hash>');
    const plan = JSON.parse(readFileSync(arg('plan')!, 'utf8')) as GroupRepairPlan;
    console.log(JSON.stringify(await applyPublicationGroups(db, plan, arg('hash')!, store)));
  } else {
    if (!arg('request') || !arg('out')) throw new Error('Preview requires --request=<partition.json> --out=<plan.json>');
    const request = JSON.parse(readFileSync(arg('request')!, 'utf8')) as GroupRepairRequest;
    const plan = await planPublicationGroups(db, request, store);
    writeFileSync(arg('out')!, JSON.stringify(plan, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    chmodSync(arg('out')!, 0o600);
    console.log(JSON.stringify({ planHash: plan.planHash, groups: plan.groups.length, redirects: plan.redirects.length }));
  }
} finally { await db.$disconnect(); }
