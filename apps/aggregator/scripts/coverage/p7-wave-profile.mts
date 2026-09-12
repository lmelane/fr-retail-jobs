/**
 * P7 PHASE 0 — le profil MESURÉ de la vague initiale.
 *
 * Un plan de reprise ne se rédige pas : il se dérive de ce que les runs passés ont réellement fait. Ce
 * programme lit, pour chaque source de la vague proposée, ce qui fixe les paramètres opérationnels :
 *
 *   · le VOLUME attendu — les offres publiées aujourd'hui et le dernier volume collecté ;
 *   · l'HÔTE ATS réel — extrait de la configuration, parce que la politesse se règle par hôte (D25) et que
 *     deux sources sur un même hôte ne sont pas deux sources indépendantes ;
 *   · la DURÉE observée — le dernier run et la médiane, qui fixent le budget par source et la durée du cycle ;
 *   · les ERREURS et le statut du dernier run — une source dont la dernière collecte a échoué ne va pas dans
 *     la première vague (consigne du propriétaire) ;
 *   · le DROIT DE FERMER hérité (`canAttestAbsence`) et l'exhaustivité (`complete`), qui seront RECALCULÉS ;
 *   · les RETENUES de publication en cours, qui doivent rester intactes ;
 *   · la sensibilité à la GARDE D'EFFONDREMENT — une source à très faible volume peut franchir le ratio de
 *     0,5 sur une variation d'une seule offre.
 *
 * Lecture seule, aucune écriture, aucun réseau. usage: p7-wave-profile.mts [--out=<file.json>]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const p = new PrismaClient();

/** La vague proposée par le propriétaire : neuf familles ATS, une source par famille. */
const WAVE = [
  'mecca', 'dr-pierre-ricaud', 'lagardere-travel-retail', 'urbn-hub', 'beiersdorf',
  'lindex-easycruit', 'american-vintage-dr', 'saltrock-harri', 'ganni-talentrecruiter',
];

/**
 * Une source dont le volume est si faible que la garde d'effondrement (ratio 0,5 du dernier run productif)
 * se déclenche sur une variation ordinaire. Sous ce seuil, perdre une seule offre suffit à refuser
 * l'attestation — ce n'est pas un signal de panne, c'est du bruit.
 */
const COLLAPSE_SENSITIVE_MAX = 6;

