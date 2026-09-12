/**
 * LES DEUX CONTRATS D'UN CYCLE, LUS SUR LA BASE RÉELLE — lecture seule.
 *
 * Un module testé n'est pas un contrat opérationnel : tant que personne ne le nourrit avec l'état réel, il ne
 * protège rien. Ce programme lit, pour chaque source et chaque `runId`, les sept ensembles d'identifiants et
 * les réconcilie par `persistenceContract`.
 *
 * TOUT EST CORRÉLÉ AU MÊME `runId`. Une retenue historique n'est pas une retenue de ce cycle : la réutiliser
 * ferait passer pour « vue et retenue » une offre que ce cycle n'a jamais rencontrée.
 *
 * usage: cycle-contracts.mts --keys=<k1,k2,…> [--run-id=<id>] [--out=<f.json>]
 *   --run-id  le cycle à juger ; par défaut le dernier `runId` de chaque source.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { persistenceContract, type CycleSets } from '../../src/pipeline/persistenceContract.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const keys = (arg('keys') ?? '').split(',').map((k) => k.trim()).filter(Boolean);
const pinnedRun = arg('run-id');
if (!keys.length) { console.error('usage: cycle-contracts.mts --keys=<k1,k2,…> [--run-id=<id>]'); process.exit(2); }

const p = new PrismaClient({ log: [] });
try {
  /** Le cycle jugé : celui demandé, sinon le dernier run de chaque source. */
  const runs: any[] = await p.$queryRaw(Prisma.sql`
    SELECT DISTINCT ON ("sourceKey") "sourceKey", "runId", status, fetched, errors, complete,
           "canAttestAbsence", truncated, "ranAt"
    FROM "SourceRun"
    WHERE "sourceKey" = ANY(${keys}) ${pinnedRun ? Prisma.sql`AND "runId" = ${pinnedRun}` : Prisma.empty}
    ORDER BY "sourceKey", "ranAt" DESC, id DESC`);

  const report: any[] = [];
  for (const run of runs) {
    const runId: string | null = run.runId;
    if (!runId) { report.push({ source: run.sourceKey, error: 'run sans runId : cycle non corrélable' }); continue; }

    /** 1. Les identifiants canoniques archivés par la preuve de CE cycle. */
    const ev: any[] = await p.$queryRaw(Prisma.sql`
      SELECT coalesce((SELECT array_agg(x) FROM
               jsonb_array_elements(coalesce(payload->'enumeration'->'pageEvidence','[]'::jsonb)) pe,
               jsonb_array_elements_text(coalesce(pe->'canonicalIds','[]'::jsonb)) x), ARRAY[]::text[]) AS ids,
             coalesce((SELECT bool_and(pe ? 'canonicalIds') FROM
               jsonb_array_elements(coalesce(payload->'enumeration'->'pageEvidence','[]'::jsonb)) pe), false) AS declared,
             payload->'enumeration'->'canonicalAbsenceProofUsable' AS usable,
             payload->'enumeration'->>'termination' AS termination
      FROM "PipelineEvent"
      WHERE event = 'source.enumeration_observed' AND "sourceKey" = ${run.sourceKey} AND "runId" = ${runId}
      ORDER BY at DESC LIMIT 1`);
    const canonicalObservedIds: string[] = ev[0]?.ids ?? [];
    const declared = Boolean(ev[0]?.declared);

    /** 2. Ce qui existe RÉELLEMENT en base après ce cycle. */
    const persisted: any[] = await p.$queryRaw(Prisma.sql`
      SELECT array_agg(js."externalId") AS ids FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."isActive" AND j."isActive" AND js."sourceKey" = ${run.sourceKey}`);
    const persistedJobSourceExternalIds: string[] = persisted[0]?.ids ?? [];

    /**
     * 3. Les retenues DE CE CYCLE, lues sur l'événement `job.publication_held` corrélé au `runId`.
     *
     * Première version : je bornais `SourceObservation` par une fenêtre de temps autour du run. C'était une
     * approximation — la table ne porte pas de `runId`, et une retenue historique tombant dans la fenêtre
     * aurait compté pour ce cycle. L'événement, lui, EST corrélé, et porte l'identifiant en colonne.
     */
    const held: any[] = await p.$queryRaw(Prisma.sql`
      SELECT DISTINCT "jobId" FROM "PipelineEvent"
      WHERE event = 'job.publication_held' AND "sourceKey" = ${run.sourceKey} AND "runId" = ${runId}
        AND "jobId" IS NOT NULL`);

    /** 4. Les échecs d'écriture, lus dans la COLONNE `jobId` — jamais dans le message d'erreur. */
    const failed: any[] = await p.$queryRaw(Prisma.sql`
      SELECT "jobId" FROM "PipelineEvent"
      WHERE event = 'job.write_failed' AND "sourceKey" = ${run.sourceKey} AND "runId" = ${runId}
        AND "jobId" IS NOT NULL`);
    const anonymous: any[] = await p.$queryRaw(Prisma.sql`
      SELECT count(*)::int AS n FROM "PipelineEvent"
      WHERE event = 'job.write_failed' AND "sourceKey" = ${run.sourceKey} AND "runId" = ${runId}
        AND "jobId" IS NULL`);

    /**
     * 5. Les rejets identifiables, lus sur l'événement RÉEL `source.rows_rejected` (vérifié en base — j'avais
     * d'abord interrogé un `source.rejected_rows` qui n'existe pas, et qui aurait rendu un ensemble vide en
     * silence, donc de faux trous dans le contrat).
     */
    const rejected: any[] = await p.$queryRaw(Prisma.sql`
      SELECT coalesce((SELECT array_agg(r->>'canonicalId') FROM
               jsonb_array_elements(coalesce(payload->'rejectedRows','[]'::jsonb)) r
               WHERE r ? 'canonicalId'), ARRAY[]::text[]) AS ids,
             coalesce((SELECT count(*)::int FROM
               jsonb_array_elements(coalesce(payload->'rejectedRows','[]'::jsonb)) r
               WHERE NOT (r ? 'canonicalId')), 0) AS anonymous
      FROM "PipelineEvent"
      WHERE event = 'source.rows_rejected' AND "sourceKey" = ${run.sourceKey} AND "runId" = ${runId}
      ORDER BY at DESC LIMIT 1`);

    const sets: CycleSets = {
      sourceKey: run.sourceKey, runId,
      canonicalObservedIds,
      persistedJobSourceExternalIds,
      heldIds: held.map((h) => h.jobId),
      writeFailedIds: failed.map((f) => f.jobId),
      rejectedIds: rejected[0]?.ids ?? [],
      collectionErrorIds: [],
      // Une ligne rejetée SANS identifiant masque peut-être une offre : même traitement qu'un échec anonyme.
      unattributableWriteFailures: (anonymous[0]?.n ?? 0) + (rejected[0]?.anonymous ?? 0),
    };

    /**
     * Un adaptateur qui ne déclare PAS le contrat canonique n'est pas jugé sur l'égalité des ensembles : il
     * n'a rien promis. Il reste simplement incapable de prouver une absence, ce que la prévisualisation dit.
     */
    const verdict = declared ? persistenceContract(sets) : {
      satisfied: false, absenceProvable: false,
      violations: ['contrat canonique non déclaré par l\'adaptateur : rien à réconcilier'],
      observedNotAccountedFor: [], persistedNotObserved: [],
    };

    report.push({
      source: run.sourceKey, runId, termination: ev[0]?.termination ?? null,
      canonicalContractDeclared: declared,
      canonicalAbsenceProofUsable: ev[0]?.usable === null || ev[0]?.usable === undefined ? null : Boolean(ev[0].usable),
      run: { status: run.status, fetched: run.fetched, errors: run.errors, complete: run.complete,
             canAttestAbsence: run.canAttestAbsence, truncated: run.truncated },
      counts: {
        observed: canonicalObservedIds.length, persisted: persistedJobSourceExternalIds.length,
        held: sets.heldIds.length, writeFailed: sets.writeFailedIds.length,
        rejected: sets.rejectedIds.length, anonymousFailures: sets.unattributableWriteFailures,
      },
      verdict,
    });
  }

  const out = arg('out');
  if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), report }, null, 2));

  console.log('CONTRAT DE PERSISTANCE, par source et par cycle :');
  for (const r of report) {
    const v = r.verdict;
    console.log(`  ${v?.satisfied ? '✓' : '✗'} ${String(r.source).padEnd(26)} run=${String(r.runId).slice(0, 8)} `
      + `obs=${r.counts?.observed ?? '—'} pers=${r.counts?.persisted ?? '—'} held=${r.counts?.held ?? '—'} `
      + `wf=${r.counts?.writeFailed ?? '—'} rej=${r.counts?.rejected ?? '—'} anon=${r.counts?.anonymousFailures ?? '—'}`);
    for (const violation of v?.violations ?? []) console.log(`      · ${violation}`);
  }
  const provable = report.filter((r) => r.verdict?.absenceProvable).map((r) => r.source);
  console.log(`\nsources pouvant prouver une absence : ${provable.length}/${report.length}`
    + (provable.length ? ` — ${provable.join(', ')}` : ''));
} finally {
  await p.$disconnect();
}
