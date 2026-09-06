import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { fetchText } from '../lib/http.js';
import { htmlToPlainText } from '../lib/html.js';

/**
 * g2 — Nocibé : portail « propulsé par Eqwa » (recrutement-nocibe.fr).
 *
 * La page `front-jobs.html` rend TOUTES les offres dans un seul tableau HTML
 * (DataTables côté client, aucune pagination serveur) ; la page de détail
 * `front-jobs-detail.html?id_job=N` porte la description dans `.job-detail-desc`.
 * Aucun JSON-LD nulle part, d'où le 0 du crawler générique. Lecture seule.
 */
const ORIGIN = 'https://recrutement-nocibe.fr';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'user-agent': UA };

const t0 = Date.now();
const html = await fetchText(`${ORIGIN}/front-jobs.html`, { headers: HEADERS });
const $ = cheerio.load(html);

type Row = { externalId: string; title: string; url: string; postedAt?: string; contract?: string; region?: string; city?: string; postalCode?: string };
const rows: Row[] = [];
$('table.with-datatable tbody tr').each((_, tr) => {
  const a = $(tr).find('a[href*="id_job="]').first();
  const href = a.attr('href') ?? '';
  const id = /id_job=(\d+)/.exec(href)?.[1];
  if (!id) return;
  const tds = $(tr).find('td');
  const locTd = tds.eq(1);
  const small = locTd.find('small').first().text().trim();
  const region = locTd.clone().children().remove().end().text().trim();
  const [, postalCode, city] = /^(\d{5})\s+(.+)$/.exec(small) ?? [];
  rows.push({
    externalId: id,
    title: (a.attr('title') ?? a.text()).trim(),
    url: new URL(href, ORIGIN).toString(),
    postedAt: tds.eq(0).attr('data-sort'),
    contract: tds.eq(2).text().trim() || undefined,
    region: region || undefined,
    city: city?.trim(),
    postalCode,
  });
});
console.log(`listing: ${rows.length} lignes, ${new Set(rows.map((r) => r.externalId)).size} id_job uniques (${Math.round((Date.now() - t0) / 1000)}s)`);

const sample = process.argv.includes('--all') ? rows : rows.slice(0, 40);
const limit = pLimit(4);
const jobs = await Promise.all(
  sample.map((row) =>
    limit(async () => {
      try {
        const page = await fetchText(row.url, { headers: HEADERS });
        const $d = cheerio.load(page);
        const description = htmlToPlainText($d('.job-detail-desc').html() ?? '') ?? '';
        const location = $d('.job-detail-reference dt')
          .filter((_, dt) => /Localisation/i.test($d(dt).text()))
          .next('dd')
          .text()
          .trim();
        return { ...row, description, detailLocation: location };
      } catch (error) {
        return { ...row, description: '', error: (error as Error).message.slice(0, 80) };
      }
    }),
  ),
);

const withLoc = jobs.filter((j) => j.city || j.region).length;
const withDesc = jobs.filter((j) => j.description.length > 200).length;
console.log(
  `nocibe: ${jobs.length} offres détaillées (sur ${rows.length}) | ${withLoc} lieu | ${withDesc} desc | ${Math.round((Date.now() - t0) / 1000)}s`,
);
const ex = jobs[0];
if (ex) console.log(`   ex: ${ex.title.slice(0, 50)} @ ${ex.city ?? '-'} (${ex.postalCode ?? ''}, ${ex.region ?? ''}) | ${ex.contract} | ${ex.postedAt} | desc ${ex.description.length} c`);
const errors = jobs.filter((j) => 'error' in j);
if (errors.length) console.log(`   erreurs: ${errors.length} — ${(errors[0] as any).error}`);
