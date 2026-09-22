/**
 * PREFLIGHT DU LOT GÉO — quelles sources rejouer, et pour combien d'offres RÉELLES.
 *
 * ── DEUX MESURES QU'ON NE CONFOND PAS ──────────────────────────────────────────────────────────
 *
 *   par JOBSOURCE        pour savoir QUELLES SOURCES rejouer ;
 *   par JOB CANONIQUE    pour le KPI produit — un Job servi par deux sources ne compte qu'UNE fois.
 *
 * Une première mesure tirait un `JobSource` arbitraire par Job (`LIMIT 1` sans ordre, sans filtre
 * d'expiration). Sur un Job multi-source le résultat n'était donc ni déterministe ni publiable,
 * et les Jobs multi-sources risquaient d'être comptés plusieurs fois. Ici on part des JobSource
 * PUBLIABLES, et on déduplique explicitement par `jobId`.
 *
 * Aucune écriture : ce script décide seulement du périmètre du rerun.
 */
import { PrismaClient } from '@prisma/client';
import { resolveGeography } from '../../../src/normalize/geography.js';
import { countryIntegrityOf } from '../../../src/normalize/countryIntegrity.js';

const url = process.env.DATABASE_URL ?? '';
if (!url) { console.error('DATABASE_URL requise.'); process.exit(2); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

const rangs = await prisma.$queryRawUnsafe<Array<{
  jobId: string; sourceKey: string; cc: string | null; ci: string | null;
  natif: string | null; location: string | null; city: string | null;
}>>(`
  SELECT js."jobId", js."sourceKey", j."countryCode" AS cc, j."countryIntegrity" AS ci,
         j.location, j.city,
         coalesce(js.raw->>'country',
                  js.raw->'_jobposting'->'jobLocation'->0->'address'->>'addressCountry',
                  js.raw->'location'->>'country',
                  js.raw->'address'->>'addressCountry') AS natif
    FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
   WHERE j."isActive" AND j."mergedIntoId" IS NULL
     AND js."isActive" AND (js."expiresAt" IS NULL OR js."expiresAt" > now())`);
await prisma.$disconnect();

type Gain = { jobId: string; sourceKey: string; pays: string; natif: string };
const gains: Gain[] = [];
const paysChanges: Array<{ jobId: string; sourceKey: string; de: string | null; vers: string; natif: string }> = [];

for (const r of rangs) {
  const natif = r.natif?.trim();
  if (!natif) continue;
  const geo = resolveGeography({ rawCountry: natif, location: r.location, city: r.city } as never);
  if (!geo.countryCode) continue;
  if (geo.countryCode !== r.cc) {
    paysChanges.push({ jobId: r.jobId, sourceKey: r.sourceKey, de: r.cc, vers: geo.countryCode, natif });
    continue;
  }
  /* Le gain visé, et lui seul : même pays, la preuve passe de rien à un verdict positif. */
  if (r.ci === null && countryIntegrityOf(geo, natif)) {
    gains.push({ jobId: r.jobId, sourceKey: r.sourceKey, pays: geo.countryCode, natif });
  }
}

const jobsUniques = new Set(gains.map(g => g.jobId));
const parSource = new Map<string, { jobs: Set<string>; motifs: Map<string, number> }>();
for (const g of gains) {
  const e = parSource.get(g.sourceKey) ?? { jobs: new Set<string>(), motifs: new Map<string, number>() };
  e.jobs.add(g.jobId);
  e.motifs.set(g.natif, (e.motifs.get(g.natif) ?? 0) + 1);
  parSource.set(g.sourceKey, e);
}

console.log(`\n═══ PREFLIGHT GÉO ═══\n`);
console.log(`   JobSource concernés        : ${gains.length}`);
console.log(`   JOB CANONIQUES UNIQUES     : ${jobsUniques.size}${gains.length !== jobsUniques.size ? `  (${gains.length - jobsUniques.size} servis par plusieurs sources)` : ''}`);
console.log(`   sources distinctes         : ${parSource.size}\n`);

console.log(`| sourceKey | Jobs concernés | motifs natifs |`);
console.log(`|---|---:|---|`);
for (const [cle, e] of [...parSource].sort((a, b) => b[1].jobs.size - a[1].jobs.size)) {
  const motifs = [...e.motifs].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, n]) => `${m} ×${n}`).join(', ');
  console.log(`| ${cle} | ${e.jobs.size} | ${motifs} |`);
}

/*
 * L'INTERSECTION AVEC LES PAYS CHANGÉS. Ces changements PRÉEXISTENT au correctif (prouvé en le
 * débranchant), mais si leur source figure dans le rerun, le pipeline les réécrirait pendant un
 * lot intitulé « preuve géographique ». On le dit avant, plutôt que de le découvrir après.
 */
const sourcesRerun = new Set(parSource.keys());
const intersection = paysChanges.filter(p => sourcesRerun.has(p.sourceKey));
console.log(`\n── PAYS CHANGÉS (préexistants, hors périmètre du lot) ──\n`);
console.log(`   total : ${paysChanges.length} · dans les sources à rejouer : ${intersection.length}${intersection.length ? '  ← À ISOLER' : '  ✓ aucune intersection'}`);
const parSourcePays = new Map<string, number>();
for (const p of paysChanges) parSourcePays.set(`${p.sourceKey} (${p.de ?? 'UNKNOWN'}→${p.vers}, « ${p.natif} »)`, (parSourcePays.get(`${p.sourceKey} (${p.de ?? 'UNKNOWN'}→${p.vers}, « ${p.natif} »)`) ?? 0) + 1);
for (const [k, n] of parSourcePays) console.log(`      ${k} : ${n} offre(s)${sourcesRerun.has(k.split(' ')[0]) ? '  ← DANS LE RERUN' : ''}`);

console.log(`\n   → clés pour le rerun :\n${[...sourcesRerun].sort().join(',')}\n`);
