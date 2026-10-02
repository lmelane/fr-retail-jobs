/**
 * Lecture unique du RUN — la publication issue du REJEU de la capture de qualification est-elle celle que l'ingestion a
 * réellement publiée ? Comparaison sur des sources de familles différentes, RUN quotidien réel. LECTURE SEULE : accès
 * d'audit aux privilèges vérifiés (`ouvrirAccesAudit`, aucune table inscriptible), aucune requête réseau.
 *
 * Rejouable (depuis la racine du dépôt) :
 *   AUDIT_DATABASE_URL=… npx tsx audits/2026-10-02/lecture-unique/rejeu-compare.mts 2026-10-01 > audits/2026-10-02/lecture-unique/rejeu-compare.out
 *
 * Pour chaque source :
 *   1. le rejeu hors réseau de la capture de qualification, avec le lecteur de CE code (`replayExtraction`), comparé à
 *      son manifeste scellé (`compareExtractionResult`) : c'est exactement ce que l'adoption rejoue ;
 *   2. les sorties scellées de la qualification (ce que l'adoption publie) contre celles de l'ingestion (ce qui a été
 *      publié) : identifiant natif, empreinte de la sortie, retenue ; les champs qui diffèrent sont nommés ;
 *   3. les faits d'énumération des deux manifestes (complet, total déclaré, troncature, terminaison, lignes rejetées,
 *      identifiants canoniques), d'où découle l'attestation d'absence ;
 *   4. le rapport de fin d'ingestion réel (publiées, retenues, échecs d'écriture, écartées).
 */
import { gunzipSync } from 'node:zlib';
import { ouvrirAccesAudit } from '../../../apps/aggregator/scripts/ops/audit-acces.ts';
import { replayExtraction } from '../../../apps/aggregator/src/capture/batch.ts';
import { compareExtractionResult, readExtractionManifest } from '../../../apps/aggregator/src/capture/manifest.ts';
import { captureConfig } from '../../../apps/aggregator/src/capture/config.ts';
import { effectiveSourceConfig } from '../../../apps/aggregator/src/connectors/sourceConfig.ts';
import { KIND_TO_ATS } from '../../../apps/aggregator/src/ats/catalogKinds.ts';
import { fetchAtsJobs } from '../../../apps/aggregator/src/ats/index.ts';

const day = process.argv[2] ?? '2026-10-01';
/** 20 sources, une par famille de lecteur (familles.out), hors des 9 que la règle n'adopte pas (requetes.out). */
const SOURCES = (process.argv[3] ?? ['fred-perry', 'brunello-cucinelli', 'glossier', 'sisley', 'burberry', 'caudalie', 'mulberry',
  'ami-paris', 'closed', 'gant', 'longchamp', 'baccarat', 'hugo-boss-phenom', 'toscane', 'sezane', 'aeropostale',
  'bloomingdales-oracle', 'polene', 'acne-studios-jobylon', 'brown-thomas-taleo'].join(',')).split(',');

const { prisma } = await ouvrirAccesAudit();
const [run] = await prisma.$queryRaw<{ id: string; startedAt: Date }[]>`
  SELECT id, "startedAt" FROM "PipelineRun" WHERE command='ingest-all' AND "startedAt" >= ${new Date(day)}
    AND "startedAt" < ${new Date(new Date(day).getTime() + 86_400_000)} ORDER BY "startedAt" LIMIT 1`;
if (!run) throw new Error(`aucun RUN ingest-all le ${day}`);
console.log(`RUN ${run.id} (${run.startedAt.toISOString()})`);

type Out = { ordinal: number; externalId: string | null; outputHash: string };
const outputs = (batchId: string) => prisma.sourceExtraction.findMany({ where: { batchId }, orderBy: { ordinal: 'asc' },
  select: { ordinal: true, externalId: true, outputHash: true } }) as Promise<Out[]>;
