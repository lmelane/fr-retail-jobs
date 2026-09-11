/**
 * L'EFFET DU CORRECTIF, mesuré sur les runs ARCHIVÉS — sans rien réexécuter en ligne.
 *
 * Le registre des invérifiables lit `SourceRun.canAttestAbsence` tel qu'il a été ÉCRIT par l'ancien code : il ne
 * peut donc pas montrer ce que le correctif change. Ce script rejoue la décision, et seulement la décision, sur
 * les mêmes lignes archivées :
 *
 *   AVANT   `complete !== true` refuse            → « inconnu » traité comme « prouvé incomplet »
 *   APRÈS   `complete === false` refuse           → « inconnu » arbitré par couverture et effondrement
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
             COALESCE(h.held, 0)::int unresolved_holds
      FROM live l
      LEFT JOIN last_run r ON r."sourceKey" = l."sourceKey"
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
    const verdict = enumerationVerdict({ declaredTotal: declared, uniqueCollected: unique, truncated, unreadableRows: r.errors ?? 0 });

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

  const report = {
    at,
    denominators: { sourcesWithLivePostings: rows.length, liveRepresentations: rows.reduce((n, r) => n + r.representations, 0) },
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
        const why = ['BROKEN', 'ERROR', 'TIMEOUT', 'CHALLENGED', 'NEW'].includes(d.status ?? 'NEW') ? `run ${d.status ?? 'NEW'}`
          : (d.errors ?? 0) > 0 ? 'erreurs de collecte'
          : d.truncated ? 'listing tronqué'
          : d.recomputedVerdict === 'REFUTED' ? 'couverture sous le seuil'
          : d.previousJobs && (d.fetched ?? 0) < d.previousJobs * 0.5 ? 'effondrement du volume'
          : 'énumération inconnue sans référence';
        acc[why] = (acc[why] ?? 0) + 1; return acc;
      }, {}),
      rows: stillBlocked.slice(0, 40).map((d) => ({ sourceKey: d.sourceKey, representations: d.representations,
        status: d.status, errors: d.errors, truncated: d.truncated, declaredTotal: d.declaredTotal, fetched: d.fetched,
        previousJobs: d.previousJobs, recomputedVerdict: d.recomputedVerdict })) },
  };

  const json = JSON.stringify(report, (_k, v) => (v instanceof Date ? v.toISOString() : v), 1);
  if (outFile) writeFileSync(outFile, json);
  console.log(JSON.stringify({ ...report,
    gained: { ...report.gained, rows: `${report.gained.rows.length} rows in file` },
    stillBlocked: { ...report.stillBlocked, rows: `${report.stillBlocked.rows.length} rows in file` } }, null, 1));
} finally { await p.$disconnect(); }
