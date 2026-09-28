// Audit 4 — A4 : le salaire (logique de FicheEmploi.salaire, D-473 §3) rendu par Node (serveur) et par les navigateurs
// (hydratation). Un texte différent = erreur d'hydratation React (le client re-rend la page).
import { chromium, webkit, firefox } from 'playwright';
const LANGUES = ["fr","en","de","it","es","nl","zh-CN","ja","ko","pt","pt-BR","da","zh-Hant","pl","sv","tr","th","ms","ar","nb","el","vi","cs","hu","ro"];
const DEVISES = ["EUR","GBP","USD","CHF","JPY","CNY","HKD","SGD","AED","SAR","SEK","DKK","NOK","PLN","CZK","HUF","RON","TRY","THB","MYR","VND","KRW","TWD","BRL","AUD","CAD","INR","MXN","QAR","KWD","ILS","ZAR","IDR","PHP","NZD"];
const MONTANTS = [45000, 13.5, 1800];
function calcul(LANGUES, DEVISES, MONTANTS) {
  const localeIntl = (langue) => langue === "en" ? "en-GB" : (langue === "zh-Hant" ? "zh-Hant-TW" : new Intl.Locale(langue, { region: new Intl.Locale(langue).maximize().region }).toString());
  const f = (n, devise, langue) => {
    const decimales = Number.isInteger(n) ? 0 : 2;
    const chiffres = { minimumFractionDigits: decimales, maximumFractionDigits: decimales };
    if (/^[A-Z]{3}$/.test(devise)) { try { return new Intl.NumberFormat(localeIntl(langue), { ...chiffres, style: "currency", currency: devise }).format(n); } catch {} }
    return `${new Intl.NumberFormat(localeIntl(langue), chiffres).format(n)} ${devise}`.trim();
  };
  const out = {};
  for (const l of LANGUES) for (const d of DEVISES) for (const m of MONTANTS) out[`${l}|${d}|${m}`] = f(m, d, l);
  return out;
}
const serveur = calcul(LANGUES, DEVISES, MONTANTS);
const resultat = { total: Object.keys(serveur).length, navigateurs: {} };
for (const [nom, type] of [["chromium", chromium], ["webkit", webkit], ["firefox", firefox]]) {
  let b; try { b = await type.launch(); } catch (e) { resultat.navigateurs[nom] = { erreur: String(e).slice(0, 120) }; continue; }
  const page = await b.newPage();
  const client = await page.evaluate(`(${calcul.toString()})(${JSON.stringify(LANGUES)}, ${JSON.stringify(DEVISES)}, ${JSON.stringify(MONTANTS)})`);
  const version = b.version();
  const ecarts = Object.keys(serveur).filter((k) => serveur[k] !== client[k]);
  const parLangue = {}; for (const k of ecarts) { const l = k.split('|')[0]; parLangue[l] = (parLangue[l] ?? 0) + 1; }
  resultat.navigateurs[nom] = { version, ecarts: ecarts.length, parLangue, exemples: ecarts.slice(0, 12).map((k) => ({ k, serveur: serveur[k], client: client[k] })) };
  await b.close();
}
// Quelques rendus « serveur » à lire (forme, ordre symbole/montant, chiffres).
resultat.lectures = Object.fromEntries(["fr|EUR|45000","fr|USD|45000","fr|GBP|45000","fr|CHF|45000","fr|JPY|13.5","en|EUR|45000","en|USD|45000","de|CHF|45000","ja|JPY|45000","ja|EUR|45000","zh-CN|CNY|45000","ar|AED|45000","ar|EUR|45000","th|THB|45000","ko|KRW|45000","sv|SEK|45000","nb|NOK|45000","pl|PLN|13.5","hu|HUF|13.5","vi|VND|45000","zh-Hant|TWD|45000","ms|MYR|45000","tr|TRY|45000","pt-BR|BRL|13.5","el|EUR|13.5","cs|CZK|45000","ro|RON|45000","da|DKK|45000","nl|EUR|45000","es|EUR|45000","it|EUR|45000"].map((k) => [k, serveur[k]]));
console.log(JSON.stringify(resultat, null, 1));
