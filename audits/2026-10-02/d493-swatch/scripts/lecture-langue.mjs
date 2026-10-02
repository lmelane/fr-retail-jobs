#!/usr/bin/env node
/**
 * Lecture complète du listing d'UNE langue (D-493), rejouable : pages 0 → dernière (lien « Dernier » de la page 0),
 * plus la page suivante (qui doit être vide). Séquentiel, DELAI_MS entre deux requêtes (2,5 s par défaut).
 *
 * Usage : node lecture-langue.mjs <lang> <etiquette> [requete-supplementaire]
 *   ex.   node lecture-langue.mjs fr L1
 *         node lecture-langue.mjs fr L1-tri 'sort_by=x'
 *
 * Sortie : `../lectures/<etiquette>-<lang>.json` : pour chaque page, l'heure, le statut, le sha256 et les
 * identifiants d'offre dans l'ordre servi (avec le préfixe de langue de leur lien). Résumé sur stdout.
 * Les pages HTML ne sont pas archivées une à une (35 × 80 Ko) : leurs empreintes le sont, et les pages qui
 * deviennent des fixtures sont relues et archivées à part.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'lectures');
const UA = 'CatwalksBot/1.0 (+https://catwalks.io/bot)';
const DELAI_MS = Number(process.env.DELAI_MS ?? 2500);
// ARCHIVE=1 : archive la page 0, la dernière et la suivante (les fixtures) ; ARCHIVE=all : toutes les pages.
const ARCHIVE = process.env.ARCHIVE ?? '';
const LAST_PAGE_LINK = /href="\?(?:[^"]*&amp;)?page=(\d+)"[^>]*>\s*<span[^>]*>\s*<i class="icon--last"/;
const [lang, label, extra] = process.argv.slice(2);
if (!/^[a-z]{2}(-[a-z]+)?$/.test(lang ?? '') || !label) { console.error('usage: node lecture-langue.mjs <lang> <etiquette> [requete]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(page, keep = false) {
  const url = `https://www.swatchgroup.com/${lang}/job-finder?page=${page}${extra ? `&${extra}` : ''}`;
  const at = new Date().toISOString();
  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7' }, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  const html = await res.text();
  const links = [];
  const seen = new Set();
  for (const m of html.matchAll(/href="\/([a-z]{2})\/job\/(\d+)"/g)) if (!seen.has(m[2])) { seen.add(m[2]); links.push(`${m[1]}:${m[2]}`); }
  if (ARCHIVE === 'all' || (ARCHIVE === '1' && keep)) writeFileSync(join(OUT, `${label}-${lang}-p${String(page).padStart(2, '0')}.html.gz`), gzipSync(html));
  const timing = res.headers.get('server-timing') ?? '';
  const cdn = /cdn-cache; desc=([A-Z_]+)/.exec(timing)?.[1] ?? null;
  const originMs = Number(/origin; dur=(\d+)/.exec(timing)?.[1] ?? NaN);
  const edge = /ak_p; desc="\d+_(\d+)_/.exec(timing)?.[1] ?? null;
  return { page, at, url, status: res.status, cdn, originMs: Number.isNaN(originMs) ? null : originMs, edge, sha256: createHash('sha256').update(html).digest('hex'), lastPage: Number(LAST_PAGE_LINK.exec(html)?.[1] ?? NaN) || null,
    maxPageLink: Math.max(-1, ...[...html.matchAll(/class="page-link" href="\?[^"]*page=(\d+)"/g)].map((m) => Number(m[1]))), links };
}

const pages = [];
const first = await get(0, true);
pages.push(first);
if (first.status !== 200 || (!first.lastPage && first.maxPageLink < 0)) { console.error('page 0 inattendue', first.status, first.lastPage); }
// Sans lien « Dernier » (5 pages ou moins), la dernière page est le plus grand numéro du pager.
const last = first.lastPage ?? Math.max(0, first.maxPageLink);
for (let page = 1; page <= last + 1; page += 1) {
  await sleep(DELAI_MS);
  pages.push(await get(page, page >= last));
}
const ids = pages.flatMap((p) => p.links.map((l) => l.split(':')[1]));
const distinct = new Set(ids);
const pageSize = first.links.length;
const lastCount = pages[last]?.links.length ?? 0;
const announced = last * pageSize + lastCount;
const shape = pages.every((p) => (p.page < last ? p.links.length === pageSize : p.page === last ? lastCount >= 1 && lastCount <= pageSize : p.links.length === 0));
const summary = { lang, label, extra: extra ?? null, startedAt: first.at, endedAt: pages.at(-1).at, lastPage: last, pageSize, lastCount, announced, shape,
  served: ids.length, distinct: distinct.size, repeated: ids.length - distinct.size, statuses: [...new Set(pages.map((p) => p.status))],
  lastPageEverywhere: [...new Set(pages.filter((p) => p.lastPage).map((p) => p.lastPage))],
  cdn: Object.fromEntries([...new Set(pages.map((p) => p.cdn))].map((k) => [k, pages.filter((p) => p.cdn === k).length])),
  edges: [...new Set(pages.map((p) => p.edge))] };
writeFileSync(join(OUT, `${label}-${lang}.json`), JSON.stringify({ summary, pages }, null, 1));
console.log(JSON.stringify(summary));
