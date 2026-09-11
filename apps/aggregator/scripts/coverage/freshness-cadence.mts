/**
 * À QUELLE VITESSE LES PORTAILS BOUGENT-ILS RÉELLEMENT ? — mesuré, pas choisi.
 *
 * Un délai de péremption unique pour 440 sources est un choix arbitraire. Ce script mesure, par FAMILLE ATS et
 * par source, le rythme réel observé dans les archives, pour que les cadences retenues soient déduites de ces
 * mesures et que leurs dénominateurs soient explicites.
 *
 * Ce qu'on mesure, et pourquoi :
 *
 *   - le TAUX DE RENOUVELLEMENT par run : combien d'offres apparaissent et disparaissent entre deux runs d'une
 *     même source. C'est lui qui dit à quelle fréquence il faut regarder ;
 *   - la DURÉE DE VIE observée des offres fermées (`closedAt − firstSeenAt`), par famille : une famille dont les
 *     offres vivent 60 jours n'a pas besoin du même rythme qu'une famille à 7 jours ;
 *   - l'INTERVALLE entre runs réellement pratiqué, pour rapporter le reste à quelque chose de réel ;
 *   - la part des runs qui ont le DROIT D'ATTESTER, par famille : une famille qui ne prouve jamais son
 *     énumération ne peut pas se voir imposer un délai de fermeture court.
 *
 * Lecture seule. usage: freshness-cadence.mts [--out=<file.json>]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const outFile = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const p = new PrismaClient();

try {
  const report = await p.$transaction(async (tx) => {
    const [shown]: any[] = await tx.$queryRaw`SHOW transaction_isolation`;
    if (shown?.transaction_isolation !== 'repeatable read') throw new Error('refusing: not repeatable read');
    const [{ at }]: any[] = await tx.$queryRaw`SELECT now() AS at`;

    /**
     * La DURÉE DE VIE observée, par famille ATS. On ne lit que les offres FERMÉES (`closedAt`), donc celles dont
     * un run fiable a constaté la disparition : une offre encore active n'a pas de durée de vie, seulement un
     * âge. Les retraits administratifs sont exclus — ils ne disent rien du rythme de l'employeur.
     *
     * La famille se lit par `JobSource`, PAS par `Job.canonicalSourceKey`. Mesuré : sur 2 604 offres fermées
     * exploitables, **2 600 portent un `canonicalSourceKey` nul** — le rang canonique n'a d'autorité que porté
     * par une source attachée, et il n'est pas renseigné quand plus aucune ne l'est. La représentation, elle,
     * survit à la fermeture (2 770 sur 2 772), et c'est elle qui dit de quel portail l'offre venait.
     * Une offre attestée par plusieurs sources compte dans chacune : le dénominateur est par famille, pas global.
     */
    const lifespan: any[] = await tx.$queryRaw`
      SELECT s.kind, COUNT(DISTINCT j.id)::int closed_postings,
             ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (j."closedAt" - j."firstSeenAt")) / 86400))::int median_days,
             ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (j."closedAt" - j."firstSeenAt")) / 86400))::int p90_days
      FROM "Job" j
      JOIN "JobSource" js ON js."jobId" = j.id
      JOIN "Source" s ON s.key = js."sourceKey"
      WHERE j."closedAt" IS NOT NULL AND j."firstSeenAt" < j."closedAt"
      GROUP BY 1 HAVING COUNT(DISTINCT j.id) >= 30 ORDER BY 2 DESC`;

    /**
     * Le rang canonique orphelin, compté à part : ce n'est pas une mesure de fraîcheur mais un défaut qui
     * FAUSSE toute mesure de fraîcheur par famille, et il touche aussi des offres ACTIVES.
     */
    const [orphanCanonical]: any[] = await tx.$queryRaw`
      SELECT COUNT(*)::int total,
             COUNT(*) FILTER (WHERE "isActive")::int active_without_canonical_key,
             COUNT(*) FILTER (WHERE NOT "isActive")::int inactive_without_canonical_key
      FROM "Job" WHERE "canonicalSourceKey" IS NULL`;

    /**
     * Le RENOUVELLEMENT par run : l'écart de volume entre deux runs consécutifs d'une même source, rapporté au
     * volume. Ce n'est pas le churn réel (une offre entrante et une sortante s'annulent) mais c'est le signal le
     * plus honnête disponible sans historique par offre, et on le dit.
     */
    const turnover: any[] = await tx.$queryRaw`
      WITH pairs AS (
        SELECT r."sourceKey", r.jobs, r."previousJobs", r."ranAt",
               LAG(r."ranAt") OVER (PARTITION BY r."sourceKey" ORDER BY r."ranAt") AS prev_ran
        FROM "SourceRun" r WHERE r.jobs > 0 AND r."previousJobs" > 0
      )
      SELECT s.kind, COUNT(*)::int run_pairs, COUNT(DISTINCT p."sourceKey")::int sources,
             ROUND(AVG(ABS(p.jobs - p."previousJobs")::numeric / NULLIF(p."previousJobs", 0)) * 100, 2) AS avg_volume_delta_pct,
             ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (p."ranAt" - p.prev_ran)) / 3600))::int median_interval_hours
      FROM pairs p JOIN "Source" s ON s.key = p."sourceKey"
      WHERE p.prev_ran IS NOT NULL
      GROUP BY 1 HAVING COUNT(*) >= 20 ORDER BY 4 DESC`;

    /** Le droit d'attester, par famille : peut-on seulement se permettre de fermer sur ces portails ? */
    const attestability: any[] = await tx.$queryRaw`
      WITH last_run AS (SELECT DISTINCT ON ("sourceKey") * FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC, id DESC)
      SELECT s.kind, COUNT(*)::int sources,
             COUNT(*) FILTER (WHERE r."declaredTotal" IS NOT NULL)::int declares_a_total,
             COUNT(*) FILTER (WHERE r.truncated)::int truncated,
             COUNT(*) FILTER (WHERE r."canAttestAbsence")::int may_attest_archived
      FROM "Source" s LEFT JOIN last_run r ON r."sourceKey" = s.key
      WHERE s.status IN ('ACTIVE', 'PAUSED') GROUP BY 1 ORDER BY 2 DESC`;

    /** La capacité à vérifier le DÉTAIL, par famille : une famille sans détail lisible ne peut pas être datée. */
    const detail: any[] = await tx.$queryRaw`
      WITH last_run AS (SELECT DISTINCT ON ("sourceKey") * FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC, id DESC)
      SELECT s.kind, COUNT(*)::int sources,
             ROUND(AVG(r."descriptionRate")::numeric, 3) AS avg_description_rate,
             ROUND(AVG(r."dateRate")::numeric, 3) AS avg_date_rate
      FROM "Source" s LEFT JOIN last_run r ON r."sourceKey" = s.key
      WHERE s.status IN ('ACTIVE', 'PAUSED') AND r."descriptionRate" IS NOT NULL
      GROUP BY 1 HAVING COUNT(*) >= 3 ORDER BY 3 ASC`;

    /** L'ancienneté des offres encore actives, par famille : celles que la fenêtre de fermeture concerne. */
    const activeAge: any[] = await tx.$queryRaw`
      SELECT s.kind, COUNT(DISTINCT j.id)::int active_postings,
             ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (now() - j."firstSeenAt")) / 86400))::int median_age_days,
             ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (now() - j."firstSeenAt")) / 86400))::int p90_age_days
      FROM "Job" j JOIN "JobSource" js ON js."jobId" = j.id AND js."isActive"
      JOIN "Source" s ON s.key = js."sourceKey"
      WHERE j."isActive" GROUP BY 1 HAVING COUNT(*) >= 100 ORDER BY 2 DESC`;

    return { at, lifespan, orphanCanonical, turnover, attestability, detail, activeAge };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 20_000, timeout: 180_000 });

  const json = JSON.stringify(report, (_k, v) => (v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v), 1);
  if (outFile) writeFileSync(outFile, json);
  console.log(json);
} finally { await p.$disconnect(); }
