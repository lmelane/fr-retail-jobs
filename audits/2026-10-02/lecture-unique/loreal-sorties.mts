/**
 * Lecture unique — ce que L'Oréal Professionnel publierait depuis sa capture de qualification du RUN du 01/10
 * (`f700a47d`, 1 804 requêtes, 1 717 offres, VALIDATED), que l'ingestion relisait et voyait refusée (406).
 * LECTURE SEULE (accès d'audit vérifié). Rejouable :
 *   AUDIT_DATABASE_URL=… npx tsx audits/2026-10-02/lecture-unique/loreal-sorties.mts > audits/2026-10-02/lecture-unique/loreal-sorties.out
 * Compte, sur les sorties scellées : retenues, marque (`company`, lue dans la fiche), longueur de description
 * (seuil de 200 caractères de `noteFieldCoverage`, plancher de santé de 70 %), et les fiches refusées de la capture.
 * Le même compte sur la dernière ingestion PUBLIÉE de la source sert de comparaison.
 */
import { gunzipSync } from 'node:zlib';
import { ouvrirAccesAudit } from '../../../apps/aggregator/scripts/ops/audit-acces.ts';
const KEY = 'l-oreal-professionnel';
const { prisma } = await ouvrirAccesAudit();
const qualif = await prisma.captureBatch.findFirstOrThrow({ where: { sourceKey: KEY, id: { startsWith: 'f700a47d' } }, include: { outcome: true } });
const published = await prisma.sourceIngestionCompletion.findFirst({ where: { batch: { sourceKey: KEY }, published: { gt: 0 } }, orderBy: { completedAt: 'desc' } });
const count = async (batchId: string) => {
  const rows = await prisma.sourceExtraction.findMany({ where: { batchId }, orderBy: { ordinal: 'asc' } });
  const c = { offres: rows.length, retenues: {} as Record<string, number>, avecMarque: 0, marques: {} as Record<string, number>, description200: 0, descriptionVide: 0 };
  for (const row of rows) {
    const job = JSON.parse(gunzipSync((await prisma.rawBlob.findUniqueOrThrow({ where: { hash: row.outputHash }, include: { body: true } })).body!.gzip).toString('utf8'));
    if (job.publicationHold) c.retenues[job.publicationHold] = (c.retenues[job.publicationHold] ?? 0) + 1;
    if (job.company) { c.avecMarque++; c.marques[job.company] = (c.marques[job.company] ?? 0) + 1; }
    const length = String(job.description ?? '').trim().length;
    if (length >= 200) c.description200++; if (!length) c.descriptionVide++;
  }
  const top = Object.entries(c.marques).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const refus = await prisma.rawCapture.groupBy({ by: ['status'], where: { batchId }, _count: true });
  return { ...c, marques: Object.fromEntries(top), nbMarques: Object.keys(c.marques).length, statutsHttp: Object.fromEntries(refus.map(r => [String(r.status), r._count])) };
};
console.log(`qualification ${qualif.id} du ${qualif.startedAt.toISOString()} : ${JSON.stringify(await count(qualif.id))}`);
if (published) {
  const batch = await prisma.captureBatch.findUniqueOrThrow({ where: { id: published.batchId } });
  console.log(`dernière ingestion publiée ${batch.id} du ${batch.startedAt.toISOString()} (publiées ${published.published}, retenues ${published.held}, échecs ${published.writeFailed}) : ${JSON.stringify(await count(batch.id))}`);
} else console.log('aucune ingestion publiée de la source');
await prisma.$disconnect();
