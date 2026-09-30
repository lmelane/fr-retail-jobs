/**
 * LES RÉPONSES ARCHIVÉES D'UNE CAPTURE POUR UN FRAGMENT D'ADRESSE — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/mesures/reponses-archivees.mts --batch=<id> --motif=/jobs/31752/ [--apercu=600]
 *
 * Pour chaque requête de la capture dont l'adresse contient `--motif`, dans l'ordre de `sequence` : l'heure, la
 * méthode, le statut, l'échec de transport, les en-têtes de réponse, l'empreinte du corps (vérifiée par
 * `readRawBlob`) et le début de son texte visible. Sert à dire si un échec est un refus de l'éditeur (corps
 * applicatif, statut définitif) ou un incident passager (passerelle, délai). N'écrit rien, ne contacte personne.
 */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../src/capture/store.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const batch = arg('batch');
const motif = arg('motif');
const apercu = Number(arg('apercu') ?? 600);
if (!batch || !motif) { console.error('usage: reponses-archivees.mts --batch=<id> --motif=<fragment>'); process.exit(2); }
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const prisma = new PrismaClient({ log: [] });
try {
  const rows = await prisma.rawCapture.findMany({ where: { batchId: { startsWith: batch }, requestUrl: { contains: motif } }, orderBy: { sequence: 'asc' } });
  for (const row of rows) {
    const body = row.blobHash ? (await readRawBlob(prisma, row.blobHash)).toString('utf8') : null;
    console.log(JSON.stringify({ sequence: row.sequence, a: row.capturedAt.toISOString(), methode: row.method, url: row.requestUrl, statut: row.status,
      complete: row.complete, echec: row.failure, entetes: row.headers, empreinte: row.blobHash, octets: body?.length ?? null,
      texte: body === null ? null : text(body).slice(0, apercu) }, null, 1));
  }
  if (!rows.length) console.log(JSON.stringify({ batch, motif, requetes: 0 }));
} finally {
  await prisma.$disconnect();
}
