/**
 * DEUX LISTES DIGITALRECRUITERS ARCHIVÉES D'UNE MÊME SOURCE, COMPARÉES — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/mesures/liste-dr-comparee.mts --avant=<id de CaptureBatch> --apres=<id de CaptureBatch>
 *
 * Quand le nombre d'offres d'une source DigitalRecruiters chute d'un RUN à l'autre, la question est : l'éditeur a-t-il
 * retiré ces offres, ou notre lecture en a-t-elle perdu ? Ce programme relit, dans chaque lot, les réponses natives de
 * l'API de liste (`job-ads`) avec leur requête (locale, page), le compteur `count` annoncé par l'éditeur et les
 * diffusions rendues ; puis il nomme les annonces présentes avant et absentes après, regroupées par lieu, contrat et
 * métier natifs. N'écrit rien, ne contacte aucun éditeur.
 */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../src/capture/store.js';
import { readRequestData } from '../../../src/capture/requestDataRead.js';

type Item = { id?: number | string; job_ad_id?: number | string; title?: string; location?: string; contract?: string; job?: string;
  url?: string; careers_site_url?: string; career_domain?: string; [key: string]: unknown };
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const avant = arg('avant'); const apres = arg('apres');
if (!avant || !apres) { console.error('usage: liste-dr-comparee.mts --avant=<lot> --apres=<lot>'); process.exit(2); }

const prisma = new PrismaClient({ log: [] });
async function liste(batchId: string) {
  const batch = await prisma.captureBatch.findUniqueOrThrow({ where: { id: batchId } });
  const rows = await prisma.rawCapture.findMany({ where: { batchId, requestUrl: { contains: 'job-ads' } }, orderBy: { sequence: 'asc' } });
  const pages = []; const items: Item[] = [];
  for (const row of rows) {
    const request = await readRequestData(prisma, row);
    const body = row.blobHash ? JSON.parse((await readRawBlob(prisma, row.blobHash)).toString('utf8')) as { count?: number; items?: Item[] } : {};
    pages.push({ sequence: row.sequence, url: request?.logical.url ?? row.requestUrl, status: row.status, count: body.count ?? null, items: body.items?.length ?? 0,
      cles: Object.keys(body), filtres: JSON.stringify((body as Record<string, unknown>).filters ?? null).slice(0, 1500),
      viewport: JSON.stringify((body as Record<string, unknown>).viewport ?? null).slice(0, 300) });
    items.push(...(body.items ?? []));
  }
  return { batchId, startedAt: batch.startedAt, pages, items };
}
const tally = (items: Item[], key: (item: Item) => string) => Object.entries(items.reduce<Record<string, number>>((acc, item) => {
  const k = key(item); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]);
try {
  const [a, b] = [await liste(avant), await liste(apres)];
  const annonce = (item: Item) => String(item.job_ad_id ?? item.id);
  const idsApres = new Set(b.items.map(annonce));
  const idsAvant = new Set(a.items.map(annonce));
  const disparues = a.items.filter((item) => !idsApres.has(annonce(item)));
  const apparues = b.items.filter((item) => !idsAvant.has(annonce(item)));
  // Ce que les fiches lues AVANT disaient de leur propre durée : date de publication et date limite (JSON-LD).
  const sorties = await prisma.sourceExtraction.findMany({ where: { batchId: a.batchId }, select: { externalId: true, outputHash: true } });
  const dates = new Map<string, { postedAt: string | null; validThrough: string | null }>();
  for (const row of sorties) {
    if (!row.externalId || idsApres.has(row.externalId)) continue;
    const job = JSON.parse((await readRawBlob(prisma, row.outputHash)).toString('utf8')) as { postedAt?: string; validThrough?: string };
    dates.set(row.externalId, { postedAt: job.postedAt ?? null, validThrough: job.validThrough ?? null });
  }
  const restantes: Record<string, number> = {};
  for (const row of await prisma.sourceExtraction.findMany({ where: { batchId: b.batchId }, select: { outputHash: true } })) {
    const job = JSON.parse((await readRawBlob(prisma, row.outputHash)).toString('utf8')) as { postedAt?: string };
    const mois = job.postedAt?.slice(0, 7) ?? '?'; restantes[mois] = (restantes[mois] ?? 0) + 1;
  }
  const echeance = (id: string) => { const v = dates.get(id)?.validThrough; if (!v) return 'sans date limite';
    return new Date(v).getTime() <= b.startedAt.getTime() ? 'date limite dépassée à la collecte suivante' : 'date limite ultérieure'; };
  const pays = (item: Item) => String(item.location ?? '?').split(',').map((part) => part.trim()).filter(Boolean).at(-1) ?? '?';
  console.log(JSON.stringify({
    avant: { lot: a.batchId, a: a.startedAt, pages: a.pages, diffusions: a.items.length, annonces: idsAvant.size },
    apres: { lot: b.batchId, a: b.startedAt, pages: b.pages, diffusions: b.items.length, annonces: idsApres.size },
    disparues: disparues.length, apparues: apparues.length,
    disparuesParContrat: tally(disparues, (item) => String(item.contract ?? '?')),
    disparuesParMetier: tally(disparues, (item) => String(item.job ?? '?')),
    disparuesParDernierMotDuLieu: tally(disparues, pays),
    restantesParDernierMotDuLieu: tally(b.items, pays),
    disparuesParEcheance: tally(disparues, (item) => echeance(annonce(item))),
    disparuesParMoisDePublication: tally(disparues, (item) => dates.get(annonce(item))?.postedAt?.slice(0, 7) ?? '?'),
    restantesParMoisDePublication: Object.entries(restantes).sort(),
    disparuesParMarque: tally(disparues, (item) => `brand=${String(item.brand_id)} externe=${String(item.is_external)} agregee=${String(item.is_aggregated)}`),
    restantesParMarque: tally(b.items, (item) => `brand=${String(item.brand_id)} externe=${String(item.is_external)} agregee=${String(item.is_aggregated)}`),
    disparuesParDomaine: tally(disparues, (item) => String(item.career_domain ?? item.careers_site_url?.split('/')[2] ?? '?')),
    exemplesDisparues: disparues.slice(0, 12).map((item) => ({ id: annonce(item), titre: item.title, lieu: item.location, contrat: item.contract, url: item.url,
      ...dates.get(annonce(item)) })),
    clesDUnItem: Object.keys(a.items[0] ?? {}),
  }, null, 1));
} finally {
  await prisma.$disconnect();
}
