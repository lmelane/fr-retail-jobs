import { chromium } from 'playwright';
const sortie = process.argv[2];
const navigateur = await chromium.launch();
const resultats = [];
for (const largeur of [320, 375, 390, 960, 1440]) {
  const page = await navigateur.newPage({ viewport: { width: largeur, height: 900 }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:3455/fr/emplois?marche=FR', { waitUntil: 'networkidle', timeout: 180_000 });
  await page.waitForSelector('.cw-job-card', { timeout: 60_000 });
  const mesure = await page.evaluate(() => {
    const cartes = [...document.querySelectorAll('.cw-job-card')].slice(0, 12);
    const tetes = cartes.map((c) => {
      const tete = c.querySelector('.cw-job-card__head');
      const maison = c.querySelector('.cw-job-card__maison');
      const badge = c.querySelector('.cw-job-card__origine');
      const r = (e) => (e ? e.getBoundingClientRect() : null);
      const rc = r(c), rt = r(tete), rm = r(maison), rb = r(badge);
      return {
        maison: maison?.textContent, badge: badge?.textContent ?? null,
        teteDeborde: tete ? tete.scrollWidth > tete.clientWidth + 1 : null,
        maisonDeborde: maison ? maison.scrollWidth > maison.clientWidth + 1 : null,
        badgeHorsCarte: rb && rc ? rb.right > rc.right + 1 || rb.left < rc.left - 1 : null,
        chevauchement: rm && rb ? rm.right > rb.left + 1 && rm.top < rb.bottom && rb.top < rm.bottom : null,
        largeurCarte: rc?.width, largeurMaison: rm?.width, largeurBadge: rb?.width,
      };
    });
    return { pageDeborde: document.documentElement.scrollWidth > window.innerWidth, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, tetes };
  });
  await page.screenshot({ path: `${sortie}/emplois-fr-${largeur}.png`, fullPage: false });
  const premiere = page.locator('.cw-job-card').first();
  await premiere.screenshot({ path: `${sortie}/carte-${largeur}.png` });
  resultats.push({ largeur, ...mesure });
  await page.close();
}
await navigateur.close();
console.log(JSON.stringify(resultats, null, 1));
