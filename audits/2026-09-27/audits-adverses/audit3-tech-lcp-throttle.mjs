// LCP de la page d'une offre sur mobile, réseau « Slow 4G » : tel quel, puis couverture chargée en priorité (HTML réécrit à la volée).
import { chromium } from 'playwright';
const base = 'http://127.0.0.1:3036';
const chemin = '/fr/emplois/directeur-rice-de-boutique-cw_temoind471lancel?marche=FR';
const b = await chromium.launch();
async function mesure(variante) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  if (variante === 'couverture-prioritaire') {
    await p.route((u) => u.pathname.startsWith('/fr/emplois/directeur'), async (r) => {
      const rep = await r.fetch(); let html = await rep.text();
      html = html.replace(/<img([^>]*?)loading="lazy"([^>]*cw-fiche__couverture-image)/, (m, a, c) => `<img${a}loading="eager" fetchpriority="high"${c}`);
      await r.fulfill({ response: rep, body: html });
    });
  }
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await p.addInitScript(() => { window.__lcp = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp.push({ t: Math.round(e.startTime), el: e.element?.className || e.element?.tagName }); }).observe({ type: 'largest-contentful-paint', buffered: true }); });
  await p.goto(`${base}${chemin}`, { waitUntil: 'networkidle', timeout: 300000 });
  await p.waitForTimeout(1000);
  const r = await p.evaluate(() => ({ lcp: window.__lcp.at(-1), loading: document.querySelector('.cw-fiche__couverture img')?.getAttribute('loading') }));
  await ctx.close();
  return { variante, ...r };
}
// Chauffe (compilation Next dev), puis 3 mesures par variante, alternées.
await mesure('tel-quel'); await mesure('couverture-prioritaire');
const res = [];
for (let i = 0; i < 3; i++) { res.push(await mesure('tel-quel')); res.push(await mesure('couverture-prioritaire')); }
console.log(JSON.stringify(res));
await b.close();
