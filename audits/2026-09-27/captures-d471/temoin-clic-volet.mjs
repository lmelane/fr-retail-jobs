// TÉMOIN D-472 §1 (R-139 §1), au navigateur, sur le site réel : sur bureau, un clic sur une carte amène le volet à sa
// place collée sous l'en-tête, y compris la carte DÉJÀ ouverte au chargement (la première, audit du 27/09/2026), et
// la carte cliquée reste visible. Sort en erreur (code 1) si l'un des cas échoue : c'est un témoin, pas une mesure.
// Usage : [AVEC_ANIMATION=1] node audits/2026-09-27/captures-d471/temoin-clic-volet.mjs <url-du-site> (sans la variable, le
// navigateur réduit les animations : défilement immédiat ; avec, défilement animé, attendu 1,5 s).
// Prérequis : le site local branché sur une API dont la base porte les offres témoins de `temoin-d471-seed.mts`.
import { chromium } from 'playwright';
const [base] = process.argv.slice(2);
const navigateur = await chromium.launch();
const echecs = [];
const resultats = [];
for (const [largeur, hauteur] of [[1440, 790], [1536, 730], [1280, 720], [1024, 680]]) {
  for (const cas of ['carte déjà ouverte', 'autre carte']) {
    const page = await navigateur.newPage({ viewport: { width: largeur, height: hauteur }, reducedMotion: process.env.AVEC_ANIMATION ? 'no-preference' : 'reduce' });
    await page.goto(`${base}/fr/emplois?marche=FR`, { waitUntil: 'networkidle', timeout: 180_000 });
    const ouverte = page.locator('.cw-emplois__colonne .cw-job-card.-active').first();
    const carte = cas === 'carte déjà ouverte' ? ouverte : page.locator('.cw-emplois__colonne .cw-job-card:not(.-active)').first();
    // PRÉMISSE : le volet n'est pas encore collé (sinon le clic n'a rien à faire défiler) et la carte visée existe.
    const avant = await page.evaluate(() => {
      const v = document.querySelector('.cw-emplois__volet');
      return { ecart: Math.round(v.getBoundingClientRect().top - parseFloat(getComputedStyle(v).top)), defilementMax: Math.round(document.scrollingElement.scrollHeight - innerHeight) };
    });
    if (avant.ecart <= 1 || (await carte.count()) === 0) { echecs.push(`${largeur}x${hauteur} ${cas} : prémisse non remplie ${JSON.stringify(avant)}`); await page.close(); continue; }
    await carte.click();
    // Attendre que le volet ait rejoint sa place (ou que la page ne puisse plus défiler) et que la position soit
    // stable, plutôt qu'un délai fixe : un délai de 700 ms échouait une fois sur quatre (audit du 28/09/2026).
    await page.waitForFunction(() => {
      const v = document.querySelector('.cw-emplois__volet');
      const ecart = v.getBoundingClientRect().top - parseFloat(getComputedStyle(v).top);
      const max = document.scrollingElement.scrollHeight - innerHeight;
      const stable = window.__dernier === scrollY; window.__dernier = scrollY;
      return stable && (ecart <= 1 || scrollY >= max - 1) && !document.querySelector('.cw-emplois__volet[aria-busy="true"]');
    }, null, { timeout: 10_000, polling: 150 }).catch(() => {});
    const apres = await page.evaluate(() => {
      const v = document.querySelector('.cw-emplois__volet');
      const h = innerHeight, vu = (e) => { const r = e?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= h; };
      return { defilement: Math.round(scrollY), ecart: Math.round(v.getBoundingClientRect().top - parseFloat(getComputedStyle(v).top)),
        carteVisible: vu(document.querySelector('.cw-emplois__colonne .cw-job-card.-active')), postuler: vu(document.querySelector('.cw-fiche__actions .cw-btn')) };
    });
    // Le volet a rejoint sa place, sauf si la page ne pouvait pas défiler davantage (liste courte, limite connue de R-139).
    const aSaPlace = apres.ecart <= 1 || apres.defilement >= avant.defilementMax - 1;
    resultats.push({ ecran: `${largeur}x${hauteur}`, cas, avant, apres, aSaPlace });
    if (!aSaPlace || apres.defilement === 0 || !apres.carteVisible || !apres.postuler) echecs.push(`${largeur}x${hauteur} ${cas} : ${JSON.stringify(apres)}`);
    await page.close();
  }
}
await navigateur.close();
console.log(JSON.stringify(resultats));
if (echecs.length) { console.error(`ÉCHEC\n${echecs.join('\n')}`); process.exit(1); }
console.error('OK : le volet rejoint sa place à chaque clic, la carte cliquée reste visible, « Postuler » aussi');
