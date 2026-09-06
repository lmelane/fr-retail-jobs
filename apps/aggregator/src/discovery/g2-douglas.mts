import { fetchText } from '../lib/http.js';
import { htmlToPlainText } from '../lib/html.js';

/**
 * g2 — Douglas Group : lit le catalogue COMPLET dans l'état Frontity embarqué.
 *
 * careers.douglas.group est un WordPress headless (Frontity). La page
 * `/fr/jobs/` rend 12 cartes côté serveur, mais son `<script>` d'état
 * (`{"theme":…,"source":{"data":{"jobs":[…]}}}`, ~3,2 Mo) porte TOUTES les
 * offres, toutes langues, avec ville, pays, contrat, marque et — pour celles
 * qui viennent de SuccessFactors — la description HTML. Une seule requête.
 * Lecture seule.
 */
const ORIGIN = 'https://careers.douglas.group';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

type StateJob = {
  id: string;
  source?: string;
  title: string;
  url: string;
  description?: string;
  language?: { code?: string };
  city?: { value?: string; parent?: { value?: string } };
  country?: string;
  employment?: { value?: string };
  company?: { value?: string };
  department?: string;
  raw?: { created?: string; advertCreationDate?: number };
};

const t0 = Date.now();
const lang = process.argv[2] ?? 'fr';
const html = await fetchText(`${ORIGIN}/${lang}/jobs/`, { headers: { 'user-agent': UA } });
const script = /<script[^>]*>(\{"theme":[\s\S]*?)<\/script>/.exec(html)?.[1];
if (!script) throw new Error('état Frontity introuvable dans la page');
const state = JSON.parse(script);
const jobs = state?.source?.data?.jobs as StateJob[] | undefined;
if (!Array.isArray(jobs)) throw new Error('source.data.jobs absent de l’état');

const normalized = jobs.map((j) => ({
  externalId: String(j.id),
  baseId: String(j.id).split('-')[0],
  title: j.title,
  city: j.city?.value,
  country: j.country ?? j.city?.parent?.value,
  location: [j.city?.value, j.country].filter(Boolean).join(', '),
  url: j.url,
  contract: j.employment?.value,
  company: j.company?.value,
  language: j.language?.code,
  source: j.source || 'successfactors',
  postedAt: j.raw?.created ?? (j.raw?.advertCreationDate ? new Date(j.raw.advertCreationDate).toISOString() : undefined),
  description: htmlToPlainText(j.description ?? '') ?? '',
}));

const uniqueBase = new Set(normalized.map((n) => n.baseId));
console.log(
  `douglas (/${lang}/jobs/, ${Math.round(html.length / 1024)} Ko): ${normalized.length} entrées offre×langue, ${uniqueBase.size} postes uniques | ${normalized.filter((n) => n.location).length} lieu | ${normalized.filter((n) => n.description.length > 200).length} desc | ${Math.round((Date.now() - t0) / 1000)}s`,
);
const byLang: Record<string, number> = {};
const bySource: Record<string, number> = {};
const byCountry: Record<string, number> = {};
const byBrand: Record<string, number> = {};
for (const n of normalized) {
  byLang[n.language ?? '?'] = (byLang[n.language ?? '?'] ?? 0) + 1;
  bySource[n.source] = (bySource[n.source] ?? 0) + 1;
  byCountry[n.country ?? '?'] = (byCountry[n.country ?? '?'] ?? 0) + 1;
  byBrand[n.company ?? '?'] = (byBrand[n.company ?? '?'] ?? 0) + 1;
}
console.log(`   langues ${JSON.stringify(byLang)} | sources ${JSON.stringify(bySource)}`);
console.log(`   pays ${JSON.stringify(byCountry)} | marques ${JSON.stringify(byBrand)}`);
const ex = normalized.find((n) => n.description.length > 200)!;
console.log(`   ex: ${ex.title.slice(0, 50)} @ ${ex.location} | ${ex.contract} | ${ex.postedAt} | ${ex.url.slice(0, 90)}`);

/** Les 16 offres « behindbeauty » n'ont pas de description dans l'état : la page de détail en a-t-elle une ? */
const bb = normalized.find((n) => n.source === 'behindbeauty');
if (bb) {
  const detail = await fetchText(bb.url, { headers: { 'user-agent': UA } });
  const s2 = /<script[^>]*>(\{"theme":[\s\S]*?)<\/script>/.exec(detail)?.[1];
  const st2 = s2 ? JSON.parse(s2) : {};
  const found: string[] = [];
  const walk = (o: unknown) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      const d = (o as any).description;
      if (typeof d === 'string' && d.length > 200 && (o as any).url === bb.url) found.push(d);
      Object.values(o as object).forEach(walk);
    }
  };
  walk(st2?.source?.data);
  const jsonLd = (detail.match(/"@type":"JobPosting"/g) ?? []).length;
  console.log(`   behindbeauty détail ${bb.url.slice(0, 80)} → ${Math.round(detail.length / 1024)} Ko, description dans l'état: ${found.length ? found[0].length + ' c' : 'aucune'}, JSON-LD JobPosting: ${jsonLd}`);
}
