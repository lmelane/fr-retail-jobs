/**
 * LES CONTRÔLES APRÈS UN REFRESH — par identifiant, en lecture seule.
 *
 * La question n'est pas « le refresh a-t-il tourné » mais « a-t-il touché EXACTEMENT ce qui avait été revu, et
 * rien d'autre ». Tout se compare donc au manifeste figé, par ensembles d'identifiants — jamais par cardinaux :
 * toucher autant de lignes que prévu mais pas les mêmes serait invisible sur un total.
 *
 * usage: refresh-audit.mts --manifest=<f.json> --keys=<k1,k2> --since=<iso> --command=<run> [--out=<f.json>]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { compareTouched, type RefreshManifest } from '../../src/pipeline/refreshManifest.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const manifestFile = arg('manifest');
const keys = (arg('keys') ?? '').split(',').map((k) => k.trim()).filter(Boolean);
const since = new Date(arg('since') ?? 0);
const command = arg('command');
if (!manifestFile || !keys.length) {
  console.error('usage: refresh-audit.mts --manifest=<f.json> --keys=<k1,k2> --since=<iso> --command=<run>');
  process.exit(2);
}

const manifest: RefreshManifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const p = new PrismaClient({ log: [] });
try {
  const problems: string[] = [];

  /** Ce que la mutation a RÉELLEMENT désactivé pendant la fenêtre du run. */
  const touched: any[] = await p.$queryRaw(Prisma.sql`
    SELECT id, "sourceKey", "externalId", "jobId" FROM "JobSource"
    WHERE NOT "isActive" AND "updatedAt" >= ${since}`);
  const parity = compareTouched(manifest, touched.map((t) => t.id));
  if (!parity.equal) {
    if (parity.missing.length) problems.push(`${parity.missing.length} ligne(s) du manifeste NON touchée(s)`);
    if (parity.unexpected.length) problems.push(`${parity.unexpected.length} ligne(s) touchée(s) HORS manifeste : `
      + parity.unexpected.slice(0, 5).join(', '));
  }

  /** Les conséquences réelles, offre par offre, comparées à celles annoncées. */
  const jobIds = [...new Set(manifest.entries.map((e) => e.jobId))];
  const jobs: any[] = jobIds.length ? await p.$queryRaw(Prisma.sql`
    SELECT id, "isActive", "closedAt", "withdrawnAt", "reopenedCount" FROM "Job" WHERE id = ANY(${jobIds})`) : [];
  const byJob = new Map(jobs.map((j) => [j.id, j]));
  const consequenceMismatch: string[] = [];
  for (const jobId of jobIds) {
    const expected = manifest.entries.filter((e) => e.jobId === jobId)
      .some((e) => e.consequence === 'JOB_CANDIDATE_FOR_CLOSURE') ? 'FERMÉE' : 'CONSERVÉE';
    const actual = byJob.get(jobId)?.isActive === false ? 'FERMÉE' : 'CONSERVÉE';
    if (expected !== actual) consequenceMismatch.push(`${jobId} : prévu ${expected}, obtenu ${actual}`);
  }
  if (consequenceMismatch.length) problems.push(`conséquences divergentes : ${consequenceMismatch.slice(0, 5).join(' · ')}`);

  /** Les invariants globaux — chacun correspond à un défaut déjà rencontré dans ce lot. */
  const [inv]: any[] = await p.$queryRaw`
    SELECT count(*) FILTER (WHERE "isActive" AND "closedAt" IS NOT NULL)::int AS "activeWithClosedAt",
           count(*) FILTER (WHERE NOT "isActive" AND "closedAt" IS NOT NULL AND "withdrawnAt" IS NOT NULL)::int AS "bothDates",
           count(*) FILTER (WHERE "isActive")::int AS "activeJobs"
    FROM "Job"`;
  if (inv.activeWithClosedAt > 0) problems.push(`${inv.activeWithClosedAt} offre(s) active(s) portant closedAt`);
  if (inv.bothDates > 0) problems.push(`${inv.bothDates} offre(s) portant closedAt ET withdrawnAt`);

  const [orphans]: any[] = await p.$queryRaw`
    SELECT count(*)::int AS n FROM "Job" j WHERE j."isActive"
      AND NOT EXISTS (SELECT 1 FROM "JobSource" s WHERE s."jobId" = j.id AND s."isActive")`;
  if (orphans.n > 0) problems.push(`${orphans.n} offre(s) active(s) sans aucune attestation`);

  /** Aucune source HORS allowlist ne doit avoir été touchée. */
  const outside = touched.filter((t) => !manifest.allowedSourceKeys.includes(t.sourceKey));
  if (outside.length) problems.push(`${outside.length} ligne(s) désactivée(s) hors allowlist`);

  /** Les retenues doivent être intactes : un refresh n'en supprime aucune. */
  const [holds]: any[] = await p.$queryRaw(Prisma.sql`
    SELECT count(*)::int AS n FROM "SourceObservation"
    WHERE raw ? 'publicationHold' AND "sourceKey" = ANY(${keys})`);

  const run = command ? await p.pipelineRun.findFirst({
    where: { command }, orderBy: { startedAt: 'desc' },
    select: { id: true, status: true, startedAt: true, finishedAt: true, revision: true },
  }) : null;
  /** Un run resté RUNNING est un run orphelin : la garde de déploiement le verrait éternellement en vol. */
  const [running]: any[] = await p.$queryRaw`SELECT count(*)::int AS n FROM "PipelineRun" WHERE "finishedAt" IS NULL`;
  if (running.n > 0) problems.push(`${running.n} run(s) sans date de fin`);

  const audit = {
    at: new Date().toISOString(), planHash: manifest.planHash,
    manifestEntries: manifest.entries.length,
    touched: touched.length, parity,
    consequences: { expected: jobIds.length, mismatches: consequenceMismatch },
    invariants: { ...inv, orphanActiveJobs: orphans.n, holdsRemaining: holds.n },
    pipelineRun: run,
    problems,
  };
  const out = arg('out');
  if (out) writeFileSync(out, JSON.stringify(audit, null, 2));
  console.log(JSON.stringify(audit, null, 1));
  if (problems.length) process.exitCode = 1;
} finally {
  await p.$disconnect();
}
