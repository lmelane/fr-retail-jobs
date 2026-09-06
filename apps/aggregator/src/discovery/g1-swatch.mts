import { fetchText } from '../lib/http.js';

/**
 * g1 — Swatch Group job-finder : curl expire (0 octet reçu), Playwright passe.
 * Ce script mesure ce que le transport du pipeline (fetchText, porte par hôte)
 * obtient réellement, puis compte la pagination Drupal `?page=N` (0-based).
 * Lecture seule.
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const base = 'https://www.swatchgroup.com/fr/job-finder';
const maxPages = Number(process.argv[2] ?? 3);

const seen = new Set<string>();
for (let page = 0; page < maxPages; page++) {
  const t0 = Date.now();
  let html: string;
  try {
    html = await fetchText(`${base}?page=${page}`, { headers: { 'user-agent': UA, accept: 'text/html' } });
  } catch (error) {
    console.log(`page ${page}: ERREUR ${(error as Error).message.slice(0, 160)}`);
    break;
  }
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const jobLinks = [...new Set(links.filter((l) => /\/job\/|\/jobs\/|\/emploi|\/stellen|job-finder\/|\/offre/i.test(l)))];
  const fresh = jobLinks.filter((l) => !seen.has(l));
  for (const l of fresh) seen.add(l);
  const total = html.match(/(\d[\d\s’']*)\s*(offres|résultats|jobs|postes|emplois)/i)?.[0];
  const last = html.match(/page=(\d+)[^"]*"[^>]*>\s*(?:<[^>]+>\s*)*(?:Dernier|Last|»|&raquo;)/i)?.[1];
  console.log(`page ${page}: ${html.length} o, ${jobLinks.length} liens offre (${fresh.length} nouveaux), total="${total ?? '?'}" last="${last ?? '?'}" ${Date.now() - t0} ms`);
  if (page === 0) {
    console.log('  ex liens:', jobLinks.slice(0, 5).join('\n            '));
    const pagers = [...new Set([...html.matchAll(/job-finder\?page=(\d+)/g)].map((m) => m[1]))];
    console.log('  pager:', pagers.join(','));
  }
  if (fresh.length === 0) break;
}
console.log(`total liens uniques: ${seen.size}`);
