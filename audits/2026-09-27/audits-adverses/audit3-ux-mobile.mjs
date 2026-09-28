// Audit 3 (métier/UX) D-471/D-472 — parcours réel MOBILE et TABLETTE : la liste /fr/emplois?marche=FR, un toucher
// sur la carte Lancel, la page de l'offre ; puis « Toutes les offres », puis le retour arrière. Lecture seule.
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:3036';
const OUT = process.argv[2];
const ECRANS = [
  [320, 568], [360, 640], [375, 667], [390, 664], [390, 844], [412, 839], [412, 915], [430, 739], [430, 932],
  [568, 320], [667, 375], [844, 390], [932, 430],
  [768, 1024], [820, 1180], [900, 1200],
];

async function mesure(page) {
  return page.evaluate(() => {
    const h = innerHeight, w = innerWidth;
    const header = document.querySelector('.cw-header');
    const hr = header.getBoundingClientRect();
    const cache = header.classList.contains('-hidden');
    const basHeader = cache ? 0 : Math.max(0, hr.bottom);
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.width || b.height ? b : null; };
    const vis = (b) => !!b && b.top >= basHeader - 1 && b.bottom <= h + 1;
    const hero = r('.cw-hero');
    const retour = document.querySelector('.cw-emplois-page__retour.-mobile a');
    const rr = retour?.getBoundingClientRect();
    const lien = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bas: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height), visible: b.width > 0 && b.bottom > 0 && b.top < h && b.right <= w + 1 }; };
    const titre = r('.cw-fiche__titre'), sal = r('.cw-fiche__salaire'), post = r('.cw-fiche__actions .cw-btn'), couv = r('.cw-fiche__couverture');
    return {
      url: location.pathname + location.search, scrollY: Math.round(scrollY), docW: document.documentElement.scrollWidth,
      header: { classe: header.className.replace(/\s+/g, ' ').trim(), bas: Math.round(hr.bottom) },
      heroH: hero ? Math.round(hero.height) : null,
      menu: lien('.cw-hamburger'), connexion: lien('.cw-header__cta'), logo: lien('.cw-brand-logo'),
      retour: rr ? { top: Math.round(rr.top), h: Math.round(rr.height), href: retour.getAttribute('href'), texte: retour.textContent } : null,
      recherche: !!r('.cw-hero .cw-search-bar'), filtres: !!r('.cw-emplois__filtres'),
      couverture: couv ? { top: Math.round(couv.top), h: Math.round(couv.height), w: Math.round(couv.width) } : null,
      titre: vis(titre), titreTop: titre ? Math.round(titre.top) : null,
      salaire: sal ? vis(sal) : 'absent', salaireTexte: document.querySelector('.cw-fiche__salaire')?.textContent ?? null,
      postuler: vis(post), postulerBas: post ? Math.round(post.bottom) : null,
      nonConfirmees: !!r('.cw-emplois__non-confirmees'),
    };
  });
}

const nav = await chromium.launch();
const res = [];
for (const [w, h] of ECRANS) {
  const ctx = await nav.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 900, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/fr/emplois?marche=FR`, { waitUntil: 'networkidle', timeout: 180000 });
  const carte = page.locator('a[data-emploi-id="cw_temoind471lancel"]');
  await carte.scrollIntoViewIfNeeded();
  const scrollListe = await page.evaluate(() => Math.round(scrollY));
  await carte.tap();
  await page.waitForURL(/cw_temoind471lancel/, { timeout: 60000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  const surOffre = await mesure(page);
  await page.screenshot({ path: `${OUT}/mobile-${w}x${h}.png` });
  let toutes = null, retourArriere = null;
  if (w <= 900) {
    // « Toutes les offres » : où va-t-on, la carte ouverte est-elle retrouvée ?
    await page.locator('.cw-emplois-page__retour.-mobile a').tap();
    await page.waitForURL((u) => !/cw_temoind471lancel/.test(u.toString()), { timeout: 60000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    toutes = await page.evaluate(() => ({ url: location.pathname + location.search, scrollY: Math.round(scrollY), carteTop: Math.round(document.querySelector('a[data-emploi-id="cw_temoind471lancel"]')?.getBoundingClientRect().top ?? -1), recherche: !!document.querySelector('.cw-hero .cw-search-bar')?.getBoundingClientRect().height }));
    // Retour arrière depuis la liste : revient-on sur l'offre ? Puis encore : sur la liste à l'endroit quitté ?
    await page.goBack(); await page.waitForTimeout(1200);
    const b1 = await page.evaluate(() => ({ url: location.pathname + location.search, scrollY: Math.round(scrollY) }));
    await page.goBack(); await page.waitForTimeout(1200);
    const b2 = await page.evaluate(() => ({ url: location.pathname + location.search, scrollY: Math.round(scrollY), carteTop: Math.round(document.querySelector('a[data-emploi-id="cw_temoind471lancel"]')?.getBoundingClientRect().top ?? -1) }));
    retourArriere = { b1, b2 };
  }
  res.push({ w, h, scrollListe, surOffre, toutes, retourArriere });
  await ctx.close();
}
await nav.close();
console.log(JSON.stringify(res, null, 1));
