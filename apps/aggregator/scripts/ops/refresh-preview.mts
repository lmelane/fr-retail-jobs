/**
 * PRÉVISUALISATION DU REFRESH — strictement en lecture seule, par IDENTIFIANT.
 *
 * Ce que le refresh ferait, avant qu'il le fasse. Aucune écriture, aucune transaction mutante : le programme
 * REJOUE la logique de `runRefresh` sur l'état lu, et nomme pour chaque représentation la raison exacte pour
 * laquelle elle serait désactivée.
 *
 * LA LISTE CANDIDATE NE VIENT JAMAIS DU STATUT `ACTIVE`. Elle vient des derniers `SourceRun` réels : une
 * source n'est recevable que si son dernier run porte `errors = 0`, `truncated = false`, `complete = true`,
 * `canAttestAbsence = true` et une terminaison d'énumération DÉMONTRÉE. Le registre P6 a séparé « au
 * catalogue » de « a démontré son exhaustivité » ; confondre les deux est précisément ce qui fermerait des
 * offres vivantes.
 *
 * Les ensembles d'identifiants sont comparés comme des ENSEMBLES, jamais par leurs cardinaux : deux runs
 * peuvent rendre le même total sur des offres différentes (leçon P5).
 *
 * usage: refresh-preview.mts --keys=<k1,k2,…> [--stale-hours=48] [--out=<f.json>]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const requested = (arg('keys') ?? '').split(',').map((k) => k.trim()).filter(Boolean);
const staleHours = Number(arg('stale-hours') ?? 48);
if (!requested.length) { console.error('usage: refresh-preview.mts --keys=<k1,k2,…>'); process.exit(2); }

/** Les terminaisons qui DÉMONTRENT la fin du parcours (P4) — jamais un ratio. */
const PROVING_TERMINATIONS = new Set([
  'PUBLISHER_TOTAL_REACHED', 'SECOND_SWEEP_RECONCILED', 'FULL_RESPONSE', 'PARTITIONS_RECONCILED',
  'ALL_LOCALE_TOTALS_REACHED', 'ALL_LOCALES_COMPLETE', 'ALL_LISTED_PAGES_READ', 'FULL_XML_DOCUMENT',
  'ANNOUNCED_TOTAL_REACHED', 'ANNOUNCED_PAGE_COUNT_REACHED', 'DECLARED_TOTAL_REACHED', 'PUBLISHER_COUNT_REACHED',
  'PUBLISHER_TOTAL_ROWS_READ', 'SHORT_PAGE',
]);

