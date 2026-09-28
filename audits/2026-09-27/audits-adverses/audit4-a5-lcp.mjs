// Audit 4 — A5 : l'image principale (LCP) de la page d'une offre, bureau et mobile, après « priority={!pageOffre} » du Hero.
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://127.0.0.1:3036';
const lent = process.argv[3] === 'lent';
const PAGES = ['/fr/emplois/directeur-rice-de-boutique-cw_temoind471lancel?marche=FR', '/fr/emplois/conseiller-ere-de-vente-en-alternance-paris-cw_temoind471mandat?marche=FR', '/fr/emplois/directeur-rice-de-boutique-cw_temoind471lancel', '/fr/emplois?marche=FR'];
const b = await chromium.launch();
const out = [];
for (const [l, h, mobile] of [[1440, 790, false], [390, 664, true]]) for (const p of PAGES) {
  const ctx = await b.newContext({ viewport: { width: l, height: h }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { window.__lcp = []; new PerformanceObserver((li) => { for (const e of li.getEntries()) window.__lcp.push({ t: Math.round(e.startTime), el: e.element ? (e.element.tagName + '.' + (e.element.className || e.element.parentElement?.className || '')).slice(0, 60) : null, url: (e.url || '').replace(/^.*url=/, '').slice(0, 50), taille: e.size }); }).observe({ type: 'largest-contentful-paint', buffered: true }); });
  const page = await ctx.newPage();
  if (lent) { const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 }); }
  await page.goto(`${base}${p}`, { waitUntil: 'networkidle', timeout: 240000 });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({
    lcp: window.__lcp.slice(-2),
    hero: (() => { const i = document.querySelector('.cw-hero__bg img'); if (!i) return null; const r = i.getBoundingClientRect(); return { loading: i.getAttribute('loading'), fetchpriority: i.getAttribute('fetchpriority'), visibleAuChargement: r.bottom > 0, hauteur: Math.round(r.height) }; })(),
    couverture: (() => { const i = document.querySelector('.cw-fiche__couverture img'); return i ? { loading: i.getAttribute('loading'), fetchpriority: i.getAttribute('fetchpriority') } : null; })(),
    preloads: [...document.querySelectorAll('link[rel=preload][as=image]')].map((x) => (x.getAttribute('imagesrcset') || x.href).slice(0, 60)),
  }));
  out.push({ ecran: `${l}x${h}`, page: p.replace('/fr/emplois/', '').slice(0, 45), ...r });
  await ctx.close();
}
await b.close();
console.log(JSON.stringify(out, null, 1));
