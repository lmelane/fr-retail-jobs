/**
 * D-488 — LATENCE LOCALE de la recherche servie (`getJobs`, toute la chaîne : plan, index, SQL, pages, facettes), avant
 * et après la restriction aux langues du marché. Base JETABLE uniquement (`seed.mts`, v3 activée par l'outillage,
 * stock reclassé, génération search-5 construite) ; même base et même génération pour les deux codes, seul change
 * l'arbre du code (CODE_ROOT). Un processus par code, lancés l'un après l'autre (puis dans l'ordre inverse), chacun 7
 * tours (le premier chauffe, jeté) ; médiane et maximum des 6 autres.
 *
 * Usage : CODE_ROOT=<arbre> DATABASE_URL=<base jetable> npx tsx latence.mts <étiquette> > resultat.json
 */
const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || url.port !== '56632' || url.pathname !== '/catwalks_d488_mesure') throw new Error('Base refusée');
const jobs = await import(`${process.env.CODE_ROOT}/apps/api/lib/jobs.ts`);
const CAS: [string, string][] = [
  ['FR', 'conseiller de vente'], ['FR', 'vendeur'], ['FR', 'responsable de boutique'], ['FR', 'hôte de caisse'], ['FR', 'visual merchandiser'],
  ['US', 'sales advisor'], ['US', 'store manager'], ['GB', 'sales advisor'], ['DE', 'Verkaufsberater'], ['IT', 'addetto vendite'],
  ['CH', 'conseiller de vente'], ['JP', 'セールスアドバイザー'], ['CN', '销售顾问'], ['FR', 'chanel'], ['FR', 'stage marketing'],
];
const res: Record<string, { total: number; premiers: string[]; ms: number[] }> = {};
for (let tour = 0; tour < 7; tour++)
  for (const [marche, q] of CAS) {
    const t = performance.now();
    const r = await jobs.getJobs(jobs.parseFilters({ marche, q }));
    const ms = performance.now() - t;
    const cle = `${marche} ${q}`;
    res[cle] ??= { total: r.total, premiers: r.jobs.map((j: { id: string }) => j.id), ms: [] };
    if (tour > 0) res[cle].ms.push(Math.round(ms));
  }
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
console.log(JSON.stringify({ etiquette: process.argv[2], cas: Object.fromEntries(Object.entries(res).map(([k, x]) =>
  [k, { total: x.total, premiers: x.premiers, medianeMs: med(x.ms), maxMs: Math.max(...x.ms) }])) }, null, 1));
process.exit(0);
