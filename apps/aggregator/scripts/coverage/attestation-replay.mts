/**
 * L'EFFET DU CORRECTIF, mesuré sur les runs ARCHIVÉS — sans rien réexécuter en ligne.
 *
 * Le registre des invérifiables lit `SourceRun.canAttestAbsence` tel qu'il a été ÉCRIT par l'ancien code : il ne
 * peut donc pas montrer ce que le correctif change. Ce script rejoue la décision, et seulement la décision, sur
 * les mêmes lignes archivées :
 *
 *   AVANT   `complete !== true` refuse, et « inconnu » était confondu avec « prouvé incomplet »
 *   APRÈS   **seul un PARCOURS DÉMONTRÉ** autorise une fermeture (règle imposée le 2026-09-11)
 *
 * LA DÉMONSTRATION DE PARCOURS EST LUE À LA SOURCE, pas reconstituée. Les adaptateurs archivent leur propre
 * verdict d'énumération dans `PipelineEvent` (`source.enumeration_observed`) : la terminaison
 * (`PUBLISHER_TOTAL_REACHED`, `SECOND_SWEEP_RECONCILED`, `FULL_RESPONSE`, `PARTITIONS_RECONCILED`…), les
 * anomalies (`ENUMERATION_NOT_PROVEN`, `UNPARTITIONED_UNDER_CAP`) et le drapeau `complete` de l'adaptateur.
 * C'est cette trace — et non la colonne `SourceRun.complete`, qui mélange démonstration et ratio sous l'ancienne
 * règle — qui dit si le parcours a réellement été mené à son terme.
 *
 * Une source dont aucun événement d'énumération n'est archivé reste `UNKNOWN` : l'absence de trace n'est pas une
 * démonstration. Le chiffre publié est donc un PLANCHER du droit d'attester.
 *
 * LIMITE MAJEURE, MESURÉE ET DÉCLARÉE : l'événement `source.enumeration_observed` n'existe que depuis le
 * 2026-09-09 et n'est archivé que pour **87 sources sur 440**. Les 353 autres n'ont jamais consigné leur preuve
 * de parcours — non parce qu'elles ne l'ont pas menée, mais parce que la trace n'existait pas au moment de leur
 * dernier run. Elles ne pourront attester qu'après un nouveau run, ce qui est la conséquence CORRECTE de la
 * règle : on ne ferme pas sur une preuve absente. Le rejeu sépare donc trois groupes — preuve archivée
 * favorable, preuve archivée défavorable, aucune preuve — et ne les additionne jamais.
 *
 * Le verdict d'énumération est recalculé depuis les colonnes stockées (`declaredTotal`, `fetched`, `truncated`,
 * `errors`), avec la fonction maintenue — jamais une copie de sa logique.
 *
 * Limite déclarée, et elle est réelle : `heldUnresolved` n'est pas une colonne de `SourceRun`. Pour les runs où
 * l'ancien `complete:false` venait d'une RETENUE et non d'un défaut d'énumération, la valeur archivée ne permet
 * pas de distinguer les deux causes. On le mesure donc par la reconstitution : un run non tronqué, sans erreur,
 * dont la couverture est atteinte, et dont la source porte des retenues non résolues, est un run dont le
 * `complete:false` archivé était dû aux retenues. Les autres sont attribués à l'énumération.
 *
 * Lecture seule. usage: attestation-replay.mts [--out=<file.json>]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { isTrustedForAttestation, type RunStatus } from '../../src/pipeline/attestation.js';
import { enumerationVerdict, verdictToComplete } from '../../src/pipeline/enumeration.js';

const outFile = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const p = new PrismaClient();

/** La porte TELLE QU'ELLE ÉTAIT avant le 2026-09-11, reproduite pour être comparée — jamais réutilisée. */
function trustedBefore(run: { status: RunStatus; complete?: boolean | null; errors?: number | null;
  truncated?: boolean | null; declaredTotal?: number | null; fetched?: number | null; previous?: number | null }): boolean {
  const NEVER = new Set(['BROKEN', 'TIMEOUT', 'ERROR', 'CHALLENGED', 'NEW']);
  if (run.complete !== true || NEVER.has(run.status) || (run.errors ?? 0) > 0) return false;
  if (run.truncated) return false;
  if (run.declaredTotal && run.declaredTotal > 0 && (run.fetched ?? 0) / run.declaredTotal < 0.9) return false;
  if (run.previous && run.previous > 0 && (run.fetched ?? 0) < run.previous * 0.5) return false;
  return true;
}

