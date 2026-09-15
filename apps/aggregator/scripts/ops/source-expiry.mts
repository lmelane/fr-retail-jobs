/** RAW deadline backfill. Preview writes bounded plans; apply consumes one exact plan. */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planSourceExpiries, applySourceExpiries, type ExpiryBackfillPlan } from '../../src/pipeline/sourceExpiry.js';

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = process.argv[2];
if (!['preview', 'apply'].includes(mode)) throw new Error('Usage: source-expiry.mts preview --keys=k1,k2 --out=directory | apply --plan=file --hash=sha256 --revision=sha40');
const db = new PrismaClient({ log: [] });
try {
  if (mode === 'preview') {
    if (arg('keys') === undefined || !arg('out')) throw new Error('Preview requires --keys and --out');
    const keys = arg('keys')!.split(',').map(key => key.trim()).filter(Boolean);
    const out = resolve(arg('out')!);
    mkdirSync(out, { recursive: true, mode: 0o700 });
    let cursor: string | undefined, scanned = 0, changes = 0, batches = 0;
    do {
      const page = await planSourceExpiries(db, keys, cursor);
      scanned += page.scanned; changes += page.plan.entries.length;
      if (page.plan.entries.length) {
        writeFileSync(resolve(out, `${page.plan.planHash}.json`), JSON.stringify(page.plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        batches++;
      }
      cursor = page.nextCursor;
    } while (cursor);
    console.log(JSON.stringify({ scanned, changes, batches, out }));
  } else {
    if (!arg('plan') || !arg('hash') || !arg('revision')) throw new Error('Apply requires --plan, --hash and --revision');
    const plan = JSON.parse(readFileSync(arg('plan')!, 'utf8')) as ExpiryBackfillPlan;
    console.log(JSON.stringify(await applySourceExpiries(db, plan, arg('hash')!, arg('revision')!)));
  }
} finally { await db.$disconnect(); }
