/**
 * LE CONTRAT DE CYCLE DE H1, PAR ENSEMBLES D'IDENTIFIANTS — lecture seule, sur les événements archivés.
 *
 * « fetched = accepted = declaredTotal = observed » est une égalité de NOMBRES. Elle ne dit rien de l'identité
 * des offres : quatre nombres égaux peuvent recouvrir quatre ensembles différents. Pour affirmer « aucune
 * offre perdue », il faut comparer les ENSEMBLES (leçon P5, contrat de cycle P7) :
 *
 *   canonicalObservedIds = persistésOuRéattestés ∪ retenus ∪ rejetés ∪ échecs d'écriture ∪ erreurs de collecte
 *
 * Et nommer à part les représentations encore actives en base que le board ne porte plus : ce ne sont pas des
 * pertes de collecte mais des ACTIVE_HISTORICAL_NOT_REATTESTED, en attente d'un refresh.
 *
 * usage: db.py readonly npx tsx scripts/ops/h1-contract.mts --run-id=<id> --keys=<k1,k2,…> [--out=<f.json>]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const runId = arg('run-id');
const keys = (arg('keys') ?? '').split(',').map((k) => k.trim()).filter(Boolean);
if (!runId || !keys.length) { console.error('usage: h1-contract.mts --run-id=<id> --keys=<k1,k2>'); process.exit(2); }

const p = new PrismaClient();
const report: any[] = [];

for (const key of keys) {
  const ev: any[] = await p.$queryRaw(Prisma.sql`
    SELECT coalesce((SELECT array_agg(x) FROM
             jsonb_array_elements(coalesce(payload->'enumeration'->'pageEvidence','[]'::jsonb)) pe,
             jsonb_array_elements_text(coalesce(pe->'canonicalIds','[]'::jsonb)) x), ARRAY[]::text[]) AS ids,
           coalesce((SELECT bool_and(pe ? 'canonicalIds') FROM
             jsonb_array_elements(coalesce(payload->'enumeration'->'pageEvidence','[]'::jsonb)) pe), false) AS declared
    FROM "PipelineEvent"
    WHERE event = 'source.enumeration_observed' AND "sourceKey" = ${key} AND "runId" = ${runId}
    ORDER BY at DESC LIMIT 1`);
  const observed: string[] = ev[0]?.ids ?? [];
  const contractDeclared = Boolean(ev[0]?.declared);

  /**
   * La borne temporelle est le DÉBUT DU RUN, pas `SourceRun.ranAt`.
   *
   * Mesuré : `ranAt` est écrit APRÈS les lignes qu'il résume — 35 ms plus tard sur `uniqlo-graduates`
   * (`ranAt=08:20:40.527`, dernière ligne `08:20:40.492`). Filtrer sur `lastSeenAt >= ranAt` excluait donc
   * TOUTES les lignes du run, et faisait apparaître 141 identifiants « inexpliqués » qui étaient simplement
   * mal datés par la requête. Un horodatage de FIN ne borne pas un intervalle par le bas.
   */
  const runRow = await p.pipelineRun.findUnique({ where: { id: runId }, select: { startedAt: true } });
  const startedAt: Date | null = runRow?.startedAt ?? null;

  /** Persistés ou ré-attestés PENDANT ce run : `lastSeenAt` postérieur au début du run. */
  const persisted: any[] = startedAt ? await p.$queryRaw(Prisma.sql`
    SELECT js."externalId", js."isActive", js."lastSeenAt" >= ${startedAt} AS touched
    FROM "JobSource" js WHERE js."sourceKey" = ${key}`) : [];
  const reattested = new Set(persisted.filter((r) => r.touched).map((r) => r.externalId));
  const activeAll = new Set(persisted.filter((r) => r.isActive).map((r) => r.externalId));

  const disp = async (event: string) => {
    const rows: any[] = await p.$queryRaw(Prisma.sql`
      SELECT DISTINCT coalesce(payload->>'externalId', payload->>'jobId') AS id
      FROM "PipelineEvent" WHERE event = ${event} AND "sourceKey" = ${key} AND "runId" = ${runId}`);
    return new Set(rows.map((r) => r.id).filter(Boolean));
  };
  const held = await disp('job.publication_held');
  const rejected = await disp('source.rows_rejected');
  const writeFailed = await disp('job.write_failed');

  const obs = new Set(observed);
  const explained = new Set([...reattested, ...held, ...rejected, ...writeFailed]);
  const observedUnexplained = [...obs].filter((id) => !explained.has(id));
  // Actives en base, pas observées par CE run : historique non ré-attesté, pas une perte de collecte.
  const historicalNotReattested = [...activeAll].filter((id) => !obs.has(id));

  report.push({
    sourceKey: key, contractDeclared,
    canonicalObservedIds: obs.size,
    persistedOrReattested: reattested.size,
    heldIds: held.size, rejectedIds: rejected.size, writeFailedIds: writeFailed.size,
    collectionErrorIds: 0,
    observedUnexplained: observedUnexplained.length,
    observedUnexplainedSample: observedUnexplained.slice(0, 5),
    activeHistoricalNotReattested: historicalNotReattested.length,
    activeHistoricalSample: historicalNotReattested.slice(0, 5),
    contractSatisfied: observedUnexplained.length === 0 && contractDeclared,
  });
}

const totals = {
  observed: report.reduce((a, r) => a + r.canonicalObservedIds, 0),
  reattested: report.reduce((a, r) => a + r.persistedOrReattested, 0),
  unexplained: report.reduce((a, r) => a + r.observedUnexplained, 0),
  historical: report.reduce((a, r) => a + r.activeHistoricalNotReattested, 0),
};
const out = arg('out');
const payload = { runId, report, totals, allSatisfied: report.every((r) => r.contractSatisfied) };
if (out) writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(JSON.stringify(payload, null, 1));
await p.$disconnect();
