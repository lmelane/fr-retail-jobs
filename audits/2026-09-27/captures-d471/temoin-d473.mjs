// TÉMOIN D-473 (R-139), au navigateur, sur le site réel. Sort en erreur (code 1) si un cas échoue.
//  1. Bureau, arrivée sur la page d'une offre (fiche seule comme depuis un moteur, ou avec la liste) : titre, salaire
//     et « Postuler » au premier écran, SANS animation (position relevée à chaque image : aucune intermédiaire).
//  2. Bureau, retour arrière vers la page d'une offre : la position quittée revient, la page ne redéfile pas.
//  3. Mobile, « Toutes les offres » après un toucher dans la liste : retour à la place quittée (carte visible) ;
//     sans toucher (arrivée directe), sur une NOUVELLE entrée de la même offre (A → B → A, retour d'inscription
//     simulé par `location.replace`) : la recherche s'ouvre en haut ; revenu par le navigateur sur l'entrée ouverte
//     depuis la liste : retour à la liste.
//  4. Le salaire s'écrit avec le symbole de sa devise.
// Usage : node audits/2026-09-27/captures-d471/temoin-d473.mjs <url-du-site>
// Prérequis : le site local branché sur une API dont la base porte les offres témoins de `temoin-d471-seed.mts`.
import { chromium } from 'playwright';
const [base] = process.argv.slice(2);
const OFFRE = '/fr/emplois/directeur-rice-de-boutique-cw_temoind471lancel';
const echecs = [], resultats = [];
const verifier = (nom, ok, detail) => { resultats.push({ nom, ok, ...detail }); if (!ok) echecs.push(`${nom} : ${JSON.stringify(detail)}`); };
const premierEcran = (page) => page.evaluate(() => {
  const h = innerHeight, vu = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= h; };
  return { defilement: Math.round(scrollY), titre: vu('.cw-fiche__titre'), salaire: vu('.cw-fiche__salaire'), postuler: vu('.cw-fiche__actions .cw-btn'),
    texteSalaire: document.querySelector('.cw-fiche__salaire')?.textContent ?? null };
});
const navigateur = await chromium.launch();

for (const q of ['', '?marche=FR']) for (const [l, h] of [[1440, 790], [1536, 730], [1280, 720], [1024, 680]]) {
  // Animations NON réduites : c'est là que `scroll-behavior: smooth` animait l'arrivée (audit du 28/09/2026).
  const page = await navigateur.newPage({ viewport: { width: l, height: h }, reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    window.__positions = [];
    const relever = () => { window.__positions.push(Math.round(window.scrollY)); if (window.__positions.length < 600) requestAnimationFrame(relever); };
    requestAnimationFrame(relever);
  });
  await page.goto(`${base}${OFFRE}${q}`, { waitUntil: 'networkidle', timeout: 180_000 });
  await page.waitForTimeout(600);
  const m = await premierEcran(page);
  const positions = await page.evaluate(() => [...new Set(window.__positions)]);
  const intermediaires = positions.filter((y) => y !== 0 && y !== m.defilement);
  verifier(`arrivée bureau ${q || '(fiche seule)'} ${l}x${h}`, m.defilement > 0 && m.titre && m.salaire && m.postuler && intermediaires.length === 0,
    { ...m, positionsIntermediaires: intermediaires.length });
  if (q === '' && l === 1440) verifier('symbole de la devise', /^45\s?000\s?€ à 55\s?000\s?€ par an$/.test((m.texteSalaire ?? '').replace(/[  ]/g, ' ')), { texte: m.texteSalaire });
  await page.close();
}

