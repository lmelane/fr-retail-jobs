import { chromium } from 'playwright';

/**
 * Capture les requêtes RÉSEAU d'un portail carrière pour trouver l'endpoint qui
 * sert réellement les offres.
 *
 * Pourquoi cet outil : les ATS modernes (iCIMS, Oracle HCM, les portails Vue /
 * Next) servent une coquille JavaScript — mesuré le 2026-09-05, la page URBN
 * fait 900 Ko sans contenir une seule offre, tout est chargé en XHR. Lire le
 * HTML rendu ne suffit donc pas : c'est l'APPEL qu'il faut voir, parce que
 * c'est lui que l'adaptateur rejouera.
 *
 * Lecture seule, aucune écriture en base. Sert à écrire un adaptateur, pas à
 * ingérer.
 */

const TARGETS: Array<{ name: string; url: string }> = [
  { name: 'urbn', url: 'https://hub-urbn.icims.com/jobs/search?ss=1&searchRelation=keyword_all' },
  { name: 'aeropostale', url: 'https://careers-aeropostale.icims.com/jobs/search?ss=1&searchRelation=keyword_all' },
  { name: 'carrefour', url: 'https://matchez-votre-cv.carrefour.fr/search' },
  { name: 'inditex', url: 'https://www.inditexpeople.com/fr/fr/joinus/offers' },
  { name: 'hm', url: 'https://career.hm.com/fr-fr/search/' },
];

/** Une requête qui rapporte des offres, par opposition aux assets et traceurs. */
const LOOKS_LIKE_JOBS = /job|vacan|offre|posting|requisition|search|career|position|opening/i;
const IS_ASSET = /\.(js|css|png|jpe?g|svg|woff2?|ico|gif|webp|mp4)(\?|$)|googletagmanager|clarity\.ms|doubleclick|facebook|hotjar/i;

const browser = await chromium.launch({ headless: true });

for (const target of TARGETS) {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'fr-FR',
  });
  const page = await context.newPage();
  const hits: Array<{ method: string; url: string; status: number; size: number }> = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (IS_ASSET.test(url) || !LOOKS_LIKE_JOBS.test(url)) return;
    const type = response.headers()['content-type'] ?? '';
    if (!/json|xml/.test(type)) return;
    let size = 0;
    try {
      size = (await response.body()).byteLength;
    } catch {
      /* corps illisible : la taille n'est qu'indicative */
    }
    hits.push({ method: response.request().method(), url, status: response.status(), size });
  });

  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(6000);
  } catch (error) {
    console.log(`${target.name}: NAVIGATION ${(error as Error).message.slice(0, 60)}`);
  }

  console.log(`\n=== ${target.name} — ${hits.length} appels de données ===`);
  for (const hit of hits.sort((a, b) => b.size - a.size).slice(0, 5)) {
    console.log(`  ${hit.status} ${hit.method} ${String(hit.size).padStart(7)}o  ${hit.url.slice(0, 130)}`);
  }
  await context.close();
}

await browser.close();
