/**
 * LES OFFRES EIGHTFOLD SANS DESCRIPTION, CLASSÉES PAR CE QUE LA FICHE DE DÉTAIL A RENDU — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/eightfold-descriptions.mts --source=estee-lauder-companies [--batch=<id>] [--min=40]
 *
 * D-481 §3 (30/09/2026) : une description que l'éditeur laisse lui-même vide est une retenue sur la preuve de la
 * source ; une fiche que NOUS n'avons pas su lire ne l'est jamais. Ce programme sépare les deux dans une capture
 * extraite (la dernière de la source, ou `--batch`), pour chaque offre dont la description lue fait moins de
 * `--min` caractères :
 *   · FICHE_NON_LUE      — la sortie ne porte pas `raw.eightfoldDetail` : la lecture de la fiche a échoué ;
 *   · VIDE_CHEZ_EDITEUR  — la fiche a été lue et `nativeDescriptionEmpty` (le lecteur du collecteur) la dit vide ;
 *   · COURTE             — la fiche a été lue, le texte est court mais n'est pas vide.
 * Il rend aussi le motif de retenue que la capture a réellement porté (`publicationHold`), pour comparer le
 * classement du lecteur du jour à ce que le collecteur a écrit. Il n'écrit rien et ne contacte aucun éditeur.
 */
import { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { readRawBlob } from '../../src/capture/store.js';
import { nativeDescriptionEmpty } from '../../src/ats/adapters/eightfold.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const source = arg('source');
const min = Number(arg('min') ?? 40);
/** Longueur du HTML brut rendu par offre (`--apercu=600` pour lire un gabarit entier). */
const apercu = Number(arg('apercu') ?? 160);
if (!source) { console.error('usage: eightfold-descriptions.mts --source=<clé> [--batch=<id>] [--min=40] [--apercu=160]'); process.exit(2); }
const prisma = new PrismaClient({ log: [] });
try {
  const [batch] = await prisma.$queryRawUnsafe<{ id: string; startedAt: Date }[]>(`
    SELECT b.id, b."startedAt" FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId" = b.id AND o.status = 'EXTRACTED'
     WHERE b."sourceKey" = $1 AND b.purpose = 'JOBS' AND ($2::text IS NULL OR b.id = $2::text) ORDER BY b."startedAt" DESC LIMIT 1`,
  source, arg('batch') ?? null);
  if (!batch) { console.log(JSON.stringify({ source, capture: null })); process.exit(0); }
  const rows = await prisma.sourceExtraction.findMany({ where: { batchId: batch.id }, orderBy: { ordinal: 'asc' }, select: { externalId: true, outputHash: true } });
  const limit = pLimit(16);
  type Job = { title?: string; url?: string; description?: string; publicationHold?: string; raw?: { eightfoldDetail?: Record<string, unknown> } };
  const jobs = await Promise.all(rows.map((row) => limit(async () =>
    ({ externalId: row.externalId, job: JSON.parse((await readRawBlob(prisma, row.outputHash)).toString('utf8')) as Job }))));
  const classes: Record<string, number> = {};
  const holds: Record<string, number> = {};
  const offres = [];
  // Contre-épreuve : sur TOUTES les fiches lues, combien le lecteur dit vides ? Plus que la classe VIDE_CHEZ_EDITEUR
  // voudrait dire qu'une description d'au moins `--min` caractères serait retenue à tort.
  let videsToutesLongueurs = 0;
  for (const { externalId, job } of jobs) {
    if (nativeDescriptionEmpty(job.raw?.eightfoldDetail)) videsToutesLongueurs++;
    if (job.publicationHold) holds[job.publicationHold] = (holds[job.publicationHold] ?? 0) + 1;
    const text = (job.description ?? '').trim();
    if (text.length >= min) continue;
    const detail = job.raw?.eightfoldDetail;
    const lue = !!detail && typeof detail === 'object';
    const classe = !lue ? 'FICHE_NON_LUE' : nativeDescriptionEmpty(detail) ? 'VIDE_CHEZ_EDITEUR' : 'COURTE';
    classes[classe] = (classes[classe] ?? 0) + 1;
    const brut = lue ? (detail.jobDescription ?? detail.job_description) : undefined;
    offres.push({ externalId, classe, retenue: job.publicationHold ?? null, longueur: text.length, titre: job.title?.slice(0, 50),
      // La forme exacte de ce que l'éditeur a rendu : type, longueur et début du HTML brut.
      ...(lue ? { brut: typeof brut === 'string' ? { longueur: brut.length, debut: brut.slice(0, apercu) } : { type: brut === null ? 'null' : typeof brut } } : {}) });
  }
  console.log(JSON.stringify({ source, capture: batch.id, startedAt: batch.startedAt, offres: rows.length, sousLeSeuil: offres.length, classes,
    videsToutesLongueurs, retenuesDeLaCapture: holds, detail: offres }, null, 1));
} finally {
  await prisma.$disconnect();
}
