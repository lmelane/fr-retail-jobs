import { fetchWithRetry } from '../lib/http.js';

/**
 * PVH — careers.pvh.com : la recherche est un formulaire Turbo
 * (Accept: text/vnd.turbo-stream.html) ; le sitemap liste 1 347 offres.
 * On mesure : (1) la réponse turbo-stream paginée, (2) l'état des réponses
 * après plusieurs requêtes (AWS WAF challenge.js présent sur la page).
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function get(url: string, accept: string) {
  const r = await fetchWithRetry(url, { headers: { 'user-agent': UA, accept } });
  const body = await r.text();
  const links = [...new Set([...body.matchAll(/href="(\/jobs\/(?!search)[^"?#]+)"/g)].map((m) => m[1]))];
  const waf = r.headers.get('x-amzn-waf-action') ?? '';
  console.log(`${r.status} ${String(body.length).padStart(7)}o waf=${waf || '-'} ct=${(r.headers.get('content-type') ?? '').slice(0, 30)} liens=${links.length} ${url} ${accept.slice(0, 20)}`);
  return { body, links };
}

const p1 = await get('https://careers.pvh.com/jobs/search?page=1', 'text/vnd.turbo-stream.html');
const p2 = await get('https://careers.pvh.com/jobs/search?page=2', 'text/vnd.turbo-stream.html');
const p3 = await get('https://careers.pvh.com/jobs/search?page=45', 'text/vnd.turbo-stream.html');
const total = p1.body.match(/(\d[\d,]*)\s*(?:jobs|results|positions|matching)/i)?.[0];
const pager = [...new Set((p1.body.match(/page=\d+/g) ?? []))];
console.log(`total: ${total} ; pager: ${pager.slice(-4).join(' ')} ; p1∩p2: ${p1.links.filter((l) => p2.links.includes(l)).length} ; ex p2 ${p2.links.slice(0, 2).join(' ')}`);
const turboTitle = p1.body.match(/<turbo-stream[^>]*>/)?.[0];
console.log(`turbo: ${turboTitle ?? 'non'} ; extrait: ${p1.body.slice(0, 300).replace(/\s+/g, ' ')}`);

// Détail : JSON-LD ?
const d = await get('https://careers.pvh.com/jobs/sales-advisor-32-uur-roosendaal-netherlands', 'text/html');
const ld = [...d.body.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
console.log(`détail ld+json: ${ld.length} ; JobPosting: ${ld.filter((x) => /JobPosting/.test(x)).length} ; ${ld.find((x) => /JobPosting/.test(x))?.replace(/\s+/g, ' ').slice(0, 600)}`);
console.log(`détail title: ${d.body.match(/<title>([^<]*)/)?.[1]} ; h1: ${d.body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '').trim().slice(0, 80)}`);