const p = new PrismaClient({ log: [] });
try {
  const cutoff = new Date(Date.now() - staleHours * 3_600_000);

  /** Le dernier run de chaque source demandée, et la terminaison qu'il a réellement produite. */
  const runs: any[] = await p.$queryRaw(Prisma.sql`
    WITH last_run AS (
      SELECT DISTINCT ON ("sourceKey") * FROM "SourceRun"
      WHERE "sourceKey" = ANY(${requested}) ORDER BY "sourceKey", "ranAt" DESC, id DESC
    ), last_enum AS (
      SELECT DISTINCT ON ("sourceKey") "sourceKey",
             payload->'enumeration'->>'termination' AS termination,
             payload->'enumeration'->'blockers' AS blockers, at
      FROM "PipelineEvent" WHERE event = 'source.enumeration_observed' AND "sourceKey" = ANY(${requested})
      ORDER BY "sourceKey", at DESC
    )
    SELECT r."sourceKey", r.status, r.fetched, r."declaredTotal", r.complete, r."canAttestAbsence",
           r.truncated, r.errors, r."ranAt", e.termination, e.blockers, e.at AS "enumAt"
    FROM last_run r LEFT JOIN last_enum e ON e."sourceKey" = r."sourceKey" ORDER BY r."sourceKey"`);

  /** La recevabilité, dérivée des FAITS du dernier run — jamais du statut du catalogue. */
  const eligibility = requested.map((key) => {
    const r = runs.find((x) => x.sourceKey === key);
    const reasons: string[] = [];
    if (!r) reasons.push('aucun run enregistré');
    else {
      if ((r.errors ?? 0) > 0) reasons.push(`errors = ${r.errors}`);
      if (r.truncated) reasons.push('truncated = true');
      if (r.complete !== true) reasons.push(`complete = ${r.complete}`);
      if (r.canAttestAbsence !== true) reasons.push(`canAttestAbsence = ${r.canAttestAbsence}`);
      if (!r.termination) reasons.push('aucune terminaison d\'énumération archivée');
      else if (!PROVING_TERMINATIONS.has(r.termination)) reasons.push(`terminaison non probante : ${r.termination}`);
      if (Array.isArray(r.blockers) && r.blockers.length) reasons.push(`motifs bloquants : ${r.blockers.join(',')}`);
      if (r.ranAt < cutoff) reasons.push(`dernier run antérieur à la fenêtre (${staleHours} h)`);
    }
    return {
      source: key, eligible: reasons.length === 0, reasons,
      run: r ? { status: r.status, fetched: r.fetched, declaredTotal: r.declaredTotal, complete: r.complete,
                 canAttestAbsence: r.canAttestAbsence, truncated: r.truncated, errors: r.errors,
                 ranAt: r.ranAt, termination: r.termination } : null,
    };
  });
  const eligible = eligibility.filter((e) => e.eligible).map((e) => e.source);

  /**
   * Les représentations que le refresh DÉSACTIVERAIT : actives, appartenant à une source recevable, et non
   * revues depuis la fenêtre. C'est exactement le critère de `runRefresh`, restreint à l'allowlist.
   */
  const stale: any[] = eligible.length ? await p.$queryRaw(Prisma.sql`
    SELECT js."sourceKey", js."externalId", js."jobId", js."lastSeenAt", js.id AS "jobSourceId",
           j."isActive" AS "jobActive", j.title, j."closedAt", j."withdrawnAt", j."reopenedCount",
           (SELECT count(*)::int FROM "JobSource" o
            WHERE o."jobId" = js."jobId" AND o."isActive" AND o.id <> js.id) AS "otherActive",
           (SELECT count(*)::int FROM "JobSource" o
            WHERE o."jobId" = js."jobId" AND o."isActive" AND o.id <> js.id AND o."lastSeenAt" >= ${cutoff}) AS "otherFresh",
           (SELECT array_agg(DISTINCT o."sourceKey") FROM "JobSource" o
            WHERE o."jobId" = js."jobId" AND o."isActive" AND o.id <> js.id) AS "otherSources"
    FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
    WHERE js."isActive" AND j."isActive" AND js."sourceKey" = ANY(${eligible}) AND js."lastSeenAt" < ${cutoff}
    ORDER BY js."sourceKey", js."externalId"`) : [];

  /**
   * La conséquence proposée, offre par offre. Une absence ne vaut preuve que pour une source PROUVÉE et
   * autorisée : ici, toutes le sont par construction (`eligible`).
   */
  const rows = stale.map((s) => {
    const keptByOther = s.otherFresh > 0;
    return {
      sourceKey: s.sourceKey, externalId: s.externalId, jobId: s.jobId, title: s.title,
      lastSeenAt: s.lastSeenAt, otherActiveRepresentations: s.otherActive,
      otherFreshRepresentations: s.otherFresh, otherSources: s.otherSources ?? [],
      presentInLastCollectedSet: false,  // par construction : lastSeenAt < cutoff = non revue par le dernier run
      consequence: keptByOther ? 'JOB_CONSERVE_PAR_UNE_AUTRE_SOURCE' : 'JOB_CANDIDAT_A_FERMETURE',
      reason: keptByOther
        ? `représentation désactivée (non revue depuis ${s.lastSeenAt.toISOString()}), mais l'offre reste attestée par ${(s.otherSources ?? []).join(', ')}`
        : `non revue depuis ${s.lastSeenAt.toISOString()} par une source dont l'énumération est PROUVÉE, et aucune autre attestation active fraîche`,
    };
  });

  /** Ce qui serait RÉOUVERT : une offre inactive qu'une source recevable atteste à nouveau. */
  const reopen: any[] = eligible.length ? await p.$queryRaw(Prisma.sql`
    SELECT j.id AS "jobId", j."closedAt", j."withdrawnAt", j."reopenedCount",
           array_agg(DISTINCT js."sourceKey") AS sources
    FROM "Job" j JOIN "JobSource" js ON js."jobId" = j.id
    WHERE NOT j."isActive" AND js."isActive" AND js."sourceKey" = ANY(${eligible}) AND js."lastSeenAt" >= ${cutoff}
    GROUP BY 1, 2, 3, 4 ORDER BY 1`) : [];

  /** Les situations INVÉRIFIABLES : représentations périmées d'une source NON recevable — aucune mutation. */
  const untouchable: any[] = await p.$queryRaw(Prisma.sql`
    SELECT js."sourceKey", count(*)::int AS "staleRepresentations"
    FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
    WHERE js."isActive" AND j."isActive" AND js."lastSeenAt" < ${cutoff}
      AND NOT (js."sourceKey" = ANY(${eligible.length ? eligible : ['__none__']}))
    GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);

  /** Les retenues, pour vérifier après coup qu'aucune n'a disparu. */
  const holds: any[] = await p.$queryRaw(Prisma.sql`
    SELECT o."sourceKey", count(*)::int AS held FROM "SourceObservation" o
    WHERE o.raw ? 'publicationHold' AND o."sourceKey" = ANY(${requested}) GROUP BY 1 ORDER BY 1`);

  const perimeter: any[] = eligible.length ? await p.$queryRaw(Prisma.sql`
    SELECT count(DISTINCT j.id)::int AS live FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
    WHERE js."isActive" AND j."isActive" AND js."sourceKey" = ANY(${eligible})`) : [{ live: 0 }];

  const closures = rows.filter((r) => r.consequence === 'JOB_CANDIDAT_A_FERMETURE');
  const kept = rows.filter((r) => r.consequence === 'JOB_CONSERVE_PAR_UNE_AUTRE_SOURCE');
  const live = perimeter[0].live;

  const preview = {
    at: new Date().toISOString(), staleHours, requested, eligible,
    eligibility,
    perimeterLiveJobs: live,
    representationsToDeactivate: rows,
    jobsKeptByAnotherSource: kept.map((r) => r.jobId),
    jobsCandidateForClosure: [...new Set(closures.map((r) => r.jobId))],
    administrativeWithdrawals: [] as string[],   // aucune : un retrait vient d'une observation, pas du refresh
    reopenings: reopen,
    unverifiableUntouched: untouchable,
    holdsBefore: Object.fromEntries(holds.map((h: any) => [h.sourceKey, h.held])),
    guards: {
      closureRatioPct: live ? Number((([...new Set(closures.map((r) => r.jobId))].length / live) * 100).toFixed(2)) : 0,
      closureRatioWithinFivePercent: !live || ([...new Set(closures.map((r) => r.jobId))].length / live) <= 0.05,
      ineligibleRequested: eligibility.filter((e) => !e.eligible).map((e) => ({ source: e.source, reasons: e.reasons })),
      unexplainedClosures: closures.filter((r) => !r.reason).length,
    },
  };

  const out = arg('out');
  if (out) writeFileSync(out, JSON.stringify(preview, null, 2));

  console.log('RECEVABILITÉ (dérivée des derniers SourceRun, jamais du statut ACTIVE) :');
  for (const e of eligibility) {
    console.log(`  ${e.eligible ? '✓' : '✗'} ${e.source.padEnd(26)} ${e.eligible ? '' : e.reasons.join(' · ')}`);
  }
  console.log(`\npérimètre recevable : ${eligible.length} source(s), ${live} offres actives`);
  console.log(`représentations à désactiver : ${rows.length}`);
  console.log(`  · offres conservées par une autre source : ${kept.length}`);
  console.log(`  · offres candidates à fermeture          : ${preview.jobsCandidateForClosure.length} (${preview.guards.closureRatioPct} %)`);
  console.log(`réouvertures : ${reopen.length} · invérifiables laissées intactes : ${untouchable.reduce((a: number, u: any) => a + u.staleRepresentations, 0)}`);
  console.log(`garde 5 % : ${preview.guards.closureRatioWithinFivePercent ? 'respectée' : 'DÉPASSÉE'}`);
} finally {
  await p.$disconnect();
}