const body = async (hash: string) => {
  const blob = await prisma.rawBlob.findUniqueOrThrow({ where: { hash }, include: { body: true } });
  if (!blob.body) throw new Error(`sortie archivée à froid : ${hash}`);
  return JSON.parse(gunzipSync(blob.body.gzip).toString('utf8')) as Record<string, unknown>;
};
const facts = (metadata: Record<string, unknown>) => {
  const enumeration = metadata.enumeration as { termination?: string; pageEvidence?: { canonicalIds?: string[] }[] } | undefined;
  const canonical = enumeration?.pageEvidence?.flatMap(page => page.canonicalIds ?? []) ?? [];
  return { complete: metadata.complete ?? null, declaredTotal: metadata.declaredTotal ?? null, truncated: metadata.truncated ?? null,
    termination: enumeration?.termination ?? null, rejectedRows: Array.isArray(metadata.rejectedRows) ? metadata.rejectedRows.length : 0,
    canonicalIds: canonical.length };
};

const totals = { sources: 0, rejeuExact: 0, identiques: 0, offresQualif: 0, offresIngest: 0, memesSorties: 0 };
for (const key of SOURCES) {
  const batches = await prisma.captureBatch.findMany({ where: { sourceKey: key, runId: run.id, purpose: 'JOBS' },
    orderBy: { attemptOrdinal: 'desc' }, include: { outcome: true, ingestionCompletion: true, validations: { orderBy: { sequence: 'asc' } } } });
  const qualif = batches.find(batch => !batch.accessDecisionId);
  const ingest = batches.find(batch => batch.accessDecisionId);
  if (!qualif || !ingest || qualif.outcome?.status !== 'EXTRACTED' || ingest.outcome?.status !== 'EXTRACTED') {
    console.log(`\n## ${key} — paire incomplète (qualif ${qualif?.outcome?.status ?? 'absente'}, ingestion ${ingest?.outcome?.status ?? 'absente'})`);
    continue;
  }
  totals.sources++;
  // 1. Le rejeu hors réseau, avec le lecteur de ce code, contre le manifeste scellé de la qualification.
  const [revision] = await prisma.$queryRaw<{ payloadText: string }[]>`SELECT payload::text AS "payloadText" FROM "SourceRevision" WHERE id=${qualif.sourceRevisionId}`;
  const payload = JSON.parse(revision.payloadText) as { kind: string; config: Record<string, unknown> };
  const config = captureConfig(effectiveSourceConfig(payload.config));
  let replay: string;
  try {
    const replayed = await replayExtraction(prisma, qualif.id, () => fetchAtsJobs(KIND_TO_ATS[payload.kind] as never, config));
    const compared = await compareExtractionResult(prisma, qualif.id, replayed);
    replay = compared.exact ? 'EXACT' : `DIFFÉRENT (sorties ${compared.matchesRecordedOutput ? 'identiques' : 'différentes'}, métadonnées ${compared.matchesRecordedMetadata ? 'identiques' : 'différentes'})`;
    if (!compared.matchesRecordedOutput) {
      // Le lecteur de ce code n'est pas celui du RUN (readerRevision) : les champs qui changent disent pourquoi.
      const recorded = await outputs(qualif.id);
      const changedFields = new Map<string, number>();
      for (const [index, job] of replayed.jobs.entries()) {
        const before = await body(recorded[index].outputHash);
        const { captureBatchId: _b, captureOutputId: _o, ...after } = job as unknown as Record<string, unknown>;
        for (const field of new Set([...Object.keys(before), ...Object.keys(after)]))
          if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) changedFields.set(field, (changedFields.get(field) ?? 0) + 1);
      }
      replay += ` — champs changés par le lecteur de ce code : ${[...changedFields].map(([f, n]) => `${f}×${n}`).join(', ') || 'aucun champ (ordre ou nombre)'} ; lecteur du RUN ${qualif.readerRevision}`;
    }
    if (compared.exact) totals.rejeuExact++;
  } catch (error) {
    replay = `ÉCHEC : ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`;
  }
  // 2. Sorties scellées : qualification (publiée par l'adoption) contre ingestion (publiée le jour du RUN).
  const [q, i] = await Promise.all([outputs(qualif.id), outputs(ingest.id)]);
  totals.offresQualif += q.length; totals.offresIngest += i.length;
  const byId = (rows: Out[]) => new Map(rows.map(row => [row.externalId ?? `#${row.ordinal}`, row]));
  const qa = byId(q), ia = byId(i);
  const onlyQ = [...qa.keys()].filter(id => !ia.has(id));
  const onlyI = [...ia.keys()].filter(id => !qa.has(id));
  const changed = [...qa.keys()].filter(id => ia.has(id) && qa.get(id)!.outputHash !== ia.get(id)!.outputHash);
  totals.memesSorties += [...qa.keys()].filter(id => ia.has(id) && qa.get(id)!.outputHash === ia.get(id)!.outputHash).length;
  // Les chemins qui diffèrent (jusqu'à 4 niveaux, dans `raw` compris), et un exemple de valeurs pour chacun.
  const fields = new Map<string, number>();
  const examples = new Map<string, string>();
  const diff = (a: unknown, b: unknown, path: string, depth: number) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (depth < 4 && a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`, depth + 1);
      return;
    }
    fields.set(path, (fields.get(path) ?? 0) + 1);
    if (!examples.has(path)) examples.set(path, `${JSON.stringify(a)?.slice(0, 70)} → ${JSON.stringify(b)?.slice(0, 70)}`);
  };
  for (const id of changed.slice(0, 50)) {
    const [a, b] = await Promise.all([body(qa.get(id)!.outputHash), body(ia.get(id)!.outputHash)]);
    diff(a, b, '', 0);
  }
  const holds = async (rows: Out[]) => {
    const counts: Record<string, number> = {};
    for (const row of rows) { const hold = (await body(row.outputHash)).publicationHold; if (typeof hold === 'string') counts[hold] = (counts[hold] ?? 0) + 1; }
    return counts;
  };
  const sameOrder = q.length === i.length && q.every((row, index) => row.externalId === i[index].externalId && row.outputHash === i[index].outputHash);
  // 3. Faits d'énumération des deux manifestes scellés.
  const [mq, mi] = await Promise.all([readExtractionManifest(prisma, qualif.id), readExtractionManifest(prisma, ingest.id)]);
  const fq = facts(mq.metadata as Record<string, unknown>), fi = facts(mi.metadata as Record<string, unknown>);
  const factsDiffer = Object.keys(fq).filter(field => (fq as Record<string, unknown>)[field] !== (fi as Record<string, unknown>)[field]);
  if (sameOrder && !factsDiffer.length) totals.identiques++;
  const validation = qualif.validations.at(-1);
  const report = validation?.report as { replayExact?: boolean; enumerationClaim?: string } | undefined;
  console.log(`\n## ${key} (${payload.kind}) — âge à l'ingestion ${((ingest.startedAt.getTime() - qualif.startedAt.getTime()) / 60_000).toFixed(1)} min`);
  console.log(`  rejeu de la qualification (lecteur de ce code) : ${replay} ; validation du RUN : ${validation?.verdict} replayExact=${report?.replayExact} énumération=${report?.enumerationClaim}`);
  console.log(`  sorties : qualification ${q.length}, ingestion ${i.length} ; ${sameOrder ? 'IDENTIQUES (même ordre, mêmes empreintes)' : `communes identiques ${[...qa.keys()].length - onlyQ.length - changed.length}, modifiées ${changed.length}, seulement qualification ${onlyQ.length}, seulement ingestion ${onlyI.length}`}`);
  if (changed.length) {
    console.log(`  champs modifiés (sur ${Math.min(50, changed.length)} offres) : ${[...fields].map(([f, n]) => `${f}×${n}`).join(', ')}`);
    for (const [path, example] of examples) console.log(`    ${path} : ${example}`);
  }
  if (onlyQ.length || onlyI.length) console.log(`  identifiants : +qualif [${onlyQ.slice(0, 5).join(', ')}] +ingestion [${onlyI.slice(0, 5).join(', ')}]`);
  const [hq, hi] = await Promise.all([holds(q), holds(i)]);
  if (JSON.stringify(hq) !== JSON.stringify(hi) || Object.keys(hq).length) console.log(`  retenues : qualification ${JSON.stringify(hq)} ; ingestion ${JSON.stringify(hi)}`);
  console.log(`  énumération : ${factsDiffer.length ? `DIFFÈRE sur ${factsDiffer.join(', ')} — qualif ${JSON.stringify(fq)} / ingestion ${JSON.stringify(fi)}` : `identique ${JSON.stringify(fq)}`}`);
  const c = ingest.ingestionCompletion;
  console.log(`  fin d'ingestion réelle : publiées ${c?.published ?? '?'}, retenues ${c?.held ?? '?'}, échecs ${c?.writeFailed ?? '?'}, écartées ${c?.skipped ?? '?'}`);
}
console.log(`\nTOTAL ${JSON.stringify(totals)}`);
await prisma.$disconnect();
