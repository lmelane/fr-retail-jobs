/**
 * LES PAGES DE LISTE WORKDAY D'UNE CAPTURE, dans l'ordre de la collecte — lecture seule, aucun éditeur contacté.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/workday-pages-liste.mts --batch=<id de CaptureBatch> [--lignes-sans-chemin] [--pages] [--ordre]
 *
 * Le corps d'une requête de liste n'est pas archivé, seule son empreinte l'est (`requestData.logical.bodyHash`) :
 * l'offset se retrouve en recalculant l'empreinte du corps que l'adaptateur envoie pour chaque offset candidat
 * (`{"appliedFacets":{},"limit":20,"offset":N,"searchText":""}`). Pour chaque page : l'offset, le `total` annoncé,
 * le nombre de lignes, les identifiants neufs, répétés (déjà lus plus haut) et les lignes sans `externalPath`.
 * Sert à dire POURQUOI une énumération est réfutée (D-482, 30/09/2026), sans recontacter l'éditeur.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readRawBlob } from '../../src/capture/store.js';
import { readRequestData } from '../../src/capture/requestDataRead.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const flag = (n: string) => process.argv.includes(`--${n}`);
const batchId = arg('batch');
if (!batchId) { console.error('usage: workday-pages-liste.mts --batch=<id>'); process.exit(2); }
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const offsets = new Map<string, number>();
for (let offset = 0; offset <= 6000; offset += 10) offsets.set(sha(JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' })), offset);
type Posting = { title?: string; externalPath?: string; bulletFields?: string[]; locationsText?: string; postedOn?: string };
const prisma = new PrismaClient({ log: [] });
try {
  const rows = await prisma.rawCapture.findMany({ where: { batchId, method: 'POST', requestUrl: { endsWith: '/jobs' } }, orderBy: { sequence: 'asc' } });
  const vus = new Map<string, number>();
  /** L'ordre servi, rang par rang (`--ordre`) : compare deux lectures du même tableau. */
  const ordre: string[] = [];
  const sansChemin = new Map<string, { ligne: Posting; pages: number[]; positions: number[]; voisins: string[] }>();
  const pages = [];
  for (const row of rows) {
    const request = await readRequestData(prisma, row);
    const offset = request ? offsets.get(request.logical.bodyHash) : undefined;
    const body = row.blobHash ? (await readRawBlob(prisma, row.blobHash)).toString('utf8') : '';
    let page: { total?: number; jobPostings?: Posting[] } = {};
    try { page = JSON.parse(body); } catch { /* corps non JSON, compté comme tel */ }
    const postings = page.jobPostings ?? [];
    let neufs = 0, repetes = 0, lignesSansChemin = 0;
    const repetesIds: string[] = [];
    for (const [index, job] of postings.entries()) {
      ordre.push(job.externalPath?.split('/').filter(Boolean).pop() ?? 'sans-chemin');
      if (!job.externalPath) {
        lignesSansChemin++;
        const cle = JSON.stringify(job);
        if (!sansChemin.has(cle)) sansChemin.set(cle, { ligne: job, pages: [], positions: [], voisins: [] });
        const entree = sansChemin.get(cle)!;
        entree.pages.push(offset ?? -1);
        // Le rang dans le tableau et les identifiants qui l'encadrent : une ligne servie deux fois par un tri instable
        // tombe à une frontière de page ; deux lignes distinctes gardent chacune leur rang d'une lecture à l'autre.
        entree.positions.push(offset === undefined ? -1 : offset + index);
        const voisin = (i: number) => postings[i]?.externalPath?.split('/').filter(Boolean).pop() ?? (postings[i] ? 'sans-chemin' : 'bord-de-page');
        entree.voisins.push(`${voisin(index - 1)} | ${voisin(index + 1)}`);
        continue;
      }
      const id = job.externalPath.split('/').filter(Boolean).pop()!;
      if (vus.has(id)) { repetes++; repetesIds.push(`${id}(déjà à ${vus.get(id)})`); } else { vus.set(id, offset ?? -1); neufs++; }
    }
    pages.push({ sequence: row.sequence, offset: offset ?? `inconnu:${request?.logical.bodyHash.slice(0, 12)}`, statut: row.status, total: page.total, lignes: postings.length, neufs, repetes, lignesSansChemin,
      ...(repetesIds.length ? { repetesIds } : {}) });
  }
  const totaux = [...new Set(pages.map((p) => p.total).filter((t) => t))];
  console.log(JSON.stringify({ capture: batchId, requetesDeListe: rows.length, totauxAnnonces: totaux,
    totauxParPage: pages.map((p) => `${p.offset}:${p.total ?? 0}`).filter((s) => !s.endsWith(':0')),
    identifiantsDistincts: vus.size, lignesSansCheminDistinctes: sansChemin.size, repetitions: pages.reduce((s, p) => s + p.repetes, 0),
    pagesAvecRepetition: pages.filter((p) => p.repetes).map((p) => ({ offset: p.offset, repetesIds: p.repetesIds })),
    ...(flag('lignes-sans-chemin') ? { sansChemin: [...sansChemin.values()] } : {}),
    ...(flag('pages') ? { pages } : {}), ...(flag('ordre') ? { ordre } : {}) }, null, 1));
} finally {
  await prisma.$disconnect();
}
