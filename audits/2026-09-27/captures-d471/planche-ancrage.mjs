// Choix de l'ancrage vertical de la couverture (D-471), sur les visuels réels des offres Catwalks.
//
// Chaque colonne est une bande « largeur × hauteur @ ancrage » d'un visuel 16:9 recadré en `object-fit: cover`,
// réduite à LARGEUR px en gardant sa proportion : ce qui compte est la part de la hauteur du visuel qui reste
// visible, et où. Formats réels mesurés le 27/09/2026 :
//   1216x200 — fiche seule à 1440 px (29 % de la hauteur visible, la bande la plus serrée) ;
//   695x160  — volet de la liste à 1440 px (41 %) ;
//   390x122  — volet d'une page d'offre sur mobile, pleine chasse (56 %).
// Lecture humaine : un visage coupé se voit. Les visuels témoins passés en argument ouvrent la planche.
//
// Usage : COLONNES="1216x200@15%,1216x200@22%,1216x200@30%" LARGEUR=600 PAR_PLANCHE=20 SUFFIXE=zoom- \
//         node audits/2026-09-27/captures-d471/planche-ancrage.mjs <liste-json> <dossier-de-sortie> [url-témoin…]
// `<liste-json>` : la liste publique du backend (`GET https://catwalks.api.catwalks.io/api/jobs`), champ `thumbnail`.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const [liste, sortie, ...temoins] = process.argv.slice(2);
const visuels = [
  ...temoins,
  ...JSON.parse(readFileSync(liste, 'utf8')).map((o) => o.thumbnail).filter((u) => typeof u === 'string' && u.startsWith('https://storage.googleapis.com/')),
];
const L = Number(process.env.LARGEUR ?? 440);
const COLONNES = (process.env.COLONNES ?? '1216x200@0%,1216x200@20%,1216x200@30%,1216x200@40%,1216x200@50%').split(',').map((c) => {
  const [, w, h, ancrage] = /^(\d+)x(\d+)@(\d+%)$/.exec(c) ?? [];
  if (!w) throw new Error(`colonne illisible : ${c}`);
  return { titre: c, hauteur: Math.round((L * Number(h)) / Number(w)), ancrage };
});
const LIGNE = Math.max(...COLONNES.map((c) => c.hauteur)) + 6;
const bande = (u, c) => `<div style="width:${L}px;height:${c.hauteur}px;overflow:hidden;background:#eee;flex:none"><img src="${u}" style="width:100%;height:100%;object-fit:cover;object-position:center ${c.ancrage}"></div>`;
const tete = `<div style="display:flex;gap:6px;height:20px"><b style="width:28px"></b>${COLONNES.map((c) => `<b style="width:${L}px">${c.titre}</b>`).join('')}</div>`;
const ligne = (u, i) => `<div style="display:flex;gap:6px;height:${LIGNE}px;align-items:flex-start"><b style="width:28px">${i < temoins.length ? 'T' : ''}${i + 1}</b>${COLONNES.map((c) => bande(u, c)).join('')}</div>`;
const html = `<body style="margin:8px;font:12px sans-serif">${tete}${visuels.map(ligne).join('')}</body>`;

const navigateur = await chromium.launch();
const page = await navigateur.newPage({ viewport: { width: 8 + 34 + COLONNES.length * (L + 6), height: 900 } });
await page.setContent(html, { waitUntil: 'networkidle', timeout: 180_000 });
const pas = Number(process.env.PAR_PLANCHE ?? 31);
for (let i = 0; i < visuels.length; i += pas) {
  await page.screenshot({
    fullPage: true,
    path: `${sortie}/planche-ancrage-${process.env.SUFFIXE ?? ''}${i / pas + 1}.png`,
    clip: { x: 0, y: 28 + i * LIGNE, width: 8 + 34 + COLONNES.length * (L + 6), height: Math.min(pas, visuels.length - i) * LIGNE },
  });
}
console.log(JSON.stringify({ visuels: visuels.length, temoins: temoins.length, colonnes: COLONNES.map((c) => c.titre) }));
await navigateur.close();
