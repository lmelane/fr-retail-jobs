// Rendu réel de /fr/emplois sur la preview du site, une fois les offres Catwalks au catalogue (D-444) :
// débordement de page à 320-390 px (correctif 08d3a2d), tiret cadratin dans les cartes (D-470 §2), offres Catwalks en tête.
// Usage : node audits/2026-09-27/captures-preview/capture-preview.mjs <url-de-la-preview> <dossier-de-sortie>
import { chromium } from 'playwright';
const [base, sortie] = process.argv.slice(2);
const navigateur = await chromium.launch();
const resultats = [];
for (const largeur of [320, 375, 390, 1440]) {
  const page = await navigateur.newPage({ viewport: { width: largeur, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`${base}/fr/emplois?marche=FR`, { waitUntil: 'networkidle', timeout: 180_000 });
  await page.waitForSelector('.cw-job-card', { timeout: 60_000 });
  const mesure = await page.evaluate(() => {
    const cartes = [...document.querySelectorAll('.cw-job-card')].slice(0, 12);
    const texte = cartes.map((c) => c.textContent || '').join('\n');
    return {
      pageDeborde: document.documentElement.scrollWidth > window.innerWidth, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
      cartes: cartes.length, etiquettesCatwalks: cartes.filter((c) => c.querySelector('.cw-job-card__origine')).length,
      tiretCadratinDansLesCartes: texte.includes('—'),
      badgesHorsCarte: cartes.filter((c) => { const b = c.querySelector('.cw-job-card__origine'); if (!b) return false; const rb = b.getBoundingClientRect(), rc = c.getBoundingClientRect(); return rb.right > rc.right + 1 || rb.left < rc.left - 1; }).length,
      premieresCartes: cartes.slice(0, 3).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140)),
    };
  });
  await page.screenshot({ path: `${sortie}/emplois-fr-${largeur}.png`, fullPage: false });
  await page.locator('.cw-job-card').first().screenshot({ path: `${sortie}/carte-${largeur}.png` });
  resultats.push({ largeur, ...mesure });
  await page.close();
}
await navigateur.close();
console.log(JSON.stringify(resultats, null, 1));
