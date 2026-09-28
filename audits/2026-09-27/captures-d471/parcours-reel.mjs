// Le parcours réel : la liste `/fr/emplois?marche=FR`, puis un clic sur la carte de l'offre témoin. Sur bureau
// (deux volets, ≥ 901 px), la fiche s'ouvre dans le volet collé sous l'en-tête ; sur mobile, le clic navigue vers
// la page de l'offre. On mesure ce que le candidat voit APRÈS le clic, avec et sans la couverture de D-471.
// Usage : node audits/2026-09-27/captures-d471/parcours-reel.mjs <url-du-site> <dossier-de-sortie>
// Prérequis : le site local branché sur une API dont la base porte les offres témoins de `temoin-d471-seed.mts`.
import { chromium } from 'playwright';
const [base, sortie] = process.argv.slice(2);
const ECRANS = [[1440, 790], [1536, 730], [1366, 657], [1024, 680], [430, 739], [412, 839], [390, 664], [375, 667], [360, 640]];
const navigateur = await chromium.launch();
const resultats = [];
for (const [largeur, hauteur] of ECRANS) {
  for (const avec of [true, false]) {
    const page = await navigateur.newPage({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 2 });
    await page.goto(`${base}/fr/emplois?marche=FR`, { waitUntil: 'networkidle', timeout: 180_000 });
    if (!avec) await page.addStyleTag({ content: '.cw-fiche__couverture{display:none!important}.cw-fiche.-couverture .cw-fiche__maison-ligne{margin-top:0!important}' });
    const carte = page.locator('a[href*="cw_temoind471lancel"]').first();
    await carte.scrollIntoViewIfNeeded();
    await carte.click();
    await page.waitForFunction(() => /Lancel/i.test(document.querySelector('.cw-fiche .cw-fiche__maison')?.textContent ?? ''), null, { timeout: 60_000 });
    await page.waitForTimeout(800);
    if (!avec) await page.addStyleTag({ content: '.cw-fiche__couverture{display:none!important}.cw-fiche.-couverture .cw-fiche__maison-ligne{margin-top:0!important}' });
    const m = await page.evaluate(() => {
      const h = window.innerHeight;
      const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
      const titre = r('.cw-fiche__titre'), postuler = r('.cw-fiche__actions .cw-btn'), fiche = r('.cw-fiche');
      return { url: location.pathname + location.search, defilement: Math.round(scrollY), hautFiche: Math.round(fiche?.top ?? -1),
        titreVisible: !!titre && titre.top >= 0 && titre.bottom <= h, postulerVisible: !!postuler && postuler.top >= 0 && postuler.bottom <= h };
    });
    if (avec) await page.screenshot({ path: `${sortie}/parcours-reel-${largeur}x${hauteur}.png` });
    resultats.push({ largeur, hauteur, couverture: avec, ...m });
    await page.close();
  }
}
await navigateur.close();
console.log(JSON.stringify(resultats));
