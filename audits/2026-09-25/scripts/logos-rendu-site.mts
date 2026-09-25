/**
 * LOGOS DES MAISONS : CE QUE LE NAVIGATEUR AFFICHE RÉELLEMENT (25/09/2026, retour CEO : Lovisa, Courir)
 *
 * `logos-societes.mts` mesure la base, l'API et le proxy. Ce script regarde le RENDU : pour chaque
 * pastille `.cw-logo-maison` d'une page du site de test, l'élément réellement présent une fois la page
 * hydratée — une image chargée, une image CASSÉE (chargement terminé, largeur naturelle nulle), ou le
 * monogramme de repli — avec le nom de la Maison de sa carte. Deux largeurs : bureau et téléphone.
 *
 * Lecture seule : de simples chargements de pages publiques. Aucune base, aucun secret.
 *
 *   npx tsx audits/2026-09-25/scripts/logos-rendu-site.mts [URL de base] [chemin…]
 *
 * Captures d'écran : dossier indiqué par `CW_CAPTURES` (sinon aucune capture).
 */
import { chromium } from 'playwright';

const BASE = process.argv[2]?.startsWith('http') ? process.argv[2] : 'https://catwalks-front-end-git-development-catwalks-9c91c4d2.vercel.app';
const chemins = process.argv.slice(process.argv[2]?.startsWith('http') ? 3 : 2);
const PAGES = chemins.length ? chemins : ['/fr/emplois?q=lovisa', '/fr/emplois?q=courir', '/fr/emplois/maisons?q=lovisa', '/fr/emplois/maisons?q=courir'];
const LARGEURS = [{ nom: 'bureau', width: 1440, height: 900 }, { nom: 'téléphone', width: 375, height: 812 }];
const CAPTURES = process.env.CW_CAPTURES;

const navigateur = await chromium.launch();
try {
  for (const largeur of LARGEURS) {
    for (const chemin of PAGES) {
      const page = await navigateur.newPage({ viewport: { width: largeur.width, height: largeur.height } });
      const logos: Array<{ url: string; statut: number }> = [];
      page.on('response', (r) => { if (r.url().includes('/api/emplois/logo')) logos.push({ url: r.url(), statut: r.status() }); });
      await page.goto(`${BASE}${chemin}`, { waitUntil: 'networkidle', timeout: 60_000 });
      // Les images différées sous la ligne de flottaison ne se chargent qu'au défilement : on descend puis on remonte.
      await page.evaluate(async () => { window.scrollTo(0, document.body.scrollHeight); await new Promise((r) => setTimeout(r, 1500)); window.scrollTo(0, 0); });
      await page.waitForLoadState('networkidle');
      const pastilles = await page.$$eval('.cw-logo-maison', (els) => els.map((el) => {
        const carte = el.closest('a, article, li, section');
        const nom = carte?.querySelector('.cw-job-card__position-title, .cw-job-card__maison, h1, h2, h3')?.textContent?.trim() ?? '';
        if (el instanceof HTMLImageElement) {
          const casse = el.complete && el.naturalWidth === 0;
          return { etat: casse ? 'IMAGE_CASSEE' : el.complete ? 'IMAGE' : 'IMAGE_EN_COURS', src: el.getAttribute('src'), largeurNaturelle: el.naturalWidth, nom };
        }
        return { etat: 'MONOGRAMME', texte: el.textContent?.trim(), nom };
      }));
      const bilan = pastilles.reduce<Record<string, number>>((n, p) => ({ ...n, [p.etat]: (n[p.etat] ?? 0) + 1 }), {});
      console.log(`\n${largeur.nom} ${largeur.width}px · ${chemin} · pastilles ${pastilles.length} · ${JSON.stringify(bilan)}`);
      const vus = new Set<string>();
      for (const p of pastilles) {
        const cle = `${p.etat}|${'src' in p ? p.src : p.texte}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        console.log(`  ${p.etat.padEnd(15)} ${'src' in p ? `${p.src} (naturalWidth ${p.largeurNaturelle})` : `« ${p.texte} »`}  · carte : ${p.nom.slice(0, 60)}`);
      }
      const parStatut = logos.reduce<Record<string, number>>((n, l) => ({ ...n, [l.statut]: (n[l.statut] ?? 0) + 1 }), {});
      console.log(`  réponses /api/emplois/logo : ${JSON.stringify(parStatut)}`);
      if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/${largeur.nom}-${chemin.replace(/[^a-z0-9]+/gi, '_')}.png`, fullPage: false });
      await page.close();
    }
  }
} finally {
  await navigateur.close();
}
