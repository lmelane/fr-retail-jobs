/**
 * LA QUALIFICATION NATIVE D'UN LOT, OFFRE PAR OFFRE — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/mesures/qualification-par-offre.mts --batch=<id de CaptureBatch> [--apercu=300] [--offre=<externalId>]
 *
 * `SourceValidation.report` ne garde que des COMPTES par motif (« CONTENT_MISSING: 6 ») : il ne dit pas QUELLES
 * offres sont refusées, ni si le défaut est chez l'éditeur ou dans notre lecture. Ce programme relit chaque sortie
 * archivée du lot avec le lecteur de récupération ACTUEL (celui de ce dépôt), rend les offres non qualifiées ou
 * retenues avec leur motif, et, pour chacune, la réponse native de sa fiche archivée dans le même lot : statut HTTP,
 * échec de transport, texte visible. Il n'écrit rien et ne contacte aucun éditeur.
 *
 * Limite : c'est la SORTIE archivée qui est relue, pas un rejeu de l'adaptateur. Un lecteur de fiche modifié depuis
 * la collecte (clôture anglaise SuccessFactors, 30/09) ne s'y voit donc pas ; la fiche archivée, elle, est rendue
 * pour être relue avec le lecteur courant (`lectureActuelle`).
 */
import { PrismaClient } from '@prisma/client';
import * as cheerio from 'cheerio';
import { readRawBlob } from '../../../src/capture/store.js';
import { recoverRetainedPublication } from '../../../src/publication/recovery.js';
import { captureConfig } from '../../../src/capture/config.js';
import { effectiveSourceConfig } from '../../../src/connectors/sourceConfig.js';
import { KIND_TO_ATS } from '../../../src/ats/catalogKinds.js';
import { parseMicrodataDetail } from '../../../src/ats/adapters/successfactors.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const batchId = arg('batch');
const apercu = Number(arg('apercu') ?? 300);
/** Une seule offre, qualifiée ou non (`--offre=<externalId>`) : pour lire ce qu'elle portait un jour où elle passait. */
const offre = arg('offre');
if (!batchId) { console.error('usage: qualification-par-offre.mts --batch=<id de CaptureBatch>'); process.exit(2); }
const visible = (html: string) => cheerio.load(html, { scriptingEnabled: false })('.content .job').text().replace(/\s+/g, ' ').trim()
  || html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const prisma = new PrismaClient({ log: [] });
try {
  const batch = await prisma.captureBatch.findUniqueOrThrow({ where: { id: batchId } });
  const [revision] = await prisma.$queryRawUnsafe<{ payloadText: string }[]>(
    `SELECT payload::text AS "payloadText" FROM "SourceRevision" WHERE id = $1`, batch.sourceRevisionId);
  const payload = JSON.parse(revision.payloadText) as { kind: string; config: Record<string, unknown> };
  const config = captureConfig(effectiveSourceConfig(payload.config));
  const rows = await prisma.sourceExtraction.findMany({ where: { batchId }, orderBy: { ordinal: 'asc' }, select: { externalId: true, outputHash: true } });
  const motifs: Record<string, number> = {};
  const offres: unknown[] = [];
  let qualifiees = 0;
  for (const row of rows) {
    const job = JSON.parse((await readRawBlob(prisma, row.outputHash)).toString('utf8')) as {
      externalId: string; url: string; title?: string; description?: string; company?: string; employerEvidence?: unknown;
      publicationHold?: string; publicationWithdrawnAt?: string; raw?: Record<string, unknown> };
    let motif: string;
    if (job.publicationHold || job.publicationWithdrawnAt) motif = `RETENUE:${job.publicationHold ?? 'WITHDRAWN'}`;
    else {
      const recovery = recoverRetainedPublication(payload.kind, job.raw, { externalId: job.externalId, url: job.url, observedAt: batch.startedAt, config });
      motif = recovery.status === 'RECOVERABLE' ? 'QUALIFIEE' : recovery.reason;
    }
    motifs[motif] = (motifs[motif] ?? 0) + 1;
    if (motif === 'QUALIFIEE') qualifiees++;
    if (offre ? job.externalId !== offre : motif === 'QUALIFIEE') continue;
    // La fiche native archivée dans le même lot, à la même adresse que l'offre.
    const fiches = await prisma.rawCapture.findMany({ where: { batchId, requestUrl: job.url }, orderBy: { sequence: 'asc' },
      select: { sequence: true, status: true, failure: true, complete: true, blobHash: true } });
    const lues = [];
    for (const fiche of fiches) {
      const html = fiche.blobHash ? (await readRawBlob(prisma, fiche.blobHash)).toString('utf8') : '';
      const lecture = html && KIND_TO_ATS[payload.kind] === 'SUCCESSFACTORS' ? parseMicrodataDetail(html, batch.startedAt) : undefined;
      lues.push({ sequence: fiche.sequence, status: fiche.status, complete: fiche.complete, octets: html.length,
        ...(fiche.failure ? { echec: fiche.failure.slice(0, 200) } : {}),
        texte: visible(html).slice(0, apercu),
        ...(lecture ? { lectureActuelle: { cloture: lecture.closure?.message ?? null, titre: lecture.title ?? null,
          description: lecture.description?.length ?? 0, employeur: lecture.company ?? null } } : {}) });
    }
    const detail = job.raw?.successfactorsDetail as Record<string, unknown> | undefined;
    offres.push({ motif, externalId: job.externalId, url: job.url, titre: job.title ?? null, employeur: job.company ?? null, preuveEmployeur: job.employerEvidence ?? null,
      description: (job.description ?? '').length,
      ...(job.raw?.detailReadError ? { erreurDeFiche: String(job.raw.detailReadError).slice(0, 200) } : {}),
      ...(detail ? { ficheRetenue: { cles: Object.keys(detail), description: typeof detail.description === 'string' ? detail.description.length : null,
        cloture: (detail.closure as { message?: string } | undefined)?.message ?? null } } : {}),
      fiches: lues });
  }
  console.log(JSON.stringify({ source: batch.sourceKey, capture: batchId, startedAt: batch.startedAt, kind: payload.kind,
    sorties: rows.length, qualifiees, motifs, offres }, null, 1));
} finally {
  await prisma.$disconnect();
}
