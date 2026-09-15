/** RAW deadline backfill. Preview writes bounded plans; apply consumes one exact plan. */
import { PrismaClient } from '@prisma/client';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planSourceExpiries, applySourceExpiries, type ExpiryBackfillPlan } from '../../src/pipeline/sourceExpiry.js';
import { objectStoreConfigured, objectStoreFromEnv } from '../../src/retention/objectStore.js';

const mode = process.argv[2];
if (!['preview', 'apply'].includes(mode))
  throw new Error('Usage: source-expiry.mts preview --keys=k1,k2 --out=directory | apply --plan=file --hash=sha256');
const args = new Map<string, string>();
for (const value of process.argv.slice(3)) {
  const match = /^--(keys|out|plan|hash)=(.+)$/.exec(value);
  if (!match || !match[2].trim() || args.has(match[1])) throw new Error('Unknown, duplicate or empty expiry option');
  if (!(mode === 'preview' ? ['keys', 'out'] : ['plan', 'hash']).includes(match[1]))
    throw new Error('Preview and apply options cannot be mixed');
  args.set(match[1], match[2]);
}
const arg = (name: string) => args.get(name);
const db = new PrismaClient({ log: [] });
try {
  const store = objectStoreConfigured() ? objectStoreFromEnv() : undefined;
  if (mode === 'preview') {
    if (!arg('keys') || !arg('out')) throw new Error('Preview requires --keys and --out');
    const keys = arg('keys')!
      .split(',')
      .map((key) => key.trim());
    if (keys.some((key) => !key)) throw new Error('Preview requires explicit nonempty source keys');
    const out = resolve(arg('out')!);
    mkdirSync(out, { recursive: true, mode: 0o700 });
    let cursor: string | undefined,
      scanned = 0,
      changes = 0,
      reviews = 0,
      batches = 0;
    do {
      const page = await planSourceExpiries(db, keys, cursor, 250, store);
      scanned += page.scanned;
      changes += page.plan.entries.length;
      reviews += page.plan.reviews.length;
      if (page.plan.entries.length || page.plan.reviews.length) {
        const path = resolve(out, `${page.plan.planHash}.json`);
        writeFileSync(path, JSON.stringify(page.plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        chmodSync(path, 0o600);
        batches++;
      }
      cursor = page.nextCursor;
    } while (cursor);
    console.log(JSON.stringify({ scanned, changes, reviews, batches, out }));
  } else {
    if (!arg('plan') || !arg('hash')) throw new Error('Apply requires --plan and --hash');
    if (statSync(arg('plan')!).size > 8_000_000) throw new Error('Expiry plan exceeds the bounded file size');
    const plan = JSON.parse(readFileSync(arg('plan')!, 'utf8')) as ExpiryBackfillPlan;
    console.log(JSON.stringify(await applySourceExpiries(db, plan, arg('hash')!, store)));
  }
} finally {
  await db.$disconnect();
}
