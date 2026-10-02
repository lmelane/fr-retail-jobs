#!/usr/bin/env node
/**
 * Construit, hors réseau, les deux fixtures des témoins de l'adaptateur Swatch Group (D-493) depuis les lectures
 * archivées de ce dossier. Rejouable : les mêmes lectures donnent les mêmes octets (gzip sans horodatage).
 *
 *  - `swatchgroup-listes-partitions-20261002.json.gz` : pour chacune des deux lectures complètes du 02/10/2026
 *    (04:56–05:05 et 05:06–05:09 UTC), la dernière page annoncée et les liens d'offre de chaque page, dans l'ordre
 *    servi, pour le listing complet (`time=All`) et ses deux partitions (`time=20`, `time=21`).
 *  - `swatchgroup-pages-reelles-20261002.json.br` : neuf pages HTML réelles de la seconde lecture (pages 0, dernière
 *    et suivante de chaque lecture) et la page 0 réelle filtrée `position=64` (pager de cinq pages sans « Dernier »).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants, gunzipSync, gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIT = join(HERE, '..');
const FIXTURES = join(HERE, '..', '..', '..', '..', 'apps', 'aggregator', 'src', 'ats', 'adapters', '__fixtures__');
const read = (file) => JSON.parse(readFileSync(join(AUDIT, 'lectures', file), 'utf8'));
const sweep = (file) => {
  const r = read(file);
  return { at: r.summary.startedAt, until: r.summary.endedAt, last: r.summary.lastPage, pages: r.pages.map((p) => p.links) };
};
const listes = {
  source: 'www.swatchgroup.com/fr/job-finder?page=N&search_api_fulltext=&jf_country=All&domain=All&position=All&contract=All&time={All,20,21}, lu le 02/10/2026 (liens d offre « langue:identifiant » par page, dans l ordre servi)',
  lectures: {
    1: { All: sweep('L2-form-fr.json'), 20: sweep('L4-time20-fr.json'), 21: sweep('L4-time21-fr.json') },
    2: { All: sweep('L5-full-fr.json'), 20: sweep('L5-time20-fr.json'), 21: sweep('L5-time21-fr.json') },
  },
};
const page = (file) => gunzipSync(readFileSync(join(AUDIT, file))).toString('utf8');
const pages = {
  'All-p0': page('lectures/L5-full-fr-p00.html.gz'),
  'All-p33': page('lectures/L5-full-fr-p33.html.gz'),
  'All-p34': page('lectures/L5-full-fr-p34.html.gz'),
  '20-p0': page('lectures/L5-time20-fr-p00.html.gz'),
  '20-p27': page('lectures/L5-time20-fr-p27.html.gz'),
  '20-p28': page('lectures/L5-time20-fr-p28.html.gz'),
  '21-p0': page('lectures/L5-time21-fr-p00.html.gz'),
  '21-p5': page('lectures/L5-time21-fr-p05.html.gz'),
  '21-p6': page('lectures/L5-time21-fr-p06.html.gz'),
  'position64-p0': page('raw/2026-10-02T0502-s7-partitions-00.html.gz'),
};
const gz = (value) => gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 });
writeFileSync(join(FIXTURES, 'swatchgroup-listes-partitions-20261002.json.gz'), gz(listes));
// Brotli, fenêtre de 16 Mio : les dix pages partagent leur gabarit (≈ 80 Ko chacune), que gzip (fenêtre de 32 Ko) ne
// sait pas mettre en commun d'une page à l'autre.
writeFileSync(join(FIXTURES, 'swatchgroup-pages-reelles-20261002.json.br'), brotliCompressSync(Buffer.from(JSON.stringify(pages)),
  { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24 } }));
console.log('fixtures écrites dans', FIXTURES);
