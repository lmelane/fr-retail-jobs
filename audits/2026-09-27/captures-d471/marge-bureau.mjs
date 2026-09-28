// Parcours réel sur bureau (clic dans la liste) : la marge qui reste sous « Postuler » sans la couverture, et la
// hauteur de la couverture. Une couverture plus haute que la marge + 24 px (le logo la chevauche) fait sortir
// « Postuler » du premier écran. Usage : node …/marge-bureau.mjs <url-du-site>
import { chromium } from 'playwright';
const [base] = process.argv.slice(2);
const navigateur = await chromium.launch();
const sortie = [];
for (const [largeur, hauteur] of [[1440, 900], [1440, 790], [1536, 730], [1366, 657], [1280, 720], [1024, 680]]) {
  const page = await navigateur.newPage({ viewport: { width: largeur, height: hauteur } });
  await page.goto(`${base}/fr/emplois?marche=FR`, { waitUntil: 'networkidle', timeout: 180_000 });
  const carte = page.locator('a[href*="cw_temoind471lancel"]').first();
  await carte.scrollIntoViewIfNeeded(); await carte.click();
  await page.waitForFunction(() => /Lancel/i.test(document.querySelector('.cw-fiche .cw-fiche__maison')?.textContent ?? ''), null, { timeout: 60_000 });
  await page.waitForTimeout(600);
  const couverture = await page.evaluate(() => Math.round(document.querySelector('.cw-fiche__couverture')?.getBoundingClientRect().height ?? 0));
  await page.addStyleTag({ content: '.cw-fiche__couverture{display:none!important}.cw-fiche.-couverture .cw-fiche__maison-ligne{margin-top:0!important}' });
  const m = await page.evaluate(() => ({ h: innerHeight, bas: Math.round(document.querySelector('.cw-fiche__actions .cw-btn').getBoundingClientRect().bottom), defil: Math.round(scrollY) }));
  sortie.push({ ecran: `${largeur}x${hauteur}`, defilement: m.defil, couverture, margeSansCouverture: m.h - m.bas });
  await page.close();
}
await navigateur.close();
console.log(JSON.stringify(sortie));
