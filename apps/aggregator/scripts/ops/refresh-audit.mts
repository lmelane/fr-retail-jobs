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

  /**
   * Ce que la mutation a RÉELLEMENT désactivé.
   *
   * `JobSource` n'a PAS de colonne `updatedAt` : la requête d'origine ne pouvait pas s'exécuter (`42703`), et
   * l'audit mourait APRÈS la mutation — le pire moment, puisque la mutation restait alors non vérifiée.
   *
   * Une fenêtre de temps aurait de toute façon été le mauvais instrument : elle ramasse ce qu'un autre
   * processus a touché dans les mêmes secondes. Le manifeste NOMME les lignes ; on interroge donc exactement
   * celles-là, plus l'ensemble des lignes inactives des sources du périmètre — pour détecter aussi ce qui a
   * été désactivé HORS manifeste, qui est le vrai danger.
   */
  const manifestIds = manifest.entries.map((e) => e.jobSourceId);
  const touched: any[] = await p.$queryRaw(Prisma.sql`
    SELECT js.id, js."sourceKey", js."externalId", js."jobId" FROM "JobSource" js
    JOIN "Job" j ON j.id = js."jobId"
    WHERE NOT js."isActive" AND js."sourceKey" = ANY(${manifest.allowedSourceKeys})
      AND (
        -- ce que CE run a fermé : la fermeture de l'offre date de la fenêtre du run…
        j."closedAt" >= ${since}
        -- …ou la ligne du manifeste est bien inactive, même si son offre survit par une autre source.
        OR js.id = ANY(${manifestIds})
      )`);
  const parity = compareTouched(manifest, touched.map((t) => t.id));

  /**
   * LE MANIFESTE EST UN PLAFOND, PAS UN PLANCHER.
   *
   * `runRefresh` cumule trois conditions : allowlist ET manifeste ET `lastSeenAt < cutoff` (48 h). Une ligne
   * du manifeste encore FRAÎCHE n'est donc pas désactivée — et c'est le comportement voulu : la ré-attestation
   * récente prime, une offre re-vue il y a dix heures ne se ferme pas.
   *
   * Exiger que TOUTE ligne du manifeste soit touchée reviendrait à demander au refresh d'ignorer sa propre
   * garde de fraîcheur. On sépare donc deux constats qui n'ont pas la même gravité :
   *  · non touchée ET fraîche  → attendu, expliqué, jamais un problème ;
   *  · non touchée ET périmée  → là, il manque une mutation, et c'est un défaut.
   * Une ligne touchée HORS manifeste reste toujours un problème : c'est le plafond qui aurait fui.
   */
  const staleHours = Number(arg('stale-hours') ?? 48);
  const cutoff = new Date(Date.now() - staleHours * 3_600_000);
  const freshness: any[] = parity.missing.length ? await p.$queryRaw(Prisma.sql`
    SELECT id, "sourceKey", "externalId", "lastSeenAt" FROM "JobSource" WHERE id = ANY(${parity.missing})`) : [];
  const untouchedBecauseFresh = freshness.filter((f) => f.lastSeenAt >= cutoff);
  const untouchedUnexplained = freshness.filter((f) => f.lastSeenAt < cutoff);

  if (untouchedUnexplained.length) {
    problems.push(`${untouchedUnexplained.length} ligne(s) du manifeste NON touchée(s) alors qu'elles sont périmées : `
      + untouchedUnexplained.map((f) => `${f.sourceKey}/${f.externalId}`).slice(0, 5).join(', '));
  }
  if (parity.unexpected.length) {
    problems.push(`${parity.unexpected.length} ligne(s) touchée(s) HORS manifeste : `
      + parity.unexpected.slice(0, 5).join(', '));
  }

  /**
   * Les conséquences réelles, offre par offre, comparées à celles annoncées.
   *
   * Une offre dont la ligne n'a pas été désactivée (parce qu'encore fraîche) n'a évidemment pas fermé : la
   * comparer à la conséquence prévue signalerait le même fait une seconde fois, sous un nom plus alarmant.
   * On n'évalue donc que les offres dont TOUTES les lignes du manifeste ont effectivement été touchées.
   */
  const untouchedIds = new Set(freshness.map((f) => f.id));
  const jobIds = [...new Set(manifest.entries
    .filter((e) => !untouchedIds.has(e.jobSourceId))
    .map((e) => e.jobId))];
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