{ // Retour arrière : la page quittée en haut revient en haut.
  const page = await navigateur.newPage({ viewport: { width: 1440, height: 790 } });
  await page.goto(`${base}${OFFRE}?marche=FR`, { waitUntil: 'networkidle', timeout: 180_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.goto(`${base}/fr/emplois/maisons?marche=FR`, { waitUntil: 'networkidle', timeout: 180_000 });
  await page.goBack({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const apres = await page.evaluate(() => ({ defilement: Math.round(scrollY), type: performance.getEntriesByType('navigation')[0]?.type }));
  // PRÉMISSE : le document a été rechargé par le retour (`back_forward`) ; restauré du cache, le cas ne testerait rien.
  verifier('retour arrière bureau : pas de défilement imposé', apres.type === 'back_forward' && apres.defilement === 0, apres);
  await page.close();
}

{ // Mobile : toucher une carte, puis « Toutes les offres ».
  const page = await navigateur.newPage({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
  await page.goto(`${base}/fr/emplois?marche=FR`, { waitUntil: 'networkidle', timeout: 180_000 });
  const carte = page.locator('a[href*="cw_temoind471lancel"]').first();
  await carte.scrollIntoViewIfNeeded();
  const avant = await page.evaluate(() => Math.round(scrollY));
  // PRÉMISSE : la liste a défilé avant le toucher, sinon le retour en haut et le retour à la place se confondent.
  if (avant <= 0) echecs.push(`prémisse mobile : défilement ${avant}`);
  await carte.click();
  await page.waitForURL(/cw_temoind471lancel/, { timeout: 60_000 });
  await page.waitForLoadState('networkidle');
  await page.locator('.cw-emplois-page__retour.-mobile a').click();
  await page.waitForURL((u) => !u.pathname.includes('cw_temoind471lancel'), { timeout: 60_000 });
  await page.waitForTimeout(700);
  const retour = await page.evaluate(() => ({ defilement: Math.round(scrollY), carteVisible: (() => { const r = document.querySelector('a[href*="cw_temoind471lancel"]')?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= innerHeight; })() }));
  verifier('mobile : « Toutes les offres » revient à la place quittée', retour.carteVisible && retour.defilement > 0, { avant, ...retour });
  // Arrivée directe sur la page de l'offre : le lien ouvre la recherche en haut.
  await page.goto(`${base}${OFFRE}?marche=FR`, { waitUntil: 'networkidle', timeout: 180_000 });
  await page.locator('.cw-emplois-page__retour.-mobile a').click();
  await page.waitForURL((u) => !u.pathname.includes('cw_temoind471lancel'), { timeout: 60_000 });
  await page.waitForTimeout(500);
  const direct = await page.evaluate(() => ({ url: location.pathname + location.search, defilement: Math.round(scrollY) }));
  verifier('mobile : sans toucher dans la liste, le lien ouvre la recherche', direct.url === '/fr/emplois?marche=FR' && direct.defilement === 0, direct);
  await page.close();
}

const MANDAT = '/fr/emplois/conseiller-ere-de-vente-en-alternance-paris-cw_temoind471mandat?marche=FR';
const toucherLancel = async (page) => {
  await page.goto(`${base}/fr/emplois?marche=FR`, { waitUntil: 'networkidle', timeout: 180_000 });
  const carte = page.locator('a[href*="cw_temoind471lancel"]').first();
  await carte.scrollIntoViewIfNeeded();
  await carte.click();
  await page.waitForURL(/cw_temoind471lancel/, { timeout: 60_000 });
  await page.waitForLoadState('networkidle');
};
const lienRetour = async (page) => {
  await page.locator('.cw-emplois-page__retour.-mobile a').click();
  await page.waitForURL((u) => !u.pathname.includes('cw_temoind471lancel'), { timeout: 60_000 });
  await page.waitForTimeout(500);
  return page.evaluate(() => ({ url: location.pathname + location.search, defilement: Math.round(scrollY) }));
};
for (const [nom, detour] of [
  ['A → B → A', async (page) => { await page.goto(`${base}${MANDAT}`, { waitUntil: 'networkidle' }); await page.goto(`${base}${OFFRE}?marche=FR`, { waitUntil: 'networkidle' }); }],
  ['retour d’inscription simulé', async (page) => { await page.goto(`${base}/fr/emplois/maisons?marche=FR`, { waitUntil: 'networkidle' }); await page.evaluate((u) => location.replace(u), `${base}${OFFRE}?marche=FR`); await page.waitForURL(/cw_temoind471lancel/); await page.waitForLoadState('networkidle'); }],
]) {
  const page = await navigateur.newPage({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
  await toucherLancel(page);
  await detour(page);
  const r = await lienRetour(page);
  // Une nouvelle entrée de la même offre : le lien ouvre la recherche, il ne revient pas vers le détour.
  verifier(`mobile : ${nom}, le lien ouvre la recherche`, r.url === '/fr/emplois?marche=FR' && r.defilement === 0, r);
  await page.close();
}
{
  const page = await navigateur.newPage({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
  await toucherLancel(page);
  const avant = await page.evaluate(() => history.length);
  await page.goto(`${base}${MANDAT}`, { waitUntil: 'networkidle' });
  await page.goBack({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const r = await lienRetour(page);
  verifier('mobile : revenu sur l’entrée ouverte depuis la liste, le lien y ramène', r.url === '/fr/emplois?marche=FR' && r.defilement > 0, { ...r, longueurHistorique: avant });
  await page.close();
}
await navigateur.close();
console.log(JSON.stringify(resultats));
if (echecs.length) { console.error(`ÉCHEC\n${echecs.join('\n')}`); process.exit(1); }
console.error(`OK : ${resultats.length} cas`);
