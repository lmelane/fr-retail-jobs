#!/usr/bin/env node
/**
 * Sonde polie du portail Swatch Group (D-493), rejouable.
 *
 * Usage : node sonde.mjs <etiquette> <url> [<url>…]
 *
 * - Identité HTTP du collecteur (`CatwalksBot/1.0 (+https://catwalks.io/bot)`, celle de `lib/http.ts`),
 *   même `accept-language` que `fetchText`.
 * - Requêtes SÉQUENTIELLES, espacées de DELAI_MS (3 s par défaut) ; aucune relance automatique.
 * - Chaque corps est archivé compressé dans `../raw/<horodatage>-<etiquette>-<n>.<ext>.gz`, et une ligne JSON par
 *   requête (URL, statut, en-têtes de cache, taille, sha256, nombre de liens /job/, dernière page du pager) est
 *   ajoutée à `../sondes.jsonl`.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, '..', 'raw');
const LOG = join(HERE, '..', 'sondes.jsonl');
const UA = 'CatwalksBot/1.0 (+https://catwalks.io/bot)';
const DELAI_MS = Number(process.env.DELAI_MS ?? 3000);
const LAST_PAGE_LINK = /href="\?(?:[^"]*&amp;)?page=(\d+)"[^>]*>\s*<span[^>]*>\s*<i class="icon--last"/;

const [label, ...urls] = process.argv.slice(2);
if (!label || urls.length === 0) {
  console.error('usage: node sonde.mjs <etiquette> <url>…');
  process.exit(2);
}
if (urls.length > 40) {
  console.error('refus : plus de 40 requêtes dans une seule sonde');
  process.exit(2);
}
mkdirSync(RAW, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [n, url] of urls.entries()) {
  if (n > 0) await sleep(DELAI_MS);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let row;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7', accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString('utf8');
    const type = res.headers.get('content-type') ?? '';
    const ext = type.includes('json') ? 'json' : type.includes('xml') ? 'xml' : type.includes('html') ? 'html' : 'txt';
    const file = `${stamp}-${label}-${String(n).padStart(2, '0')}.${ext}.gz`;
    writeFileSync(join(RAW, file), gzipSync(bytes));
    const ids = new Set([...text.matchAll(/href="\/[a-z]{2}\/job\/(\d+)"/g)].map((m) => m[1]));
    const headers = Object.fromEntries([...res.headers].filter(([k]) => process.env.FULL_HEADERS === '1' || /cache|age|expires|date|etag|last-modified|x-drupal|akamai|server-timing|vary|location|content-type|content-language|x-generator/i.test(k)));
    row = { label, n, startedAt, ms: Date.now() - t0, url, status: res.status, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), file, jobIds: ids.size,
      lastPage: Number(LAST_PAGE_LINK.exec(text)?.[1] ?? NaN) || null, headers };
  } catch (error) {
    row = { label, n, startedAt, ms: Date.now() - t0, url, error: String(error).slice(0, 300) };
  }
  appendFileSync(LOG, `${JSON.stringify(row)}\n`);
  console.log(JSON.stringify({ n: row.n, status: row.status, ms: row.ms, bytes: row.bytes, jobIds: row.jobIds, lastPage: row.lastPage, error: row.error, url: row.url, headers: row.headers }));
}
