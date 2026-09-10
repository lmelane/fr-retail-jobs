/** Local Docker build with explicit disk headroom checks; never prunes data or starts the application. */
import { execFileSync, spawnSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check') || args.length > 1) {
  console.error('Usage: npm run build:local -w @catwalks/aggregator [-- --check]');
  process.exit(2);
}
const GiB = 1024 ** 3;
const capacity = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw Error(`${name} must be a positive GiB value`);
  return value;
};
try {
  const minimumHostGiB = capacity('BUILD_MIN_HOST_FREE_GIB', 8);
  const minimumDockerGiB = capacity('BUILD_MIN_DOCKER_FREE_GIB', 12);
  const host = statfsSync(repo);
  const hostFreeGiB = host.bavail * host.bsize / GiB;
  // A tiny, read-only container measures the daemon's filesystem, not the Mac's.
  // --pull=never makes a missing probe image explicit and avoids downloading on a full disk.
  const probeImage = process.env.DOCKER_SPACE_PROBE_IMAGE ?? 'alpine:latest';
  const probe = spawnSync('docker', ['run', '--rm', '--network=none', '--read-only', '--pull=never',
    '--entrypoint', 'df', probeImage, '-Pk', '/'], { encoding: 'utf8', timeout: 30000 });
  if (probe.status !== 0) throw Error(`Cannot measure Docker free space. Check the daemon and provision the small probe image (${probeImage}) first. ${probe.error?.message ?? probe.stderr.trim()}`);
  const rows = probe.stdout.trim().split('\n');
  const fields = rows.at(-1).trim().split(/\s+/);
  const dockerAvailableKiB = Number(fields[3]);
  if (fields.length < 6 || !Number.isFinite(dockerAvailableKiB) || dockerAvailableKiB < 0)
    throw Error('Unrecognized Docker disk measurement; build not started');
  const dockerFreeGiB = dockerAvailableKiB * 1024 / GiB;
  const context = execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim();
  console.log(JSON.stringify({ event: 'build.disk_preflight', context,
    hostFreeGiB: +hostFreeGiB.toFixed(2), dockerFreeGiB: +dockerFreeGiB.toFixed(2),
    minimumHostGiB, minimumDockerGiB }));
  if (hostFreeGiB < minimumHostGiB || dockerFreeGiB < minimumDockerGiB)
    throw Error('Insufficient build headroom. Increase Docker capacity or review unused images; no volume, container or cache was deleted.');
  if (!args.includes('--check')) {
    const build = spawnSync('docker', ['build', '-f', 'apps/aggregator/Dockerfile',
      '-t', 'catwalks-aggregator:local', '.'], { cwd: repo, stdio: 'inherit' });
    if (build.error) throw build.error;
    process.exitCode = build.status ?? 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