try {
  const [{ at }]: any[] = await p.$queryRaw`SELECT now() AS at`;

  const rows: any[] = await p.$queryRaw(Prisma.sql`
    WITH last_run AS (
      SELECT DISTINCT ON ("sourceKey") * FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC, id DESC
    ), run_stats AS (
      SELECT "sourceKey",
             count(*) AS runs,
             count(*) FILTER (WHERE status NOT IN ('OK','DEGRADED')) AS bad_runs,
             max(fetched) AS max_fetched,
             min(fetched) FILTER (WHERE status = 'OK') AS min_ok_fetched
      FROM "SourceRun" WHERE "ranAt" > now() - interval '30 days' GROUP BY "sourceKey"
    ), published AS (
      SELECT js."sourceKey", count(DISTINCT j.id) AS live_jobs
      FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."isActive" AND j."isActive" GROUP BY js."sourceKey"
    ), holds AS (
      /* Une retenue est une SourceObservation portant un motif de retenue : le RAW est conservé, rien n'est
         publié. Il n'existe pas de colonne « résolue » — une retenue cesse quand la source republie
         correctement l'offre, ce que l'on constate par la présence d'un JobSource actif de même externalId. */
      SELECT o."sourceKey", count(*) AS held
      FROM "SourceObservation" o
      WHERE o.raw ? 'publicationHold'
        AND NOT EXISTS (
          SELECT 1 FROM "JobSource" js
          WHERE js."sourceKey" = o."sourceKey" AND js."externalId" = o."externalId" AND js."isActive"
        )
      GROUP BY o."sourceKey"
    )
    SELECT s.key,
           s.status, s.kind, s.config, s.maison, s."careersDomain" AS careers_domain,
           coalesce(pub.live_jobs, 0)::int      AS live_jobs,
           lr.status                            AS last_status,
           lr.fetched                           AS last_fetched,
           lr.errors                            AS last_errors,
           lr."declaredTotal"                   AS declared_total,
           lr.truncated                         AS last_truncated,
           lr.complete                          AS stored_complete,
           lr."canAttestAbsence"                AS stored_can_attest,
           lr."ranAt"                           AS last_ran_at,
           lr."descriptionRate"                 AS description_rate,
           lr."countryRate"                     AS country_rate,
           rs.runs::int                         AS runs_30d,
           rs.bad_runs::int                     AS bad_runs_30d,
           rs.max_fetched                       AS max_fetched_30d,
           rs.min_ok_fetched                    AS min_ok_fetched_30d,
           coalesce(h.held, 0)::int             AS holds
    FROM "Source" s
    LEFT JOIN last_run lr  ON lr."sourceKey" = s.key
    LEFT JOIN run_stats rs ON rs."sourceKey" = s.key
    LEFT JOIN published pub ON pub."sourceKey" = s.key
    LEFT JOIN holds h      ON h."sourceKey" = s.key
    WHERE s.key = ANY(${WAVE})
    ORDER BY s.key
  `);

  /**
   * L'hôte réel appelé, lu dans la configuration — jamais deviné depuis le nom de la source.
   *
   * Les adaptateurs ne nomment pas leur cible de la même façon (`portalUrl` chez Harri et TalentRecruiter,
   * `domainName` chez DigitalRecruiters, `listingUrl` chez le générique) : on balaie donc TOUTE valeur de la
   * config qui est une URL ou un nom d'hôte, plutôt qu'une liste de champs devinée. Un champ oublié rendait
   * `null` sur 4 des 9 sources, et un plan de politesse par hôte bâti sur `null` ne protège rien.
   */
  const hostOf = (config: any, careersDomain: string | null): string | null => {
    const fromUrl = (v: unknown): string | null => {
      if (typeof v !== 'string') return null;
      if (/^https?:\/\//.test(v)) { try { return new URL(v).host; } catch { return null; } }
      // Un nom d'hôte nu (`careers.am-vintage.com`) : accepté seulement s'il en a la forme.
      return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? v : null;
    };
    for (const v of Object.values(config ?? {})) { const h = fromUrl(v); if (h) return h; }
    return fromUrl(careersDomain);
  };

  const profile = rows.map((r) => {
    const host = hostOf(r.config, r.careers_domain ?? null);
    const expected = r.last_fetched ?? r.live_jobs;
    return {
      key: r.key, status: r.status, kind: r.kind, maison: r.maison,
      host,
      livePublished: r.live_jobs,
      expectedVolume: expected,
      lastRun: {
        status: r.last_status, fetched: r.last_fetched, errors: r.last_errors,
        declaredTotal: r.declared_total, truncated: r.last_truncated,
        ranAt: r.last_ran_at, descriptionRate: r.description_rate, countryRate: r.country_rate,
      },
      storedRights: { complete: r.stored_complete, canAttestAbsence: r.stored_can_attest },
      runs30d: r.runs_30d, badRuns30d: r.bad_runs_30d,
      // L'amplitude observée du volume fixe le seuil de variation : ce que la source a réellement fait varier.
      volumeRange30d: { min: r.min_ok_fetched_30d, max: r.max_fetched_30d },
      holds: r.holds,
      /**
       * Les contre-indications de la consigne, mesurées et non supposées.
       *
       * `NEW` n'est PAS un échec : `health.ts` l'écrit quand la source n'a aucun run antérieur
       * (`before === null ? 'NEW' : 'OK'`). Il figure dans `NEVER_ATTESTS` parce qu'une première collecte n'a
       * rien à quoi se comparer — « aucun passé : rien à attester » — ce qui est une privation de DROIT, pas un
       * diagnostic de panne. Les seuls échecs réels sont BROKEN / TIMEOUT / ERROR / CHALLENGED, ou `errors > 0`.
       */
      flags: {
        lastRunFailed: (r.last_errors ?? 0) > 0
          || ['BROKEN', 'TIMEOUT', 'ERROR', 'CHALLENGED'].includes(r.last_status ?? ''),
        /** Aucun historique : la garde d'effondrement n'a pas de référence, et le droit de fermer sera refusé. */
        firstRunOnly: r.last_status === 'NEW',
        collapseSensitive: (expected ?? 0) > 0 && (expected ?? 0) <= COLLAPSE_SENSITIVE_MAX,
        hasOpenHolds: r.holds > 0,
        neverRan: r.last_status == null,
      },
    };
  });

  const missing = WAVE.filter((k) => !rows.some((r) => r.key === k));

  // Les hôtes partagés dans la vague : deux sources sur un même hôte ne se parallélisent pas librement.
  const byHost: Record<string, string[]> = {};
  for (const s of profile) if (s.host) (byHost[s.host] ??= []).push(s.key);

  const out = {
    measuredAt: at,
    wave: WAVE,
    missingFromCatalogue: missing,
    sources: profile,
    hosts: byHost,
    sharedHosts: Object.entries(byHost).filter(([, k]) => k.length > 1),
    totals: {
      sources: profile.length,
      livePublished: profile.reduce((a, s) => a + (s.livePublished ?? 0), 0),
      expectedVolume: profile.reduce((a, s) => a + (s.expectedVolume ?? 0), 0),
      distinctHosts: Object.keys(byHost).length,
      atsFamilies: new Set(profile.map((s) => s.kind)).size,
      withStoredCloseRight: profile.filter((s) => s.storedRights.canAttestAbsence === true).length,
      /** Ce qui INTERDIT la première vague — la liste du propriétaire, mesurée. */
      blocking: profile.filter((s) => s.flags.lastRunFailed || s.flags.collapseSensitive || s.flags.neverRan)
        .map((s) => ({ key: s.key, flags: Object.entries(s.flags).filter(([, v]) => v).map(([k]) => k) })),
      /** Ce qui se SIGNALE sans interdire : à porter au plan, pas à écarter. */
      noted: profile.filter((s) => s.flags.firstRunOnly || s.flags.hasOpenHolds)
        .map((s) => ({ key: s.key, flags: Object.entries(s.flags).filter(([, v]) => v).map(([k]) => k) })),
    },
  };

  const file = arg('out');
  if (file) { writeFileSync(file, JSON.stringify(out, null, 2)); console.log(`écrit → ${file}`); }
  console.log(JSON.stringify(out, null, 2));
} finally {
  await p.$disconnect();
}
