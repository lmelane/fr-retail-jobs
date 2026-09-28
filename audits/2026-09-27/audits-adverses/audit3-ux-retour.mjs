// Audit 3 — mobile, page d'une offre : la cible tactile réelle de « Toutes les offres » (ce que reçoit un doigt posé
// dans le rembourrage), la recherche conservée (mot-clé, lieu, filtres), la ligne « non confirmées » au-dessus de
// l'offre, et la région « moteur » vide annoncée aux lecteurs d'écran.
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:3036';
const OUT = process.argv[2];
const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const out = {};
// 1. Recherche avec critères, puis toucher la carte.
const recherche = '/fr/emplois?marche=FR&q=directeur&contrat=CDI';
await page.goto(BASE + recherche, { waitUntil: 'networkidle', timeout: 180000 });
out.liste = await page.evaluate(() => ({ url: location.pathname + location.search, total: document.querySelector('main')?.dataset.total, cartes: [...document.querySelectorAll('a[data-emploi-id]')].map((a) => a.getAttribute('href')) }));
const carte = page.locator('a[data-emploi-id="cw_temoind471lancel"]');
if (await carte.count()) {
  await carte.scrollIntoViewIfNeeded();
  await carte.tap();
  await page.waitForURL(/cw_temoind471lancel/, { timeout: 60000 });
  await page.waitForLoadState('networkidle');
} else {
  await page.goto(BASE + '/fr/emplois/directeur-rice-de-boutique-cw_temoind471lancel?marche=FR&q=directeur&contrat=CDI', { waitUntil: 'networkidle' });
}
await page.waitForTimeout(500);
out.offre = await page.evaluate(() => {
  const a = document.querySelector('.cw-emplois-page__retour.-mobile a');
  const p = a.parentElement;
  const ra = a.getBoundingClientRect(), rp = p.getBoundingClientRect();
  // Ce que touche un doigt 8 px au-dessus du texte du lien, dans le rembourrage du paragraphe.
  const cible = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.closest('a') ? 'LIEN' : e.tagName + '.' + (e.className || '')) : null; };
  const nc = document.querySelector('.cw-emplois__non-confirmees');
  const hero = document.querySelector('.cw-hero');
  return {
    url: location.pathname + location.search, hrefRetour: a.getAttribute('href'),
    lien: { h: Math.round(ra.height), w: Math.round(ra.width) }, paragraphe: { h: Math.round(rp.height), w: Math.round(rp.width) },
    toucherAuDessus: cible(ra.left + 20, ra.top - 8), toucherAuDessous: cible(ra.left + 20, ra.bottom + 8), toucherADroite: cible(ra.right + 30, ra.top + ra.height / 2),
    nonConfirmees: nc ? { texte: nc.textContent, top: Math.round(nc.getBoundingClientRect().top), visible: nc.getBoundingClientRect().height > 0 } : null,
    heroRegion: { role: hero?.tagName, label: hero?.getAttribute('aria-label'), texteVisible: hero?.innerText.trim() ?? '' },
  };
});
await page.screenshot({ path: `${OUT}/retour-criteres-375.png` });
// 2. La région du moteur dans l'arbre d'accessibilité.
out.a11y = await page.locator('section.cw-hero').ariaSnapshot().catch((e) => String(e));
await nav.close();
console.log(JSON.stringify(out, null, 1));
