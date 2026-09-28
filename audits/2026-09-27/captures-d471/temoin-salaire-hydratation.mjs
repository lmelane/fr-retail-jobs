// TÉMOIN D-473 §3 et audit du 28/09 : la fiche ne casse pas l'hydratation dans Safari (WebKit), dont les données ICU
// diffèrent de celles du serveur pour le salaire (« ￥ » et « ¥ » en japonais) et pour la date relative (« 7 døgn
// siden » et « 7 dager siden » en norvégien). Le témoin échoue (code 1) si React relève une erreur d'hydratation, ou
// si une prémisse ne tient pas (le serveur et WebKit formatent différemment). Le cas du yen demande l'offre témoin en
// yens (`--jpy` de `temoin-d471-seed.mts`), sinon il est sauté et le dit.
// Usage : node audits/2026-09-27/captures-d471/temoin-salaire-hydratation.mjs <url-du-site>
// Prérequis : le site local branché sur une API dont la base porte l'offre témoin en yens de `temoin-d471-seed.mts`.
import { webkit } from 'playwright';
const [base] = process.argv.slice(2);
const serveur = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(6_000_000);
const navigateur = await webkit.launch();
const page = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
const erreurs = [];
page.on('console', (m) => { if (/hydrat|did not match|mismatch/i.test(m.text())) erreurs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => { if (/hydrat/i.test(e.message)) erreurs.push(e.message.slice(0, 300)); });
const echecs = [];
const resultats = [];
const ouvrir = async (chemin) => { erreurs.length = 0; await page.goto(`${base}${chemin}`, { waitUntil: 'networkidle', timeout: 180_000 }); await page.waitForTimeout(1_500); };

// 1. Le salaire en yens, en japonais (D-473 §3). Sans l'offre témoin en yens (`--jpy`), ce cas est sauté et le dit.
await ouvrir('/ja/emplois/boutique-manager-cw_temoind473jpy?marche=JP');
const client = await page.evaluate(() => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(6_000_000));
const affiche = await page.evaluate(() => document.querySelector('.cw-fiche__salaire')?.textContent ?? null);
if (!affiche) resultats.push({ cas: 'yen', saute: 'offre témoin en yens absente (`temoin-d471-seed.mts --jpy`)' });
else {
  resultats.push({ cas: 'yen', serveur, client, affiche, erreurs: [...erreurs] });
  if (serveur === client) echecs.push('prémisse yen : le serveur et WebKit formatent le yen de la même façon');
  if (erreurs.length) echecs.push(`yen : erreur d'hydratation : ${erreurs[0]}`);
}

// 2. La date relative « Publiée il y a… » (audit du 28/09) : norvégien et chinois traditionnel, offre témoin Lancel.
for (const [langue, locale] of [['nb', 'nb-NO'], ['zh-Hant', 'zh-TW']]) {
  await ouvrir(`/${langue}/emplois/directeur-rice-de-boutique-cw_temoind471lancel`);
  const meta = await page.evaluate(() => document.querySelector('.cw-fiche__meta')?.textContent ?? null);
  // PRÉMISSE : WebKit écrit la date relative autrement que le serveur (Node) pour 7 jours dans cette langue.
  const cote = await page.evaluate((l) => new Intl.RelativeTimeFormat(l, { numeric: 'auto' }).format(-7, 'day'), locale);
  const noeud = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-7, 'day');
  resultats.push({ cas: `date ${langue}`, serveur: noeud, client: cote, meta, erreurs: [...erreurs] });
  if (noeud === cote) echecs.push(`prémisse ${langue} : Node et WebKit écrivent « il y a 7 jours » de la même façon`);
  if (erreurs.length) echecs.push(`${langue} : erreur d'hydratation : ${erreurs[0]}`);
}
await navigateur.close();
console.log(JSON.stringify(resultats));
if (echecs.length) { console.error(`ÉCHEC\n${echecs.join('\n')}`); process.exit(1); }
console.error('OK : aucune erreur d’hydratation, le texte du serveur est gardé');
