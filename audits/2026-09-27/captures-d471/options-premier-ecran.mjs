// Les deux corrections proposées au CEO (D-471, premier écran), essayées par styles injectés sur le parcours réel
// (clic depuis la liste), AVANT toute ligne de code : A = « Postuler » collé en bas de l'écran ou du volet tant que
// son emplacement n'est pas atteint ; M = sur mobile, la page d'une offre sans le moteur de recherche.
// Usage : node …/options-premier-ecran.mjs <url-du-site>
import { chromium } from 'playwright';
const [base] = process.argv.slice(2);
const COLLE = '.cw-fiche__actions{position:sticky;bottom:0;z-index:2;background:#fff;padding-block:12px}';
const SANS_MOTEUR = '@media (max-width:900px){main .cw-hero{display:none!important}}';
const ECRANS = [[1440, 790], [1536, 730], [1366, 657], [1024, 680], [430, 739], [412, 839], [390, 664], [375, 667], [360, 640]];
const navigateur = await chromium.launch();
const sortie = [];
for (const [largeur, hauteur] of ECRANS) {
  for (const [nom, css] of [['tel quel', ''], ['A', COLLE], ['M', SANS_MOTEUR], ['A+M', COLLE + SANS_MOTEUR]]) {
    if (largeur > 900 && nom.includes('M')) continue;
    const page = await navigateur.newPage({ viewport: { width: largeur, height: hauteur } });
    await page.goto(`${base}/fr/emplois?marche=FR`, { waitUntil: 'networkidle', timeout: 180_000 });
    const carte = page.locator('a[href*="cw_temoind471lancel"]').first();
    await carte.scrollIntoViewIfNeeded(); await carte.click();
    await page.waitForFunction(() => /Lancel/i.test(document.querySelector('.cw-fiche .cw-fiche__maison')?.textContent ?? ''), null, { timeout: 60_000 });
    if (css) await page.addStyleTag({ content: css });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const h = innerHeight, vu = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= h; };
      return { titre: vu('.cw-fiche__titre'), postuler: vu('.cw-fiche__actions .cw-btn'), couverture: vu('.cw-fiche__couverture'),
        moteurMasque: getComputedStyle(document.querySelector('main .cw-hero')).display === 'none' };
    });
    sortie.push({ ecran: `${largeur}x${hauteur}`, option: nom, ...m });
    await page.close();
  }
}
await navigateur.close();
console.log(JSON.stringify(sortie));
