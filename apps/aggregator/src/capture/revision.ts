import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { release } from '@catwalks/runtime';

let localRevision: string | undefined;
/** A local extraction also has a concrete reader fingerprint, including dependencies. */
export function captureReaderRevision(): string {
  // Registry images have no Railway Git source. Their sealed revision is the
  // same identity used by startup attestation and PipelineRun.
  const deployed = release?.gitSha ?? process.env.RAILWAY_GIT_COMMIT_SHA;
  if (release && process.env.RAILWAY_GIT_COMMIT_SHA && process.env.RAILWAY_GIT_COMMIT_SHA !== release.gitSha)
    throw new Error('Deployed reader differs from the embedded release');
  if (deployed !== undefined) {
    if (!/^[a-f0-9]{40}$/i.test(deployed)) throw new Error('Invalid deployed reader revision');
    return `git:${deployed.toLowerCase()}`;
  }
  if (localRevision) return localRevision;
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const paths = ['package-lock.json'];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (['node_modules', 'fixtures', 'test', 'prisma'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:ts|json|csv)$/.test(entry.name) && !/\.(?:test|spec)\.ts$/.test(entry.name)) paths.push(path);
    }
  };
  walk('apps/aggregator/src'); walk('packages/db');
  const hash = createHash('sha256');
  for (const path of paths.sort()) hash.update(relative(root, join(root, path))).update('\0').update(readFileSync(join(root, path))).update('\0');
  return localRevision = `local-sha256:${hash.digest('hex')}`;
}
