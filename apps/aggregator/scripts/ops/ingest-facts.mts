/**
 * LES FAITS d'une ingestion bornée, par source — avant, après, et la différence par ENSEMBLES D'IDENTIFIANTS.
 *
 * Comparer des totaux ne prouve rien : deux runs peuvent rendre 130 offres qui ne sont pas les mêmes (leçon
 * P5). On garde donc les identifiants externes eux-mêmes, et la différence est un ensemble — ajouts et
 * disparitions nommés, jamais un delta arithmétique.
 *
 * En phase `after`, le programme relit le fichier `before` et produit directement le tableau de réception :
 * statut, fetched, total déclaré, erreurs, troncature, terminaison d'énumération, `complete`, l'ANCIEN et le
 * NOUVEAU `canAttestAbsence`, les identifiants, les créations, les verdicts `countryIntegrity`, les retenues,
 * et les offres qui SERAIENT candidates à fermeture — sans en fermer aucune.
 *
 * Lecture seule, une seule transaction. usage:
 *   ingest-facts.mts --keys=<k1,k2> --phase=before --out=<f.json>
 *   ingest-facts.mts --keys=<k1,k2> --phase=after --before=<f.json> --since=<iso> --command=<run> --out=<f.json>
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const keys = (arg('keys') ?? '').split(',').map((k) => k.trim()).filter(Boolean);
const phase = arg('phase') ?? 'before';
if (!keys.length) { console.error('usage: --keys=<k1,k2> --phase=before|after'); process.exit(2); }

/** Les codes pays qui sont AUSSI une subdivision d'un pays fédéral : les seuls à exiger une preuve. */
const AMBIGUOUS = ['CA', 'IN', 'AL', 'GA', 'KY', 'NC', 'SC', 'SD', 'NE', 'TN', 'MO', 'LA', 'MT', 'ID', 'MS',
  'PA', 'VA', 'DE', 'ME', 'AR', 'MD', 'MA', 'NV', 'CO', 'CT', 'IL', 'MN', 'NL', 'ND', 'OK', 'SK', 'PE', 'NU',
  'WA', 'NH', 'MI', 'OH', 'RI', 'VT', 'WI', 'WY', 'OR', 'NY'];

