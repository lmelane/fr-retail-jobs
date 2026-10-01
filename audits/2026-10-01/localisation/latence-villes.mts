/**
 * D-496 — la latence de la résolution d'une ville (`resoudreVilles`, sans la mémoire de l'instance) et des suggestions de
 * villes (`suggestCities`), sur une base JETABLE portant la base de villes complète (GeoNames du 01/10/2026) et les lieux
 * des offres de production (export en lecture seule, `export-offres-geo.sql`). 7 tours, le premier jeté.
 * Usage : DATABASE_URL=<base jetable> npx tsx latence-villes.mts
 */
const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || !/d496/.test(url.pathname)) throw new Error('Base refusée');
const geo = await import('../../../apps/api/lib/geo.ts');
const { suggestCities } = await import('../../../apps/api/lib/suggestions.ts');
const { exigerPerimetre } = await import('../../../apps/api/lib/perimetre.ts');
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const mesurer = async (f: () => Promise<unknown>) => {
  const ms: number[] = [];
  let r: unknown;
  for (let t = 0; t < 7; t++) { geo.oublierVilles(); const d = performance.now(); r = await f(); if (t) ms.push(performance.now() - d); }
  return { mediane: Math.round(med(ms)), max: Math.round(Math.max(...ms)), r };
};
const cas: [string, string][] = [['FR', 'Chennevières-sur-Marne'], ['FR', 'Paris (75)'], ['FR', 'Paris 9e Arrondissement'], ['FR', 'Paris 15e (75)'],
  ['FR', '94430 Chennevières-sur-Marne (94)'], ['US', 'Beverly Hills'], ['US', 'Texas'], ['DE', 'München'], ['GB', 'Londres']];
for (const [m, saisie] of cas) {
  const r = await mesurer(() => geo.resoudreVilles([saisie], exigerPerimetre(m), 'fr'));
  console.log(`résolution ${m} « ${saisie} » : ${r.mediane} ms (max ${r.max}) → ${JSON.stringify((r.r as ({ libelle: string } | null)[])[0]?.libelle ?? null)}`);
}
const codes = await geo.resoudreVilles(['94430', 'SW1A 1AA'], exigerPerimetre('FR'), 'fr', new Set(['94430']));
console.log(`code postal FR « 94430 » → ${JSON.stringify(codes[0]?.libelle ?? null)}`);
for (const [m, q] of [['FR', 'Pa'], ['FR', 'Paris'], ['FR', 'Chenn'], ['FR', '9443'], ['FR', '7501'], ['US', 'Bev'], ['DE', 'Mün'], ['GB', 'Lon'], ['GB', 'SW1']] as [string, string][]) {
  const r = await mesurer(() => suggestCities(q, exigerPerimetre(m), m === 'DE' ? 'de-DE' : undefined));
  console.log(`suggestions ${m} « ${q} » : ${r.mediane} ms (max ${r.max}) → ${JSON.stringify(r.r)}`);
}
process.exit(0);
