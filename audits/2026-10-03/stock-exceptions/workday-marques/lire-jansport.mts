/**
 * LE SITE WORKDAY `jansport_careers` (tenant VF) TEL QUE LA COLLECTE DU 02/10/2026 L'A ARCHIVÉ — lecture seule, sans réseau.
 *
 *   CATWALKS_DB_ACCESS=… python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/2026-10-03/stock-exceptions/workday-marques/lire-jansport.mts [--batch=<id>]
 *
 * Pour chaque réponse archivée du lot (liste et fiches) : l'adresse, le statut, et ce qui dit QUI publie — le total et
 * les intitulés de la liste ; pour chaque fiche, l'intitulé, le lieu, l'entité juridique, le logo, l'adresse publique et
 * les noms de marques que la description cite. Sert de preuve à la certification SINGLE_BRAND (D-522 §6).
 */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../../apps/aggregator/src/capture/store.js';

const batch = process.argv.find((a) => a.startsWith('--batch='))?.slice(8) ?? '538a6701-0157-4cd3-b5bc-55c1ea1e55f0';
const MARQUES = /\b(JanSport|The North Face|Vans|Timberland|Kipling|Eastpak|Napapijri|Smartwool|Icebreaker|Altra|Dickies|Supreme|VF)\b/g;
const prisma = new PrismaClient({ log: [] });
try {
  const rows = await prisma.rawCapture.findMany({ where: { batchId: batch }, orderBy: { sequence: 'asc' }, select: { requestUrl: true, method: true, status: true, blobHash: true } });
  for (const r of rows) {
    const body = r.blobHash ? JSON.parse((await readRawBlob(prisma, r.blobHash)).toString('utf8')) : null;
    if (body?.jobPostings) {
      console.log(JSON.stringify({ url: r.requestUrl, status: r.status, total: body.total, intitules: body.jobPostings.map((p: { title: string; locationsText?: string }) => `${p.title} | ${p.locationsText ?? ''}`) }));
    } else if (body?.jobPostingInfo) {
      const i = body.jobPostingInfo;
      const cites = [...new Set(String(i.jobDescription ?? '').replace(/<[^>]+>/g, ' ').match(MARQUES) ?? [])];
      console.log(JSON.stringify({ url: r.requestUrl, status: r.status, titre: i.title, lieu: i.location, entite: body.hiringOrganization?.name ?? null,
        logo: i.logoImage?.alt ?? null, adresse: i.externalUrl, marquesCitees: cites }));
    } else console.log(JSON.stringify({ url: r.requestUrl, status: r.status, method: r.method }));
  }
} finally { await prisma.$disconnect(); }