const p = new PrismaClient();
try {
  const snapshot = await p.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;

    /** Les identifiants EXTERNES actifs par source — l'ensemble, pas son cardinal. */
    const ids: any[] = await tx.$queryRaw(Prisma.sql`
      SELECT js."sourceKey", array_agg(js."externalId" ORDER BY js."externalId") AS ids
      FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."isActive" AND j."isActive" AND js."sourceKey" = ANY(${keys})
      GROUP BY 1`);

    /** Le dernier run de chaque source, avec les droits tels qu'ils sont STOCKÉS à cet instant. */
    const runs: any[] = await tx.$queryRaw(Prisma.sql`
      SELECT DISTINCT ON ("sourceKey") "sourceKey", status, fetched, accepted, "declaredTotal", complete,
             "canAttestAbsence", truncated, errors, "ranAt", note
      FROM "SourceRun" WHERE "sourceKey" = ANY(${keys}) ORDER BY "sourceKey", "ranAt" DESC, id DESC`);

    /**
     * La terminaison d'énumération, écrite par le run comme événement.
     * `sourceKey` est une COLONNE indexée de `PipelineEvent` : on la lit plutôt que de fouiller le payload.
     */
    const enumeration: any[] = await tx.$queryRaw(Prisma.sql`
      SELECT DISTINCT ON ("sourceKey") "sourceKey",
             payload->'enumeration'->>'termination' AS termination,
             payload->>'complete' AS complete, at
      FROM "PipelineEvent" WHERE event = 'source.enumeration_observed' AND "sourceKey" = ANY(${keys})
      ORDER BY "sourceKey", at DESC`);

    /** Les verdicts d'intégrité du pays, par source. */
    const integrity: any[] = await tx.$queryRaw(Prisma.sql`
      SELECT js."sourceKey", coalesce(j."countryIntegrity", '(aucun)') AS verdict, count(DISTINCT j.id)::int AS n
      FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."isActive" AND j."isActive" AND js."sourceKey" = ANY(${keys})
      GROUP BY 1, 2 ORDER BY 1, 3 DESC`);

    /** Les offres à code pays AMBIGU, et celles qui sont prouvées : le chiffre à surveiller. */
    const ambiguous: any[] = await tx.$queryRaw(Prisma.sql`
      SELECT js."sourceKey",
             count(DISTINCT j.id)::int AS total,
             count(DISTINCT j.id) FILTER (WHERE j."countryIntegrity" IS NOT NULL)::int AS proven
      FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."isActive" AND j."isActive" AND js."sourceKey" = ANY(${keys})
        AND j."countryCode" = ANY(${AMBIGUOUS})
      GROUP BY 1 ORDER BY 1`);

    /** Les retenues de publication : le RAW conservé sans offre publiée. */
    const holds: any[] = await tx.$queryRaw(Prisma.sql`
      SELECT o."sourceKey", count(*)::int AS held
      FROM "SourceObservation" o
      WHERE o.raw ? 'publicationHold' AND o."sourceKey" = ANY(${keys})
        AND NOT EXISTS (SELECT 1 FROM "JobSource" js
                        WHERE js."sourceKey" = o."sourceKey" AND js."externalId" = o."externalId" AND js."isActive")
      GROUP BY 1 ORDER BY 1`);

    const totals: any[] = await tx.$queryRaw`
      SELECT count(*)::int AS "activeJobs",
             count(*) FILTER (WHERE "closedAt" IS NOT NULL)::int AS "activeWithClosedAt"
      FROM "Job" WHERE "isActive"`;

    return { ids, runs, enumeration, integrity, ambiguous, holds, totals: totals[0] };
  });

  const bySource = (rows: any[], key = 'sourceKey') =>
    Object.fromEntries(rows.map((r) => [r[key], r]));
  const idsBySource: Record<string, string[]> =
    Object.fromEntries(snapshot.ids.map((r: any) => [r.sourceKey, r.ids as string[]]));

  const base = {
    at: new Date().toISOString(), phase, keys,
    idsBySource,
    runs: bySource(snapshot.runs),
    enumeration: bySource(snapshot.enumeration),
    integrity: snapshot.integrity,
    ambiguous: bySource(snapshot.ambiguous),
    holds: bySource(snapshot.holds),
    totals: snapshot.totals,
  };

  if (phase === 'before') {
    const out = arg('out');
    if (out) writeFileSync(out, JSON.stringify(base, null, 2));
    console.log(JSON.stringify({ phase, sources: keys.length, ids: Object.fromEntries(
      Object.entries(idsBySource).map(([k, v]) => [k, v.length])) }, null, 1));
  } else {
    const beforeFile = arg('before');
    const before = beforeFile ? JSON.parse(readFileSync(beforeFile, 'utf8')) : { idsBySource: {}, runs: {}, holds: {}, ambiguous: {} };
    const since = arg('since') ? new Date(arg('since')!) : new Date(0);
    const command = arg('command');

    /** Créations et ré-attestations réellement produites par CE run. */
    const written: any[] = await p.$queryRaw(Prisma.sql`
      SELECT js."sourceKey",
             count(*) FILTER (WHERE js."firstSeenAt" >= ${since})::int AS "jobSourcesCreated",
             count(*) FILTER (WHERE js."lastSeenAt" >= ${since})::int AS "jobSourcesReattested",
             count(DISTINCT j.id) FILTER (WHERE j."firstSeenAt" >= ${since})::int AS "jobsCreated"
      FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."sourceKey" = ANY(${keys}) AND js."isActive" AND j."isActive"
      GROUP BY 1 ORDER BY 1`);

    /** Tout run d'une source HORS allowlist depuis le début : la garde de périmètre. */
    const outside: any[] = await p.$queryRaw(Prisma.sql`
      SELECT "sourceKey", count(*)::int AS runs FROM "SourceRun"
      WHERE "ranAt" >= ${since} AND NOT ("sourceKey" = ANY(${keys})) GROUP BY 1`);

    /** Double écriture : une représentation active en double pour un même (source, externalId). */
    const duplicates: any[] = await p.$queryRaw(Prisma.sql`
      SELECT count(*)::int AS duplicated FROM (
        SELECT "sourceKey", "externalId" FROM "JobSource"
        WHERE "isActive" AND "sourceKey" = ANY(${keys}) GROUP BY 1, 2 HAVING count(*) > 1) d`);

    /** Verdicts hors liste positive fermée : l'invariant d'intégrité. */
    const offList: any[] = await p.$queryRaw`
      SELECT DISTINCT "countryIntegrity" AS verdict FROM "Job"
      WHERE "countryIntegrity" IS NOT NULL
        AND "countryIntegrity" NOT IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED')`;

    /**
     * Ce qui SERAIT candidat à fermeture — décrit, jamais fermé.
     * Une représentation d'une source de la vague qui n'a pas été revue par ce run, et dont l'offre n'a plus
     * aucune autre source active. Aucun refresh n'est lancé : c'est une projection, pas une action.
     */
    const closureCandidates: any[] = await p.$queryRaw(Prisma.sql`
      SELECT js."sourceKey", count(DISTINCT j.id)::int AS candidates
      FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."sourceKey" = ANY(${keys}) AND js."isActive" AND j."isActive" AND js."lastSeenAt" < ${since}
        AND NOT EXISTS (SELECT 1 FROM "JobSource" o
                        WHERE o."jobId" = j.id AND o."isActive" AND o."lastSeenAt" >= ${since})
      GROUP BY 1 ORDER BY 1`);

    const run = command ? await p.pipelineRun.findFirst({
      where: { command }, orderBy: { startedAt: 'desc' },
      select: { id: true, status: true, startedAt: true, finishedAt: true, revision: true },
    }) : null;

    const writtenBy = bySource(written);
    const perSource = keys.map((k) => {
      const b: string[] = before.idsBySource?.[k] ?? [];
      const a: string[] = idsBySource[k] ?? [];
      const setB = new Set(b), setA = new Set(a);
      const added = a.filter((x) => !setB.has(x));
      const gone = b.filter((x) => !setA.has(x));
      const r: any = base.runs[k] ?? {};
      const prev: any = before.runs?.[k] ?? {};
      return {
        source: k,
        status: r.status ?? null, fetched: r.fetched ?? null, declaredTotal: r.declaredTotal ?? null,
        errors: r.errors ?? null, truncated: r.truncated ?? null,
        enumerationTermination: (base.enumeration as any)[k]?.termination ?? null,
        complete: r.complete ?? null,
        canAttestAbsenceBefore: prev.canAttestAbsence ?? null,
        canAttestAbsenceAfter: r.canAttestAbsence ?? null,
        idsBefore: b.length, idsAfter: a.length,
        added: added.length, gone: gone.length,
        addedSample: added.slice(0, 5), goneSample: gone.slice(0, 5),
        // La variation se mesure sur l'ensemble SYMÉTRIQUE, pas sur l'écart des cardinaux : 5 ajouts et
        // 5 disparitions donneraient 0 % en arithmétique alors que l'ensemble a changé de 10 offres.
        variationPct: b.length ? Number((((added.length + gone.length) / b.length) * 100).toFixed(2)) : null,
        jobsCreated: writtenBy[k]?.jobsCreated ?? 0,
        jobSourcesCreated: writtenBy[k]?.jobSourcesCreated ?? 0,
        jobSourcesReattested: writtenBy[k]?.jobSourcesReattested ?? 0,
        ambiguousBefore: before.ambiguous?.[k]?.total ?? 0,
        ambiguousProvenBefore: before.ambiguous?.[k]?.proven ?? 0,
        ambiguousAfter: (base.ambiguous as any)[k]?.total ?? 0,
        ambiguousProvenAfter: (base.ambiguous as any)[k]?.proven ?? 0,
        holdsBefore: before.holds?.[k]?.held ?? 0,
        holdsAfter: (base.holds as any)[k]?.held ?? 0,
        closureCandidates: closureCandidates.find((c: any) => c.sourceKey === k)?.candidates ?? 0,
      };
    });

    const newlyProven = perSource.reduce((a, s) => a + (s.ambiguousProvenAfter - s.ambiguousProvenBefore), 0);
    const guards = {
      runsOutsideAllowlist: outside,
      duplicateRepresentations: duplicates[0]?.duplicated ?? 0,
      activeWithClosedAt: base.totals.activeWithClosedAt,
      verdictsOffPositiveList: offList.map((o: any) => o.verdict),
      holdsLost: perSource.filter((s) => s.holdsAfter < s.holdsBefore).map((s) => s.source),
      attestingWithoutProof: perSource.filter((s) => s.canAttestAbsenceAfter === true && s.complete !== true)
        .map((s) => s.source),
      sourcesFailed: perSource.filter((s) => (s.errors ?? 0) > 0
        || ['BROKEN', 'TIMEOUT', 'ERROR', 'CHALLENGED'].includes(s.status ?? '')).map((s) => s.source),
      variationOver20pct: perSource.filter((s) => (s.variationPct ?? 0) > 20 && s.idsBefore > 0).map((s) => s.source),
      newlyProvenAmbiguous: newlyProven,
    };

    const report = { at: base.at, phase, command, pipelineRun: run, perSource, guards,
                     integrity: base.integrity, totals: base.totals, idsBySource };
    const out = arg('out');
    if (out) writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ perSource, guards, pipelineRun: run }, null, 1));
  }
} finally {
  await p.$disconnect();
}
