// Audit 4 — A5b : quand la requête de l'image du moteur part-elle (bureau, réseau lent simulé) : liste vs page d'une offre.
import { chromium } from 'playwright';
const base = 'http://127.0.0.1:3036';
const b = await chromium.launch();
const out = [];
for (let i = 0; i < 2; i++) for (const p of ['/fr/emplois?marche=FR', '/fr/emplois/directeur-rice-de-boutique-cw_temoind471lancel?marche=FR', '/fr/emplois/directeur-rice-de-boutique-cw_temoind471lancel']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 790 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { window.__lcp = []; new PerformanceObserver((li) => { for (const e of li.getEntries()) window.__lcp.push(Math.round(e.startTime)); }).observe({ type: 'largest-contentful-paint', buffered: true }); });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  await page.goto(`${base}${p}`, { waitUntil: 'networkidle', timeout: 240000 }); await page.waitForTimeout(500);
  out.push({ page: p.slice(12, 60), ...(await page.evaluate(() => { const r = performance.getEntriesByType('resource').find((x) => x.name.includes('Hero%20Maison')); return { heroDemandeeMs: r ? Math.round(r.startTime) : null, heroRecueMs: r ? Math.round(r.responseEnd) : null, lcpMs: window.__lcp.at(-1), fcpMs: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1) }; })) });
  await ctx.close();
}
await b.close();
console.log(out.map((x) => JSON.stringify(x)).join('\n'));
