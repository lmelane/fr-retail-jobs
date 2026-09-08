import { readFileSync } from 'node:fs';
import { normalizeCountry } from '../normalize/country.js';

/**
 * l4 — exploration hors base de l'export `l4-export.mts` : quelles « villes »
 * ne sont pas des villes, et sous quelles formes. Aucun accès réseau.
 *
 * Usage : npx tsx src/discovery/l4-explore.mts <villes.json>
 */
type Row = { city: string | null; location: string | null; source: string | null; n: number };
const file = process.argv[2];
if (!file) throw new Error('usage: l4-explore.mts <villes.json>');
const { rows, total } = JSON.parse(readFileSync(file, 'utf8')) as { rows: Row[]; total: number };

const byCity = new Map<string, { n: number; sources: Map<string, number>; locations: Map<string, number> }>();
for (const r of rows) {
  if (!r.city) continue;
  const e = byCity.get(r.city) ?? { n: 0, sources: new Map(), locations: new Map() };
  e.n += r.n;
  e.sources.set(r.source ?? '?', (e.sources.get(r.source ?? '?') ?? 0) + r.n);
  if (r.location) e.locations.set(r.location, (e.locations.get(r.location) ?? 0) + r.n);
  byCity.set(r.city, e);
}
const cities = [...byCity.entries()].sort((a, b) => b[1].n - a[1].n);
const withCity = cities.reduce((a, [, e]) => a + e.n, 0);
console.log(`total ${total} | avec ville ${withCity} | villes distinctes ${cities.length}`);

function section(title: string, pred: (city: string) => boolean, limit = 80) {
  const hits = cities.filter(([c]) => pred(c));
  const n = hits.reduce((a, [, e]) => a + e.n, 0);
  console.log(`\n## ${title} — ${hits.length} formes / ${n} offres`);
  for (const [c, e] of hits.slice(0, limit)) {
    const src = [...e.sources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k}:${v}`).join(' ');
    const loc = [...e.locations.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    console.log(`${String(e.n).padStart(5)}  ${c}  [${src}]  loc=« ${loc.slice(0, 60)} »`);
  }
}

const MODE = /^(remote|flexible|hybrid|hybride|home ?office|onsite|on-site|home|various|multiple( locations)?|other|nationwide|anywhere|virtual|field|tbd|n\/a|global|europe|emea|apac|asia|worldwide|international|télétravail|teletravail|distanciel)$/i;
const STORE = /\b(store|mall|outlet|retail|distribution|warehouse|shopping|centre commercial|galeries?|boutique|corner|pop[- ]?up|flagship|support office|head office|headquarters|hq|office|womens|mens|fl|floor|plaza|center|centre|airport|aéroport|terminal|premium)\b/i;

section('1a. ville = pays (normalizeCountry répond)', (c) => !!normalizeCountry(c));
section('1b. ville = 2 lettres (état / ISO)', (c) => /^[A-Za-z]{2}$/.test(c) && !normalizeCountry(c));
section('1c. ville = mode de travail / non-lieu', (c) => MODE.test(c.trim()));
section('2a. libellé magasin / bureau (mots)', (c) => STORE.test(c), 120);
section('2b. code magasin en tête (« Nm 0212 … »)', (c) => /^[A-Za-z]{2,4}\s?\d{3,5}\b/.test(c), 60);
section('2c. avec chiffres (hors 2b)', (c) => /\d/.test(c) && !/^[A-Za-z]{2,4}\s?\d{3,5}\b/.test(c), 80);
section('3. CJK / non-latin', (c) => /[　-鿿가-힯Ѐ-ӿ؀-ۿ฀-๿぀-ヿ]/.test(c), 200);
section('6a. virgule / parenthèse / tiret espacé / slash', (c) => /[,()\/|]| - /.test(c), 120);
section('6b. tout en majuscules (≥3 lettres)', (c) => c === c.toUpperCase() && /[A-Z]{3,}/.test(c), 40);
section('6c. tout en minuscules', (c) => c === c.toLowerCase() && /[a-z]{3,}/.test(c), 40);
section('6d. suffixe pays / état collé (« Paris France », « Milano Italy »)', (c) => /\b(france|italy|italia|germany|deutschland|spain|united states|usa|uk|united kingdom|switzerland|belgium|netherlands|japan|china|canada|australia)$/i.test(c) && !normalizeCountry(c), 40);

console.log('\n## top 60 villes actuelles');
for (const [c, e] of cities.slice(0, 60)) console.log(`${String(e.n).padStart(5)}  ${c}`);

// Variantes : même clé sans accents / casse / tirets-espaces.
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-\s']+/g, ' ').trim();
const groups = new Map<string, Map<string, number>>();
for (const [c, e] of cities) {
  const k = fold(c);
  const g = groups.get(k) ?? new Map();
  g.set(c, e.n);
  groups.set(k, g);
}
const multi = [...groups.entries()].filter(([, g]) => g.size > 1).sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0));
console.log(`\n## variantes casse/accents/tirets — ${multi.length} groupes / ${multi.reduce((a, [, g]) => a + [...g.values()].reduce((x, y) => x + y, 0), 0)} offres (top 40)`);
for (const [k, g] of multi.slice(0, 40)) console.log(`${k}: ${[...g.entries()].map(([c, n]) => `${c}=${n}`).join(' | ')}`);
