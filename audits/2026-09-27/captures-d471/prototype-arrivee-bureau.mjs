// Prototype (D-472, arrivée sans clic sur bureau) : on charge la page d'une offre (fiche seule, comme depuis Google,
// ou avec la liste, `?marche=FR`) et l'on fait défiler la page jusqu'à ce que la fiche atteigne la place collée du
// volet sous l'en-tête, comme le clic de D-472 §1. Simulé par `scrollBy`, sans toucher au site. Mesure titre et
// « Postuler » au premier écran, avant et après.
// Usage : node …/prototype-arrivee-bureau.mjs <url-du-site>
import { chromium } from 'playwright';
const [base] = process.argv.slice(2);
const navigateur = await chromium.launch();
const sortie = [];
for (const q of ['', '?marche=FR']) for (const [largeur, hauteur] of [[1440, 900], [1440, 790], [1536, 730], [1280, 720], [1024, 680]]) {
  const page = await navigateur.newPage({ viewport: { width: largeur, height: hauteur }, reducedMotion: 'reduce' });
  await page.goto(`${base}/fr/emplois/directeur-rice-de-boutique-cw_temoind471lancel${q}`, { waitUntil: 'networkidle', timeout: 180_000 });
  const m = await page.evaluate(async () => {
    const h = innerHeight, r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const vu = (s) => { const x = r(s); return !!x && x.top >= 0 && x.bottom <= h; };
    const avant = { fiche: Math.round(r('.cw-fiche').top), titre: vu('.cw-fiche__titre'), postuler: vu('.cw-fiche__actions .cw-btn') };
    const cible = document.querySelector('.cw-emplois__volet') ?? document.querySelector('.cw-fiche');
    const place = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) + 16;
    window.scrollBy({ top: Math.max(0, cible.getBoundingClientRect().top - place), behavior: 'instant' });
    await new Promise((f) => setTimeout(f, 300));
    return { avant, apres: { fiche: Math.round(r('.cw-fiche').top), titre: vu('.cw-fiche__titre'), postuler: vu('.cw-fiche__actions .cw-btn'), couverture: vu('.cw-fiche__couverture') } };
  });
  sortie.push({ page: q || '(fiche seule)', ecran: `${largeur}x${hauteur}`, ...m });
  await page.close();
}
await navigateur.close();
console.log(JSON.stringify(sortie));