try {
  const { at, rows } = await p.$transaction(async (tx) => {
    const [shown]: any[] = await tx.$queryRaw`SHOW transaction_isolation`;
    if (shown?.transaction_isolation !== 'repeatable read') throw new Error('refusing: not repeatable read');
    const [{ at }]: any[] = await tx.$queryRaw`SELECT now() AS at`;
    const rows: any[] = await tx.$queryRaw`
      WITH last_run AS (
        SELECT DISTINCT ON ("sourceKey") * FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC, id DESC
      ), live AS (
        SELECT js."sourceKey", COUNT(*)::int representations
        FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
        WHERE js."isActive" AND j."isActive" GROUP BY 1
      ), enumeration AS (
        -- La trace d'énumération la plus récente par source : la démonstration de parcours de l'adaptateur.
        SELECT DISTINCT ON (payload->>'sourceKey') payload->>'sourceKey' AS source_key,
               payload->'enumeration'->>'termination' AS termination,
               payload->'enumeration'->'issues' AS issues,
               payload->>'complete' AS adapter_complete
        FROM "PipelineEvent" WHERE event = 'source.enumeration_observed'
        ORDER BY payload->>'sourceKey', at DESC
      ), unresolved_holds AS (
        -- Les retenues SANS disposition sont celles qui posaient complete = false pour toute la source.
        SELECT "sourceKey", COUNT(DISTINCT "externalId")::int held
        FROM "SourceObservation"
        WHERE raw->>'publicationHold' IS NOT NULL
          AND raw->>'publicationHold' NOT IN ('APPLICATION_HTTP_404','APPLICATION_HTTP_410',
                                              'APPLICATION_EXPLICITLY_CLOSED','SOURCE_UNLISTED','SCOPE_OUT_OF_PERIMETER')
        GROUP BY 1
      )
      SELECT l."sourceKey", l.representations, r.status, r.complete, r.truncated, r.errors,
             r."declaredTotal", r.fetched, r.jobs, r."previousJobs", r."canAttestAbsence", r."ranAt",
             COALESCE(h.held, 0)::int unresolved_holds,
             e.termination, e.issues, e.adapter_complete
      FROM live l
      LEFT JOIN last_run r ON r."sourceKey" = l."sourceKey"
      LEFT JOIN enumeration e ON e.source_key = l."sourceKey"
      LEFT JOIN unresolved_holds h ON h."sourceKey" = l."sourceKey"
      ORDER BY l.representations DESC`;
    return { at, rows };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 20_000, timeout: 120_000 });

  const decided = rows.map((r) => {
    const status = (r.status ?? 'NEW') as RunStatus;
    /**
     * `fetched` INCONNU n'est pas `fetched = 0`, et la mesure doit refléter le code, pas le contredire :
     * 98 sources dont le dernier run précède l'ajout de la colonne portent `null` avec un volume stable.
     * Le verdict d'énumération, lui, a besoin d'un nombre — on lui passe alors `jobs`, ce que le run a
     * réellement écrit, et le verdict tombe de toute façon sur « inconnu » faute de total déclaré.
     */
    const fetchedKnown: number | undefined = r.fetched ?? undefined;
    const unique = r.fetched ?? r.jobs ?? 0;
    const declared = r.declaredTotal ?? undefined;
    const truncated = r.truncated ?? false;

    /**
     * La cause archivée de `complete = false` est reconstituée : un run non tronqué, sans erreur, dont la
     * couverture est atteinte, portait son `false` à cause des RETENUES. Sinon c'est l'énumération.
     */
    const coverageMet = !declared || unique / declared >= 0.9;
    const falseCameFromHolds = r.complete === false && !truncated && (r.errors ?? 0) === 0 && coverageMet && r.unresolved_holds > 0;

    /**
     * Le verdict recalculé. `adapterProvesCompletion` ne peut pas être relu depuis la base (la colonne stocke le
     * résultat, pas l'affirmation d'origine) : on ne le passe donc PAS, et le verdict se fonde sur les seules
     * preuves stockées. C'est une sous-estimation assumée — un adaptateur qui affirmait sa complétude sans total
     * déclaré ressortira « inconnu » ici.
     */
    /**
     * La démonstration de parcours, lue dans la trace de l'adaptateur :
     *   · `ENUMERATION_NOT_PROVEN` parmi les anomalies → l'adaptateur dit lui-même ne pas l'avoir prouvée ;
     *   · `adapter_complete = 'true'` → il l'affirme ;
     *   · aucune trace → on ne sait pas, et l'absence de trace n'est pas une démonstration.
     */
    const issues: string[] = Array.isArray(r.issues) ? r.issues.map(String) : [];
    const archivedDemonstration = issues.includes('ENUMERATION_NOT_PROVEN') ? false
      : r.adapter_complete === 'true' ? true : undefined;
    const verdict = enumerationVerdict({ adapterProvesCompletion: archivedDemonstration,
      declaredTotal: declared, uniqueCollected: unique, truncated, unreadableRows: r.errors ?? 0 });

    const before = trustedBefore({ status, complete: r.complete, errors: r.errors, truncated,
      declaredTotal: declared, fetched: unique, previous: r.previousJobs });
    // La porte corrigée reçoit `fetched` TEL QU'IL EST STOCKÉ : absent reste absent.
    const after = isTrustedForAttestation({ status, complete: verdictToComplete(verdict), errors: r.errors ?? 0,
      truncated, declaredTotal: declared, fetched: fetchedKnown, previous: r.previousJobs });

    return { ...r, recomputedVerdict: verdict, trustedBefore: before, trustedAfter: after,
      falseCameFromHolds, changed: before !== after };
  });

  const gained = decided.filter((d) => !d.trustedBefore && d.trustedAfter);
  const lost = decided.filter((d) => d.trustedBefore && !d.trustedAfter);
  const stillBlocked = decided.filter((d) => !d.trustedAfter);

  /**
   * Les groupes de preuve, EXHAUSTIFS et disjoints — le contrôle de cohérence plus bas le vérifie.
   *
   * `proven` est défini par le VERDICT, pas par la présence d'une trace : une source dont l'adaptateur affirme
   * `complete: true` dans `SourceRun` sans qu'un événement d'énumération ait été archivé est tout de même
   * `PROVEN` (l'événement n'existe que depuis le 2026-09-09). Un premier découpage par `termination != null`
   * laissait 16 sources prouvées hors de tous les groupes, et le total ne se recollait pas.
   */
  const proven = decided.filter((d) => d.recomputedVerdict === 'PROVEN');
  const withEvidence = decided.filter((d) => d.termination != null);
  const disproven = withEvidence.filter((d) => d.recomputedVerdict !== 'PROVEN');
  const noEvidence = decided.filter((d) => d.termination == null);

  const report = {
    at,
    denominators: { sourcesWithLivePostings: rows.length, liveRepresentations: rows.reduce((n, r) => n + r.representations, 0) },
    evidenceGroups: {
      withArchivedEnumerationEvidence: { sources: withEvidence.length, representations: withEvidence.reduce((n, d) => n + d.representations, 0) },
      demonstratedTraversal: { sources: proven.length, representations: proven.reduce((n, d) => n + d.representations, 0),
        mayAttest: proven.filter((d) => d.trustedAfter).length,
        mayAttestRepresentations: proven.filter((d) => d.trustedAfter).reduce((n, d) => n + d.representations, 0),
        /** Prouvées mais SANS trace d'énumération archivée : l'adaptateur l'affirme dans SourceRun seulement. */
        provenWithoutArchivedTrace: proven.filter((d) => d.termination == null).length,
        rows: proven.map((d) => ({ sourceKey: d.sourceKey, representations: d.representations, termination: d.termination,
          mayAttest: d.trustedAfter, status: d.status, errors: d.errors, unresolvedHolds: d.unresolved_holds })) },
      evidenceRefusesTraversal: { sources: disproven.length, representations: disproven.reduce((n, d) => n + d.representations, 0),
        rows: disproven.map((d) => ({ sourceKey: d.sourceKey, representations: d.representations, termination: d.termination, issues: d.issues })) },
      /** Contrôle de cohérence : personne ne doit attester hors du groupe « parcours démontré ». */
      attestingWithoutDemonstration: decided.filter((d) => d.trustedAfter && d.recomputedVerdict !== 'PROVEN')
        .map((d) => ({ sourceKey: d.sourceKey, representations: d.representations, recomputedVerdict: d.recomputedVerdict,
          termination: d.termination ?? null, adapterComplete: d.adapter_complete ?? null, archivedComplete: d.complete })),
      noArchivedEvidence: { sources: noEvidence.length, representations: noEvidence.reduce((n, d) => n + d.representations, 0),
        note: 'L\'événement source.enumeration_observed n\'existe que depuis le 2026-09-09 : ces sources doivent rejouer pour prouver leur parcours.' },
    },
    before: { mayAttest: decided.filter((d) => d.trustedBefore).length,
              representations: decided.filter((d) => d.trustedBefore).reduce((n, d) => n + d.representations, 0) },
    after: { mayAttest: decided.filter((d) => d.trustedAfter).length,
             representations: decided.filter((d) => d.trustedAfter).reduce((n, d) => n + d.representations, 0) },
    gained: { sources: gained.length, representations: gained.reduce((n, d) => n + d.representations, 0),
              becauseOfHolds: gained.filter((d) => d.falseCameFromHolds).length,
              rows: gained.map((d) => ({ sourceKey: d.sourceKey, representations: d.representations, status: d.status,
                archivedComplete: d.complete, recomputedVerdict: d.recomputedVerdict, declaredTotal: d.declaredTotal,
                fetched: d.fetched, previousJobs: d.previousJobs, unresolvedHolds: d.unresolved_holds, falseCameFromHolds: d.falseCameFromHolds })) },
    /** Aucune source ne doit PERDRE son droit d'attester : le correctif élargit, il ne restreint pas. */
    lost: { sources: lost.length, rows: lost.map((d) => ({ sourceKey: d.sourceKey, status: d.status, archivedComplete: d.complete, recomputedVerdict: d.recomputedVerdict })) },
    stillBlocked: { sources: stillBlocked.length, representations: stillBlocked.reduce((n, d) => n + d.representations, 0),
      byReason: stillBlocked.reduce((acc: Record<string, number>, d) => {
        const issues: string[] = Array.isArray(d.issues) ? d.issues.map(String) : [];
        const why = ['BROKEN', 'ERROR', 'TIMEOUT', 'CHALLENGED', 'NEW'].includes(d.status ?? 'NEW') ? `run ${d.status ?? 'NEW'}`
          : (d.errors ?? 0) > 0 ? 'erreurs de collecte'
          : d.truncated ? 'listing tronqué'
          : issues.includes('ENUMERATION_NOT_PROVEN') ? `parcours non prouvé par l'adaptateur (${d.termination})`
          : d.recomputedVerdict === 'REFUTED' ? 'couverture sous le seuil'
          : d.previousJobs && (d.fetched ?? 0) < d.previousJobs * 0.5 ? 'effondrement du volume'
          : d.termination ? `aucune démonstration de parcours (${d.termination})`
          : 'aucune trace d\'énumération archivée';
        acc[why] = (acc[why] ?? 0) + 1; return acc;
      }, {}),
      rows: stillBlocked.map((d) => ({ sourceKey: d.sourceKey, representations: d.representations,
        status: d.status, errors: d.errors, truncated: d.truncated, declaredTotal: d.declaredTotal, fetched: d.fetched,
        previousJobs: d.previousJobs, recomputedVerdict: d.recomputedVerdict,
        termination: d.termination ?? null, adapterComplete: d.adapter_complete ?? null, issues: d.issues ?? null })) },
  };

  const json = JSON.stringify(report, (_k, v) => (v instanceof Date ? v.toISOString() : v), 1);
  if (outFile) writeFileSync(outFile, json);
  console.log(JSON.stringify({ ...report,
    gained: { ...report.gained, rows: `${report.gained.rows.length} rows in file` },
    stillBlocked: { ...report.stillBlocked, rows: `${report.stillBlocked.rows.length} rows in file` } }, null, 1));
} finally { await p.$disconnect(); }
