import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { fetchJson, fetchText } from '../lib/http.js';
import { htmlToPlainText } from '../lib/html.js';

/**
 * g2 — Rivoli Group : rejoue la recherche Typesense de la page Vacancies.
 *
 * La clé est une clé de RECHERCHE publique, lue en clair dans le HTML de
 * https://www.rivoligroup.com/careers/vacancies (`var TYPESENSE_API_KEY = …`,
 * `TYPESENSE_NODES = [{host:"typesense.rivoligroup.com",port:443}]`), et la
 * collection dans `data-typesense-collection="vacancy"`. Le front filtre
 * `page_locale := <locale du site>` et pagine par 6 ; ici on lit tout (250/page).
 * Lecture seule.
 */
const TYPESENSE = 'https://typesense.rivoligroup.com';
const API_KEY = 'XVzrzN4lSwOowagLCo3jidFzJoDnq7ww';
const COLLECTION = 'vacancy';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

type Doc = {
  id: string;
  title: string;
  url: string;
  page_locale: string;
  job_location?: string[];
  department?: string;
  public_date?: string;
  public_date_time_stamp?: number;
  page_index_content?: string;
};
type SearchResult = { found: number; hits: Array<{ document: Doc }> };

const t0 = Date.now();
const docs: Doc[] = [];
for (let page = 1; page <= 10; page++) {
  const r = await fetchJson<SearchResult>(
    `${TYPESENSE}/collections/${COLLECTION}/documents/search?q=*&query_by=title&per_page=250&page=${page}`,
    { headers: { 'x-typesense-api-key': API_KEY } },
  );
  docs.push(...r.hits.map((h) => h.document));
  if (docs.length >= r.found || r.hits.length === 0) {
    console.log(`typesense: found=${r.found}, lus=${docs.length}`);
    break;
  }
}

const byLocale = new Map<string, number>();
for (const d of docs) byLocale.set(d.page_locale, (byLocale.get(d.page_locale) ?? 0) + 1);
console.log(`   par locale: ${JSON.stringify(Object.fromEntries(byLocale))}`);

/** Une offre = un slug ; la version anglaise (en_AE) est préférée quand elle est indexée. */
/** Casse conservée pour l'URL (`Sales-Associate-EmiratiNationals` existe, sa minuscule répond 404) ; la clé est en minuscules. */
const slugOf = (url: string) => url.split('/vacancies/')[1]?.replace(/\/$/, '') ?? url;
const bySlug = new Map<string, Doc>();
for (const d of docs) {
  const slug = slugOf(d.url).toLowerCase();
  const current = bySlug.get(slug);
  if (!current || (current.page_locale !== 'en_AE' && d.page_locale === 'en_AE')) bySlug.set(slug, d);
}
console.log(`   offres uniques (par slug): ${bySlug.size}, dont ${[...bySlug.values()].filter((d) => d.page_locale === 'en_AE').length} avec document anglais`);

/** Pour un slug indexé seulement en arabe, la page anglaise existe (mesuré : 200) — on y lit titre + description. */
const limit = pLimit(4);
const jobs = await Promise.all(
  [...bySlug.entries()].map(([slug, d]) =>
    limit(async () => {
      const enUrl = `https://www.rivoligroup.com/careers/vacancies/${slugOf(d.url)}`;
      let title = d.title;
      let description = htmlToPlainText(d.page_index_content ?? '') ?? '';
      let url = d.url;
      if (d.page_locale !== 'en_AE') {
        try {
          const html = await fetchText(enUrl, { headers: { 'user-agent': UA } });
          const $ = cheerio.load(html);
          const h1 = $('main h1').first().text().trim();
          const body = $('.vacancies--detail .default-text-block').first().html();
          if (h1) title = h1;
          if (body) description = htmlToPlainText(body) ?? description;
          url = enUrl;
        } catch {
          /* la version arabe reste */
        }
      }
      return {
        externalId: slug,
        title,
        location: (d.job_location ?? []).join(', '),
        url,
        postedAt: d.public_date_time_stamp ? new Date(Number(d.public_date_time_stamp) * 1000) : undefined,
        department: d.department,
        description,
      };
    }),
  ),
);

console.log(
  `rivoli: ${jobs.length} offres | ${jobs.filter((j) => j.location).length} lieu | ${jobs.filter((j) => j.description.length > 200).length} desc | ${Math.round((Date.now() - t0) / 1000)}s`,
);
const ex = jobs.find((j) => /[a-z]/i.test(j.title)) ?? jobs[0];
if (ex) console.log(`   ex: ${ex.title.slice(0, 50)} @ ${ex.location} | ${ex.postedAt?.toISOString().slice(0, 10)} | ${ex.url}`);
console.log(`   titres restés en arabe: ${jobs.filter((j) => /[؀-ۿ]/.test(j.title)).length}`);
