/** Le portail C&A est rendu par JavaScript : on le REND, au lieu de conclure sur son HTML statique. */
import { fetchRenderedHtml } from '../../src/lib/browser.js';
import { detectFromHtml, detectAllLinkedAts } from '../../src/ats/detect.js';
const url = 'https://www.c-and-a.com/fr/fr/corporate/company/jobs';
const h = await fetchRenderedHtml(url);
console.log('octets rendus :', h.length);
const d = detectFromHtml(h, url);
console.log('détection :', d ? `${d.type} ${JSON.stringify(d.config)}` : 'aucune');
for (const x of detectAllLinkedAts(h, url).slice(0, 5)) console.log('  lien ATS ->', x.type, JSON.stringify(x.config).slice(0,110));
const hosts = [...new Set([...h.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]))]
  .filter((x) => /job|career|karriere|recruit|workday|success|smart|talent|phenom|icims|avature|softgarden|personio/i.test(x));
console.log('hôtes candidats :', hosts.slice(0, 12));
