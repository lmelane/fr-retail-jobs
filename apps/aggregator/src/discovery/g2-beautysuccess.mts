import { fetchWithRetry } from '../lib/http.js';
import { htmlToPlainText } from '../lib/html.js';

/**
 * g2 — Beauty Success : rejoue l'API REST GeoDirectory du site WordPress.
 *
 * Le site (recrutement.beautysuccess.fr, WordPress + GeoDirectory) publie
 * chaque offre comme un `gd_place` exposé par le plugin sur
 * `/wp-json/geodir/v2/offres` (la route `/wp/v2/offres` annoncée par
 * `/wp/v2/types` répond 404). Lecture seule.
 */
const ORIGIN = 'https://recrutement.beautysuccess.fr';
const PER_PAGE = 100;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

type GeoDirPost = {
  id: string | number;
  title?: { rendered?: string };
  link?: string;
  date?: string;
  content?: { raw?: string; rendered?: string };
  city?: string;
  region?: string;
  country?: string;
  zip?: string;
  latitude?: string;
  longitude?: string;
  type_de_contrat?: { rendered?: string };
  temps_de_travail?: { rendered?: string };
  apply_url?: string;
  description_de_lemployeur?: string;
  profil_recherch?: string;
};

const t0 = Date.now();
const all: GeoDirPost[] = [];
let total = 0;
for (let page = 1; page <= 20; page++) {
  const response = await fetchWithRetry(`${ORIGIN}/wp-json/geodir/v2/offres?per_page=${PER_PAGE}&page=${page}`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
  });
  total = Number(response.headers.get('x-wp-total'));
  const totalPages = Number(response.headers.get('x-wp-totalpages'));
  const posts = JSON.parse((await response.text()).replace(/^﻿/, '')) as GeoDirPost[];
  all.push(...posts);
  if (!posts.length || page >= totalPages) break;
}

const jobs = all.map((p) => ({
  externalId: String(p.id),
  title: htmlToPlainText(p.title?.rendered) ?? '',
  location: [p.city, p.zip, p.country].filter(Boolean).join(', '),
  city: p.city,
  postalCode: p.zip,
  region: p.region,
  country: p.country,
  url: p.link,
  postedAt: p.date,
  contract: p.type_de_contrat?.rendered,
  description: htmlToPlainText(
    [p.content?.rendered ?? p.content?.raw, p.description_de_lemployeur, p.profil_recherch].filter(Boolean).join('\n'),
  ) ?? '',
  applyUrl: p.apply_url,
}));

const uniq = new Set(jobs.map((j) => j.externalId));
console.log(
  `beauty-success: ${jobs.length} offres (x-wp-total ${total}, ${uniq.size} ids uniques) | ${jobs.filter((j) => j.location).length} lieu | ${jobs.filter((j) => j.description.length > 200).length} desc | ${Math.round((Date.now() - t0) / 1000)}s`,
);
if (jobs[0]) console.log(`   ex: ${jobs[0].title.slice(0, 50)} @ ${jobs[0].location} | ${jobs[0].contract} | ${jobs[0].url}`);
console.log(`   apply hébergé chez: ${new Set(jobs.map((j) => (j.applyUrl ?? '').replace(/^https?:\/\/([^/]+).*/, '$1')))}`);
