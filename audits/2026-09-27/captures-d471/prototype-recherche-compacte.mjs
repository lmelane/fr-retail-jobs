// Prototype, par styles injectés, d'une recherche compacte « façon Indeed » sur /emplois (référence Mobbin du
// 27/09/2026) : la barre de recherche seule sous l'en-tête, sans le titre de la carte. Mesure, sur le parcours réel
// (clic sur la carte de l'offre témoin), la hauteur de chaque bloc au-dessus de la fiche et ce qui reste au premier
// écran, avec la couverture de D-471, seule ou avec une fiche aux proportions de la capture Indeed du CEO (bannière 16:3,
// « Postuler » sous l'en-tête). Aucune ligne du site n'est modifiée.
// Usage : node …/prototype-recherche-compacte.mjs <url-du-site> <dossier-de-sortie>
import { chromium } from 'playwright';
const [base, sortie] = process.argv.slice(2);
const COMPACTE = `.cw-hero.-compact .cw-card__titles-area{display:none!important}
.cw-hero.-compact{padding-top:calc(var(--header-height) + 12px)!important;padding-bottom:12px!important}`;
// La fiche aux proportions de la capture Indeed du CEO : bannière 16:3 (≈ 5,3:1), « Postuler » sous l'en-tête sans filet.
const FICHE_INDEED = `.cw-fiche__couverture{aspect-ratio:16/3!important}
.cw-fiche.-couverture .cw-fiche__tete{padding-bottom:0!important;border-bottom:0!important}
.cw-fiche.-couverture .cw-fiche__actions{padding-top:16px!important}`;
const ECRANS = [[1440, 790], [1536, 730], [1366, 657], [1024, 680], [430, 739], [412, 839], [390, 664], [375, 667], [360, 640]];
const navigateur = await chromium.launch();
const resultats = [];
for (const [largeur, hauteur] of ECRANS) {
  for (const [nom, css] of [['actuelle', ''], ['compacte', COMPACTE], ['fiche Indeed', FICHE_INDEED], ['les deux', COMPACTE + FICHE_INDEED]]) {
    const page = await navigateur.newPage({ viewport: { width: largeur, height: hauteur } });
    await page.goto(`${base}/fr/emplois?marche=FR`, { waitUntil: 'networkidle', timeout: 180_000 });
    if (css) await page.addStyleTag({ content: css });
    const carte = page.locator('a[href*="cw_temoind471lancel"]').first();
    await carte.scrollIntoViewIfNeeded(); await carte.click();
    await page.waitForFunction(() => /Lancel/i.test(document.querySelector('.cw-fiche .cw-fiche__maison')?.textContent ?? ''), null, { timeout: 60_000 });
    if (css) await page.addStyleTag({ content: css });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const h = innerHeight, r = (s) => document.querySelector(s)?.getBoundingClientRect();
      const vu = (s) => { const x = r(s); return !!x && x.top >= 0 && x.bottom <= h; };
      return { hero: Math.round(r('main .cw-hero')?.height ?? 0), defilement: Math.round(scrollY), hautFiche: Math.round(r('.cw-fiche')?.top ?? -1),
        titre: vu('.cw-fiche__titre'), postuler: vu('.cw-fiche__actions .cw-btn'), couverture: vu('.cw-fiche__couverture') };
    });
    if (nom === 'les deux') await page.screenshot({ path: `${sortie}/prototype-indeed-${largeur}x${hauteur}.png` });
    resultats.push({ ecran: `${largeur}x${hauteur}`, recherche: nom, ...m });
    await page.close();
  }
}
await navigateur.close();
console.log(JSON.stringify(resultats));
