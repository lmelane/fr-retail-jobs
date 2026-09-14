/**
 * RÉCONCILIER LES CINQ SURFACES PUBLIQUES, PAR IDENTIFIANT — lecture seule.
 *
 * Une offre existe pour le candidat sur cinq surfaces : la base, l'API, le sitemap, sa fiche HTTP et son
 * balisage `JobPosting`. Elles peuvent diverger sans qu'aucun total ne bouge — une offre fermée qui reste au
 * sitemap et une offre vivante qui en disparaît se compensent parfaitement dans un compte. C'est pourquoi on
 * compare des ENSEMBLES D'IDENTIFIANTS, jamais des cardinaux (leçon P5).
 *
 * Le sitemap est découpé en tranches : les lire toutes est obligatoire, sinon « absent du sitemap » ne
 * signifie que « absent de la tranche que j'ai regardée ».
 *
 * usage: db.py readonly npx tsx scripts/ops/public-chain-reconcile.mts --jobs=<id,id,…> [--base=https://…] [--out=<f.json>]
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { readAllPages } from '../../src/ops/apiPagination.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const jobIds = (arg('jobs') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const base = arg('base') ?? 'https://modecareers.com';
if (!jobIds.length) {
  console.error('usage: public-chain-reconcile.mts --jobs=<id,id,…> [--base=…] [--out=…]');
  process.exit(2);
}

const prisma = new PrismaClient();

/** Toutes les tranches du sitemap, réunies. Une seule tranche lue rendrait « absent » indistinguable de « ailleurs ». */
async function readSitemapUrls(): Promise<{ urls: Set<string>; chunks: number; problems: string[] }> {
  const problems: string[] = [];
  const index = await fetch(`${base}/sitemap.xml`).then((r) => r.text());
  const chunkUrls = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  const urls = new Set<string>();
  for (const chunk of chunkUrls) {
    try {
      const body = await fetch(chunk).then((r) => r.text());
      for (const m of body.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(m[1]!);
    } catch (error) {
      // Une tranche illisible invalide la conclusion « absent du sitemap » : on le DIT.
      problems.push(`tranche illisible : ${chunk} — ${(error as Error).message.slice(0, 80)}`);
    }
  }
  return { urls, chunks: chunkUrls.length, problems };
}

/**
 * L'API publique, paginée JUSQU'AU BOUT via la lecture commune (`ops/apiPagination`).
 *
 * Le plafond était une constante de 50 pages. À 25 offres par page cela couvre 1 250 offres — Skechers en
 * publie 1 656 sur **67 pages** : les 406 suivantes ressortaient « absentes de l'API » alors que l'API les
 * sert parfaitement. La borne vient désormais du `pageCount` annoncé, et un arrêt prématuré LÈVE plutôt que
 * de rendre un ensemble partiel qu'on lirait comme complet.
 */
async function readApiIds(maison: string): Promise<Set<string>> {
  const items = await readAllPages<string>(async (page) => {
    const r = await fetch(`${base}/api/jobs?maison=${encodeURIComponent(maison)}&page=${page}`);
    if (!r.ok) return null; // `null` = illisible : la lecture commune lèvera, elle ne tronquera pas.
    const d: any = await r.json();
    const rows: any[] = d.data ?? d.jobs ?? d.items ?? [];
    return { items: rows.filter((j) => j?.id).map((j) => String(j.id)), pageCount: d.pageCount };
  }, `API ${maison}`);
  return new Set(items);
}

const jobs = await prisma.job.findMany({
  where: { id: { in: jobIds } },
  select: {
    id: true, title: true, isActive: true, closedAt: true, withdrawnAt: true, url: true,
    company: { select: { name: true } },
    sources: { where: { isActive: true }, select: { sourceKey: true } },
  },
});

const sitemap = await readSitemapUrls();
const maisons = [...new Set(jobs.map((j) => j.company?.name).filter(Boolean))] as string[];
const apiIds = new Set<string>();
for (const m of maisons) for (const id of await readApiIds(m)) apiIds.add(id);

const rows: any[] = [];
for (const j of jobs) {
  // Le sitemap porte des URL à slug canonique : on cherche l'identifiant, pas une URL exacte.
  const inSitemap = [...sitemap.urls].some((u) => u.includes(j.id));
  const canonical = [...sitemap.urls].find((u) => u.includes(j.id)) ?? null;

  const page = await fetch(`${base}/offre/${j.id}`, { redirect: 'follow' });
  const html = await page.text();
  const hasJobPosting = html.replace(/\s/g, '').includes('"@type":"JobPosting"');

  const expectedPublished = j.isActive;
  const ecarts: string[] = [];
  if (expectedPublished !== inSitemap) {
    ecarts.push(inSitemap ? 'PUBLIÉE AU SITEMAP alors que fermée' : 'absente du sitemap alors qu\'active');
  }
  if (j.isActive && page.status !== 200) ecarts.push(`fiche ${page.status} alors qu'active`);
  if (!j.isActive && page.status !== 410) ecarts.push(`fiche ${page.status} alors que fermée (410 attendu)`);
  if (!j.isActive && hasJobPosting) ecarts.push('JobPosting présent sur une offre FERMÉE');
  if (j.isActive !== apiIds.has(j.id)) {
    ecarts.push(apiIds.has(j.id) ? 'présente dans l\'API alors que fermée' : 'absente de l\'API alors qu\'active');
  }

  rows.push({
    jobId: j.id,
    titre: (j.title ?? '').slice(0, 40),
    base: j.isActive ? 'ACTIVE' : 'FERMÉE',
    closedAt: j.closedAt?.toISOString().slice(0, 19) ?? null,
    withdrawnAt: j.withdrawnAt?.toISOString().slice(0, 19) ?? null,
    api: apiIds.has(j.id) ? 'présente' : 'absente',
    sitemap: inSitemap ? 'présente' : 'absente',
    fiche: page.status,
    jobPosting: hasJobPosting,
    urlCanonique: canonical,
    attestationsActives: j.sources.map((s) => s.sourceKey),
    ecarts,
    statut: ecarts.length ? 'ÉCART' : 'CONFORME',
  });
}

const report = {
  at: new Date().toISOString(),
  base,
  sitemapChunks: sitemap.chunks,
  sitemapUrls: sitemap.urls.size,
  sitemapProblems: sitemap.problems,
  maisonsInterrogees: maisons,
  apiIds: apiIds.size,
  rows,
  conformes: rows.filter((r) => r.statut === 'CONFORME').length,
  ecarts: rows.filter((r) => r.statut === 'ÉCART').length,
};

const out = arg('out');
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
await prisma.$disconnect();
if (report.ecarts > 0 || sitemap.problems.length) process.exitCode = 1;
