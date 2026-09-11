/**
 * LE REGISTRE DES SITUATIONS INVÉRIFIABLES, dressé depuis ce qui est déjà stocké.
 *
 * Pour chaque dossier : la source, l'identifiant externe, le motif, la date de première retenue, la date de
 * dernière tentative, la date de dernière observation fiable, l'ancienneté, l'action suivante, la condition de
 * résolution et le blocage éventuel.
 *
 * Les dates ne sont pas inventées : `firstHeldAt` est la plus ancienne observation archivée pour ce couple
 * (source, identifiant) ; `lastAttemptAt` est le `ranAt` du dernier run de la source — **une tentative, pas une
 * observation réussie** ; `lastReliableObservationAt` est le dernier run qui avait le droit d'attester, ou pour
 * une offre publiée son `lastSeenAt`. Quand une de ces dates n'existe pas, elle reste **nulle**.
 *
 * Le classement et les traitements viennent de `src/pipeline/unverifiable.ts`, testé unitairement — le script ne
 * réimplémente aucune règle.
 *
 * Lecture seule. usage: unverifiable-register.mts [--out=<file.json>] [--csv=<file.csv>]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { classifyHold, classifySourceBlock, describeUnverifiable, type UnverifiableEntry } from '../../src/pipeline/unverifiable.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const p = new PrismaClient();

try {
  const { now, holdRows, sourceRows } = await p.$transaction(async (tx) => {
    const [shown]: any[] = await tx.$queryRaw`SHOW transaction_isolation`;
    if (shown?.transaction_isolation !== 'repeatable read') throw new Error('refusing: not repeatable read');
    const [{ at }]: any[] = await tx.$queryRaw`SELECT now() AS at`;

    /**
     * Les retenues. Une même offre peut porter plusieurs observations (un contenu qui change) : on garde la plus
     * ANCIENNE comme première retenue et la plus récente comme dernière observation de la retenue elle-même.
     */
    const holdRows: any[] = await tx.$queryRaw`
      WITH last_run AS (
        SELECT DISTINCT ON ("sourceKey") "sourceKey", "ranAt", status, "canAttestAbsence"
        FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC, id DESC
      ), last_reliable AS (
        SELECT DISTINCT ON ("sourceKey") "sourceKey", "ranAt"
        FROM "SourceRun" WHERE "canAttestAbsence" ORDER BY "sourceKey", "ranAt" DESC, id DESC
      )
      SELECT o."sourceKey", o."externalId", o.raw->>'publicationHold' AS reason,
             MIN(o."observedAt") AS first_held_at, MAX(o."observedAt") AS last_hold_observation,
             r."ranAt" AS last_attempt, r.status AS last_run_status,
             lr."ranAt" AS last_reliable_run,
             js."lastSeenAt" AS representation_last_seen, js."isActive" AS representation_active
      FROM "SourceObservation" o
      LEFT JOIN last_run r ON r."sourceKey" = o."sourceKey"
      LEFT JOIN last_reliable lr ON lr."sourceKey" = o."sourceKey"
      LEFT JOIN "JobSource" js ON js."sourceKey" = o."sourceKey" AND js."externalId" = o."externalId"
      WHERE o.raw->>'publicationHold' IS NOT NULL
      GROUP BY 1, 2, 3, r."ranAt", r.status, lr."ranAt", js."lastSeenAt", js."isActive"
      ORDER BY 4`;

    /** Les sources dont le dernier run ne peut pas attester l'absence, avec leurs offres vivantes. */
    const sourceRows: any[] = await tx.$queryRaw`
      WITH last_run AS (
        SELECT DISTINCT ON ("sourceKey") * FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC, id DESC
      ), last_reliable AS (
        SELECT DISTINCT ON ("sourceKey") "sourceKey", "ranAt"
        FROM "SourceRun" WHERE "canAttestAbsence" ORDER BY "sourceKey", "ranAt" DESC, id DESC
      ), live AS (
        SELECT js."sourceKey", COUNT(*)::int representations, MAX(js."lastSeenAt") AS newest_observation
        FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
        WHERE js."isActive" AND j."isActive" GROUP BY 1
      ), first_block AS (
        -- La première fois, en remontant, que cette source a perdu son droit d'attester sans l'avoir retrouvé.
        SELECT "sourceKey", MIN("ranAt") AS since FROM "SourceRun" sr
        WHERE "canAttestAbsence" IS NOT TRUE
          AND NOT EXISTS (SELECT 1 FROM "SourceRun" later WHERE later."sourceKey" = sr."sourceKey"
                          AND later."canAttestAbsence" AND later."ranAt" > sr."ranAt")
        GROUP BY 1
      )
      SELECT l."sourceKey", l.representations, l.newest_observation,
             r.status, r.complete, r.truncated, r.errors, r."declaredTotal", r.fetched, r."previousJobs",
             r."ranAt" AS last_attempt, r."canAttestAbsence",
             lr."ranAt" AS last_reliable_run, fb.since AS blocked_since
      FROM live l
      LEFT JOIN last_run r ON r."sourceKey" = l."sourceKey"
      LEFT JOIN last_reliable lr ON lr."sourceKey" = l."sourceKey"
      LEFT JOIN first_block fb ON fb."sourceKey" = l."sourceKey"
      WHERE r."canAttestAbsence" IS NOT TRUE
      ORDER BY l.representations DESC`;

    return { now: at as Date, holdRows, sourceRows };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 20_000, timeout: 120_000 });

  const entries: UnverifiableEntry[] = [];

  for (const h of holdRows) {
    entries.push(describeUnverifiable({
      sourceKey: h.sourceKey, externalId: h.externalId, kind: classifyHold(h.reason), reason: h.reason,
      firstHeldAt: h.first_held_at,
      lastAttemptAt: h.last_attempt,
      // Une retenue signifie précisément qu'on n'a pas pu exploiter cette page : la dernière observation FIABLE
      // de l'offre est celle de sa représentation publiée, si elle en a une. Sinon il n'y en a aucune.
      lastReliableObservationAt: h.representation_active ? h.representation_last_seen : null,
      now,
      ...(h.representation_active ? {} : { blockedBy: 'Offre non publiée : aucune observation fiable à comparer.' }),
    }));
  }

  for (const s of sourceRows) {
    const kind = classifySourceBlock({
      status: s.status ?? 'NEW', complete: s.complete, truncated: s.truncated, errors: s.errors,
      declaredTotal: s.declaredTotal, fetched: s.fetched, previous: s.previousJobs,
    });
    // `null` = plus rien ne bloque cette source sous les règles corrigées. On la signale à part : c'est la
    // mesure de l'effet du correctif, pas un dossier à traiter.
    entries.push(describeUnverifiable({
      sourceKey: s.sourceKey, kind: kind ?? 'LISTING_NOT_ENUMERATED',
      reason: kind ? `${s.status ?? 'NEW'} (déclaré ${s.declaredTotal ?? 'n/d'}, lu ${s.fetched ?? 'n/d'}, précédent ${s.previousJobs ?? 'n/d'})`
                   : 'PLUS BLOQUÉE SOUS LES RÈGLES CORRIGÉES',
      firstHeldAt: s.blocked_since ?? s.last_attempt ?? now,
      lastAttemptAt: s.last_attempt,
      lastReliableObservationAt: s.last_reliable_run,
      now,
      blockedBy: kind ? undefined : 'Aucun : le verdict d\'énumération à trois valeurs lui rend son droit d\'attester.',
    }));
  }

  const byState: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const e of entries) { byState[e.state] = (byState[e.state] ?? 0) + 1; byKind[e.kind] = (byKind[e.kind] ?? 0) + 1; }

  const report = {
    at: now, denominators: { holdDossiers: holdRows.length, blockedSources: sourceRows.length, entries: entries.length },
    byState, byKind,
    stillBlockedSources: entries.filter((e) => !e.externalId && e.reason !== 'PLUS BLOQUÉE SOUS LES RÈGLES CORRIGÉES').length,
    unblockedByTheFix: entries.filter((e) => e.reason === 'PLUS BLOQUÉE SOUS LES RÈGLES CORRIGÉES').map((e) => e.sourceKey),
    entries,
  };

  const json = JSON.stringify(report, (_k, v) => (v instanceof Date ? v.toISOString() : v), 1);
  const out = arg('out');
  if (out) writeFileSync(out, json);

  const csv = arg('csv');
  if (csv) {
    const head = 'source,externalId,kind,reason,firstHeldAt,lastAttemptAt,lastReliableObservationAt,ageDays,state,nextAction,resolvedWhen,blockedBy';
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    writeFileSync(csv, [head, ...entries.map((e) => [e.sourceKey, e.externalId ?? '', e.kind, e.reason,
      e.firstHeldAt instanceof Date ? e.firstHeldAt.toISOString() : e.firstHeldAt,
      e.lastAttemptAt instanceof Date ? e.lastAttemptAt?.toISOString() : e.lastAttemptAt,
      e.lastReliableObservationAt instanceof Date ? e.lastReliableObservationAt?.toISOString() : e.lastReliableObservationAt,
      e.ageDays, e.state, e.nextAction, e.resolvedWhen, e.blockedBy ?? ''].map(cell).join(','))].join('\n'));
  }

  console.log(JSON.stringify({ ...report, entries: `${entries.length} entries`, unblockedByTheFix: `${report.unblockedByTheFix.length} sources` }, null, 1));
} finally { await p.$disconnect(); }
