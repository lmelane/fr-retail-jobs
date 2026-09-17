/** Archive a reviewed plan. This command changes no offers or source publications. */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { storeRefreshManifest, type RefreshManifest } from '../../src/pipeline/refreshManifest.js';
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!arg('file') || !arg('revision')) throw new Error('refresh-manifest.mts --file=manifest.json --revision=sha40');
const db = new PrismaClient({ log: [] });
try {
  const manifest = JSON.parse(readFileSync(arg('file')!, 'utf8')) as RefreshManifest;
  console.log(JSON.stringify(await storeRefreshManifest(db, manifest, arg('revision')!)));
} finally { await db.$disconnect(); }
