// Prototype : au clic sur une carte (bureau, deux volets), la page défile juste assez pour que le volet atteigne sa
// place collée sous l'en-tête (`position: sticky`), comme il l'est déjà quand on a défilé la liste. Simulé par un
// `scrollBy` après le clic, sans toucher au site. Mesure : la carte cliquée reste-t-elle visible, et que montre le
// volet (titre, « Postuler »), avec la couverture de D-471 telle quelle.
// Usage : node …/prototype-defilement-clic.mjs <url-du-site> <dossier-de-sortie>
import { chromium } from 'playwright';
const [base, sortie] = process.argv.slice(2);
const navigateur = await chromium.launch();
const resultats = [];
for (const [largeur, hauteur] of [[1440, 900], [1440, 790], [1536, 730], [1366, 657], [1280, 720], [1024, 680]]) {
  const page = await navigateur.newPage({ viewport: { width: largeur, height: hauteur } });
  await page.goto(`${base}/fr/emplois?marche=FR`, { waitUntil: 'networkidle', timeout: 180_000 });
  const carte = page.locator('a[href*="cw_temoind471lancel"]').first();
  await carte.scrollIntoViewIfNeeded(); await carte.click();
  await page.waitForFunction(() => /Lancel/i.test(document.querySelector('.cw-fiche .cw-fiche__maison')?.textContent ?? ''), null, { timeout: 60_000 });
  const m = await page.evaluate(async () => {
    const volet = document.querySelector('.cw-emplois__volet');
    const collage = parseFloat(getComputedStyle(volet).top);
    const ecart = Math.max(0, volet.getBoundingClientRect().top - collage);
    window.scrollBy({ top: ecart, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 400));
    const h = innerHeight, r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const vu = (x) => !!x && x.top >= 0 && x.bottom <= h;
    const active = document.querySelector('.cw-job-card.-active') ?? document.querySelector('a[href*="cw_temoind471lancel"]');
    return { defileDe: Math.round(ecart), hautVolet: Math.round(r('.cw-emplois__volet').top), carteVisible: vu(active.getBoundingClientRect()),
      titre: vu(r('.cw-fiche__titre')), postuler: vu(r('.cw-fiche__actions .cw-btn')), couverture: vu(r('.cw-fiche__couverture')) };
  });
  await page.screenshot({ path: `${sortie}/prototype-defilement-${largeur}x${hauteur}.png` });
  resultats.push({ ecran: `${largeur}x${hauteur}`, ...m });
  await page.close();
}
await navigateur.close();
console.log(JSON.stringify(resultats));
