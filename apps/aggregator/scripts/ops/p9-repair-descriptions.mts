/**
 * RÉPARER HORS LIGNE LES DESCRIPTIONS RESTÉES AU TEASER.
 *
 * L'enrichissement par fiche (`enrichFromJobPosting`) tourne dans l'ingestion, mais son `catch` garde
 * délibérément le teaser quand la fiche est illisible : *jamais d'offre perdue pour un détail*. C'est le bon
 * arbitrage à la collecte — il laisse en revanche des lignes au teaser quand l'échec était passager.
 *
 * Mesuré : 91 offres sous 400 caractères, dont douze re-servies récemment. Sur celles-ci la fiche publie une
 * description JSON-LD complète (7 646 caractères là où nous en stockions 202) : ce n'est donc pas une source
 * avare, c'est notre lecture qui a manqué. Les re-collecter dépendrait du tirage du publieur, dont la
 * pagination est instable ; la fiche, elle, est adressable directement par son URL.
 *
 * GARDES : on relit la VRAIE fiche, la concordance d'identifiant de `enrichFromJobPosting` reste la preuve
 * qu'on lit la bonne offre, et on n'écrit que si la description obtenue est PLUS LONGUE. `--apply` requis.
 *
 * usage: db.py production npx tsx scripts/ops/p9-repair-descriptions.mts --keys=a,b [--min=400] [--apply]
 */
import { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { fetchText } from '../../src/lib/http.js';
import { enrichFromJobPosting } from '../../src/ats/adapters/phenom.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const KEYS = (arg('keys') ?? 'hugo-boss-phenom,skechers-phenom').split(',');
const MIN = Number(arg('min') ?? 400);
const APPLY = process.argv.includes('--apply');
const p = new PrismaClient();

for (const key of KEYS) {
  const rows: any[] = await p.$queryRawUnsafe(
    `SELECT js."externalId", j.id "jobId", j.url, j.description
     FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
     WHERE js."sourceKey" = $1 AND j."isActive" AND length(j.description) < $2 AND j.url IS NOT NULL`,
    key, MIN);

  const limit = pLimit(4); // même politesse par hôte qu'à l'ingestion (D25, P8).
  let repaired = 0, unchanged = 0, failed = 0;
  const results = await Promise.all(rows.map((r) => limit(async () => {
    // L'identifiant que la fiche doit porter : le jobId du publieur, celui-là même que l'URL contient.
    const jobId = String(r.url).match(/\/job\/([^/?#]+)/)?.[1] ?? '';
    if (!jobId) return 'failed';
    try {
      const html = await fetchText(r.url, {});
      const out = enrichFromJobPosting({ description: r.description } as any, html, jobId);
      const next = out.description ?? '';
      if (next.length <= String(r.description ?? '').length) return 'unchanged';
      if (APPLY) await p.job.update({ where: { id: r.jobId }, data: { description: next } });
      return 'repaired';
    } catch { return 'failed'; }
  })));
  for (const v of results) { if (v === 'repaired') repaired++; else if (v === 'unchanged') unchanged++; else failed++; }
  console.log(JSON.stringify({ source: key, sousLeSeuil: rows.length, reparees: repaired, inchangees: unchanged, illisibles: failed, applique: APPLY }));
}
await p.$disconnect();
