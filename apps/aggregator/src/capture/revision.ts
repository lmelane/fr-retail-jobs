import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { release } from '@catwalks/runtime';

let localRevision: string | undefined;

/**
 * The Git SHA of the running code, or undefined for a local worktree without a release.
 * Registry images have no Railway Git source: their sealed release is the same identity
 * used by startup attestation and PipelineRun. A platform SHA can never replace it.
 */
function deployedGitSha(): string | undefined {
  const deployed = release?.gitSha ?? process.env.RAILWAY_GIT_COMMIT_SHA;
  if (release && process.env.RAILWAY_GIT_COMMIT_SHA && process.env.RAILWAY_GIT_COMMIT_SHA !== release.gitSha)
    throw new Error('Deployed reader differs from the embedded release');
  if (deployed === undefined) return undefined;
  if (!/^[a-f0-9]{40}$/i.test(deployed)) throw new Error('Invalid deployed reader revision');
  return deployed.toLowerCase();
}

/**
 * The commit recorded on a DataCorrection written by the running code (D-453). Reading only
 * RAILWAY_GIT_COMMIT_SHA — absent from registry images — journaled 755 then 54 refresh
 * corrections of the production RUNs of 23 and 24/09/2026 as LOCAL_WORKTREE. Only a local
 * worktree without any embedded release keeps that explicit marker.
 */
export function deployedCommitHash(): string {
  return deployedGitSha() ?? 'LOCAL_WORKTREE';
}

/** A local extraction also has a concrete reader fingerprint, including dependencies. */
export function captureReaderRevision(): string {
  const deployed = deployedGitSha();
  if (deployed !== undefined) return `git:${deployed}`;
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
