// Le premier écran d'une fiche d'offre Catwalks, sur le rendu RÉEL (`?marche=FR` : liste et volet), avec et sans la
// couverture de D-471 : ce qui reste visible sans défiler. Hauteurs = zone utile d'un navigateur, pas l'écran.
// Usage : node audits/2026-09-27/captures-d471/premier-ecran.mjs <url-du-site> <dossier-de-sortie>
import { chromium } from 'playwright';
const [base, sortie] = process.argv.slice(2);
const ECRANS = [[1440, 790], [1536, 730], [1366, 657], [1024, 680], [430, 739], [412, 839], [390, 664], [375, 667], [360, 640]];
const CHEMIN = '/fr/emplois/directeur-rice-de-boutique-cw_temoind471lancel?marche=FR';
const navigateur = await chromium.launch();
const resultats = [];
for (const [largeur, hauteur] of ECRANS) {
  for (const avec of [true, false]) {
    const page = await navigateur.newPage({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 2 });
    await page.goto(`${base}${CHEMIN}`, { waitUntil: 'networkidle', timeout: 180_000 });
    await page.waitForSelector('.cw-fiche', { timeout: 60_000 });
    if (!avec) await page.addStyleTag({ content: '.cw-fiche__couverture{display:none!important}.cw-fiche.-couverture .cw-fiche__maison-ligne{margin-top:0!important}' });
    const m = await page.evaluate(() => {
      const bas = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().bottom) : null; };
      const h = window.innerHeight;
      return { volet: Boolean(document.querySelector('.cw-emplois__volet .cw-fiche')), haut: Math.round(document.querySelector('.cw-fiche').getBoundingClientRect().top),
        titreVisible: (bas('.cw-fiche__titre') ?? 1e9) <= h, postulerVisible: (bas('.cw-fiche__actions .cw-btn') ?? 1e9) <= h, basTitre: bas('.cw-fiche__titre'), basPostuler: bas('.cw-fiche__actions .cw-btn') };
    });
    if (avec) await page.screenshot({ path: `${sortie}/premier-ecran-${largeur}x${hauteur}.png` });
    resultats.push({ largeur, hauteur, couverture: avec, ...m });
    await page.close();
  }
}
await navigateur.close();
console.log(JSON.stringify(resultats));
