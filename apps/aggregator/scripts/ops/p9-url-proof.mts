/**
 * PROUVER LES URLS PUBLIQUES construites par l'adaptateur.
 *
 * CareerConnect ne livre AUCUNE URL dans sa liste : l'adaptateur dérive `/job/<jobId>/<slug>`. Un gabarit
 * dérivé est une hypothèse tant qu'on ne l'a pas suivi jusqu'à une vraie fiche — et une offre dont le lien
 * « Postuler » mène ailleurs est pire qu'une offre absente.
 *
 * usage: db.py readonly npx tsx scripts/ops/p9-url-proof.mts --key=<source> --n=20 [--out=<f.json>]
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { CRAWLER_IDENTITY } from '../../src/lib/crawlerIdentity.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const key = arg('key')!;
const n = Number(arg('n') ?? 20);
const p = new PrismaClient();

/**
 * Échantillon RÉPARTI : on prend d'abord une offre par pays, puis on complète.
 *
 * Un simple `DISTINCT ON (countryCode)` plafonne au nombre de pays — Hugo Boss n'en couvre que 19, donc
 * demander 20 preuves en aurait rendu 19 **sans le dire**. Le rang par pays règle les deux besoins à la
 * fois : les premiers de chaque pays sortent d'abord (couverture), les suivants complètent (volume).
 */
const rows: any[] = await p.$queryRawUnsafe(
  `SELECT url, title, "countryCode", "externalId" FROM (
     SELECT j.url, j.title, j."countryCode", js."externalId",
            ROW_NUMBER() OVER (PARTITION BY j."countryCode" ORDER BY j.id) rang
     FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
     WHERE js."sourceKey" = $1 AND j."isActive" AND j.url IS NOT NULL AND j.url <> ''
   ) t ORDER BY rang, "countryCode" LIMIT $2`, key, n);
if (rows.length < n) console.error(`ATTENTION : ${rows.length} offres échantillonnables pour ${n} demandées`);

const results: any[] = [];
for (const r of rows) {
  try {
    const res = await fetch(r.url, { headers: { 'user-agent': CRAWLER_IDENTITY }, redirect: 'follow', signal: AbortSignal.timeout(25_000) });
    const body = res.ok ? await res.text() : '';
    const id = String(r.externalId).match(/\d+/)?.[0] ?? '';
    results.push({
      externalId: r.externalId, country: r.countryCode, url: r.url, status: res.status, finalUrl: res.url,
      // La page doit porter l'identifiant ET ne pas être une page de recherche générique.
      carriesId: id ? body.includes(id) : null,
      isSearchPage: /search-results|Search Results/i.test(body.slice(0, 4000)),
      titleSeen: r.title ? body.toLowerCase().includes(String(r.title).toLowerCase().slice(0, 25)) : null,
    });
  } catch (e: any) { results.push({ externalId: r.externalId, url: r.url, status: 0, error: String(e.message).slice(0, 80) }); }
}
const ok = results.filter((x) => x.status === 200 && x.carriesId && !x.isSearchPage);
console.log(JSON.stringify({ key, testées: results.length, conformes: ok.length,
  http200: results.filter((x) => x.status === 200).length,
  pagesDeRecherche: results.filter((x) => x.isSearchPage).length,
  sansIdentifiant: results.filter((x) => x.status === 200 && !x.carriesId).length }, null, 1));
const out = arg('out'); if (out) writeFileSync(out, JSON.stringify({ key, results }, null, 2));
await p.$disconnect();
