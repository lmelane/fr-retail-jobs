/**
 * LES OFFRES SANS DESCRIPTION D'UNE SOURCE, dans sa dernière capture extraite — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/descriptions-vides.mts --source=estee-lauder-companies [--min=40] [--retenue=MOTIF]
 *
 * Avec `--retenue`, rend plutôt les offres retenues pour ce motif (PVH : `JSONLD_EMPLOYER_NOT_RESOLVED`), avec
 * l'employeur lu, pour vérifier chez l'éditeur si le défaut est le sien ou le nôtre (D-481 §4).
 *
 * D-481 §3 (30/09/2026) : une offre publiée sans description par l'éditeur est une retenue sur sa preuve ; une offre
 * que NOUS n'avons pas su lire ne l'est pas. Ce programme rend, pour la dernière capture extraite de la source, les
 * offres dont la description lue fait moins de `--min` caractères, avec l'adresse et la description brute, pour
 * vérifier ensuite chez l'éditeur ce qu'il publie. Il n'écrit rien et ne contacte aucun éditeur.
 */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../src/capture/store.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const source = arg('source');
const min = Number(arg('min') ?? 40);
const retenue = arg('retenue');
if (!source) { console.error('usage: descriptions-vides.mts --source=<clé> [--min=40]'); process.exit(2); }
const prisma = new PrismaClient({ log: [] });
try {
  const [batch] = await prisma.$queryRawUnsafe<{ id: string; startedAt: Date; accessDecisionId: string | null }[]>(`
    SELECT b.id, b."startedAt", b."accessDecisionId" FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId" = b.id AND o.status = 'EXTRACTED'
     WHERE b."sourceKey" = $1 AND b.purpose = 'JOBS' ORDER BY b."startedAt" DESC LIMIT 1`, source);
  if (!batch) { console.log(JSON.stringify({ source, capture: null })); process.exit(0); }
  const rows = await prisma.sourceExtraction.findMany({ where: { batchId: batch.id }, orderBy: { ordinal: 'asc' }, select: { externalId: true, outputHash: true } });
  const vides: { externalId: string | null; url?: string; title?: string; longueur: number; description: string; employeur?: unknown; retenue?: string; sameAs?: unknown }[] = [];
  for (const row of rows) {
    const job = JSON.parse((await readRawBlob(prisma, row.outputHash)).toString('utf8')) as { title?: string; url?: string; description?: string;
      company?: string; employerEvidence?: unknown; publicationHold?: string; raw?: { hiringOrganization?: { sameAs?: unknown } } };
    const text = (job.description ?? '').trim();
    const retenu = retenue ? job.publicationHold === retenue : text.length < min;
    if (retenu) vides.push({ externalId: row.externalId, url: job.url, title: job.title, longueur: text.length, description: text.slice(0, 80),
      ...(retenue ? { employeur: job.company ?? job.employerEvidence ?? null, retenue: job.publicationHold,
        // Le lien natif de l'organisation (PVH : site carrières de la marque, ou du groupe).
        sameAs: job.raw?.hiringOrganization?.sameAs ?? null } : {}) });
  }
  console.log(JSON.stringify({ source, capture: batch.id, startedAt: batch.startedAt, admise: !!batch.accessDecisionId, offres: rows.length, [retenue ? 'retenues' : 'sansDescription']: vides.length, vides }, null, 1));
} finally {
  await prisma.$disconnect();
}
