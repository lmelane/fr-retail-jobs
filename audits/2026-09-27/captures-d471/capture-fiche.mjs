// Rendu réel de la fiche d'une offre Catwalks avec sa couverture (D-471) : site en local, API du catalogue en local sur
// une base jetable (deux offres témoins, `apps/api/temoin-d471-seed.mts`). Mesure le débordement de page, la hauteur de
// la bannière, le chevauchement du logo, la position du bouton « Postuler » par rapport au bas de l'écran.
// Usage : node audits/2026-09-27/captures-d471/capture-fiche.mjs <url-du-site> <dossier-de-sortie>
import { chromium } from 'playwright';
const [base, sortie] = process.argv.slice(2);
const TELEPHONES_ET_BUREAU = [[320, 568], [375, 667], [390, 844], [768, 1024], [1440, 900]];
// La liste n'ouvre son volet qu'au-delà de 900 px : sous ce seuil, une carte ouvre la page de l'offre.
const BUREAU = [[1024, 768], [1440, 900]];
const FICHES = [
  ['lancel', '/fr/emplois/directeur-rice-de-boutique-cw_temoind471lancel', TELEPHONES_ET_BUREAU],
  ['mandat', '/fr/emplois/conseiller-ere-de-vente-en-alternance-paris-cw_temoind471mandat', TELEPHONES_ET_BUREAU],
  ['liste', '/fr/emplois?marche=FR', BUREAU],
];
const navigateur = await chromium.launch();
const resultats = [];
for (const [nom, chemin, ecrans] of FICHES) {
  for (const [largeur, hauteur] of ecrans) {
    const page = await navigateur.newPage({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 2 });
    await page.goto(`${base}${chemin}`, { waitUntil: 'networkidle', timeout: 180_000 });
    await page.waitForSelector('.cw-fiche', { timeout: 60_000 });
    const mesure = await page.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { haut: Math.round(b.top + scrollY), bas: Math.round(b.bottom + scrollY), gauche: Math.round(b.left), droite: Math.round(b.right), largeur: Math.round(b.width), hauteur: Math.round(b.height) }; };
      const couv = document.querySelector('.cw-fiche__couverture');
      const img = couv?.querySelector('img');
      const logo = document.querySelector('.cw-fiche__maison-ligne .cw-logo-maison');
      const nomMaison = document.querySelector('.cw-fiche__maison-ligne .cw-fiche__maison');
      const postuler = document.querySelector('.cw-fiche__actions .cw-btn');
      const volet = document.querySelector('.cw-fiche')?.closest('.cw-emplois__volet');
      return {
        pageDeborde: document.documentElement.scrollWidth > window.innerWidth, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
        dansUnVolet: Boolean(volet), couverture: r(couv), volet: r(volet), imageChargee: Boolean(img && img.complete && img.naturalWidth > 0), imageSrc: img?.currentSrc?.slice(0, 120) ?? null,
        logo: r(logo), logoSrc: logo?.getAttribute('src') ?? (logo ? `monogramme:${logo.textContent}` : null), nomMaison: r(nomMaison),
        chevauchementLogo: couv && logo ? Math.round(couv.getBoundingClientRect().bottom - logo.getBoundingClientRect().top) : null,
        postuler: r(postuler), postulerVisibleSansDefiler: postuler ? postuler.getBoundingClientRect().bottom <= window.innerHeight : null,
        tiretCadratin: (document.querySelector('.cw-fiche')?.textContent ?? '').includes('—'),
      };
    });
    await page.screenshot({ path: `${sortie}/fiche-${nom}-${largeur}.png`, fullPage: false });
    resultats.push({ fiche: nom, largeur, hauteur, ...mesure });
    await page.close();
  }
}
await navigateur.close();
console.log(JSON.stringify(resultats, null, 1));
