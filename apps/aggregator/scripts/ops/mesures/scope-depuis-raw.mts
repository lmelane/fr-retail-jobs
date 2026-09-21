/**
 * DÉTERMINER `portalScope` DEPUIS LE RAW — une mesure, pas un jugement.
 *
 * Le RAW nomme souvent l'employeur (`hiringOrganization`, `company`…). Compter les employeurs
 * DISTINCTS d'une source répond factuellement : un seul = mono-marque, plusieurs = multimarque,
 * aucun = la page ne nomme personne (et c'est là que la certification est requise).
 *
 * PRUDENCE — trois limites assumées :
 *  · un échantillon de captures ne prouve pas l'absence : « aucun employeur vu » n'est pas
 *    « aucun employeur déclaré » ;
 *  · les corps HTML ne sont pas analysés ici (sonde JSON seulement) ;
 *  · des raisons sociales voisines (« Coach Vietnam », « Coach Korea ») peuvent désigner des
 *    filiales d'une même Maison : le comptage brut SURESTIME la pluralité.
 */
import { ouvrirAccesAudit } from '../audit-acces.ts';
import { readRawBlob } from '../../../src/capture/store.js';
const { prisma } = await ouvrirAccesAudit();

const srcs = await prisma.$queryRawUnsafe<Array<{ key: string; maison: string; annonces: bigint }>>(`
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       m AS (SELECT DISTINCT b."sourceKey" AS k FROM "CaptureBatch" b
              WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub))
  SELECT s.key, s.maison,
         (SELECT count(DISTINCT e."externalId") FROM "SourceExtraction" e
            JOIN "CaptureBatch" b2 ON b2.id = e."batchId" WHERE b2."sourceKey" = s.key) AS annonces
    FROM "Source" s
   WHERE s.key IN (SELECT k FROM m) AND s."portalScope" IS NULL AND s.status = 'ACTIVE'
   ORDER BY 3 DESC`);

const CLES = new Set(['hiringOrganization', 'company', 'companyName', 'employer', 'employerName', 'brand']);
function noms(v: unknown, out = new Set<string>(), p = 0): Set<string> {
  if (p > 6 || v === null || typeof v !== 'object') return out;
  if (Array.isArray(v)) { for (const x of v) noms(x, out, p + 1); return out; }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (CLES.has(k)) {
      const n = typeof val === 'string' ? val : (val as any)?.name;
      if (typeof n === 'string' && n.trim()) out.add(n.trim());
    }
    noms(val, out, p + 1);
  }
  return out;
}

const bilan = { MONO: 0, MULTI: 0, ANONYME: 0, NON_LISIBLE: 0 } as Record<string, number>;
const ann = { MONO: 0, MULTI: 0, ANONYME: 0, NON_LISIBLE: 0 } as Record<string, number>;
for (const s of srcs) {
  const caps = await prisma.$queryRawUnsafe<Array<{ blobHash: string }>>(
    `SELECT c."blobHash" FROM "RawCapture" c JOIN "CaptureBatch" b ON b.id = c."batchId"
      WHERE b."sourceKey" = $1 AND c."blobHash" IS NOT NULL AND b.purpose = 'JOBS'
      ORDER BY c."capturedAt" DESC LIMIT 25`, s.key);
  const vus = new Set<string>();
  let lisible = false;
  for (const c of caps) {
    try {
      const o = JSON.parse(new TextDecoder().decode(await readRawBlob(prisma, c.blobHash)));
      lisible = true;
      for (const n of noms(o)) vus.add(n);
    } catch { /* HTML ou corps illisible : compté comme non lisible par cette sonde */ }
  }
  const cls = !lisible ? 'NON_LISIBLE' : vus.size === 0 ? 'ANONYME' : vus.size === 1 ? 'MONO' : 'MULTI';
  bilan[cls]++; ann[cls] += Number(s.annonces);
}
console.log(`═══ ${srcs.length} SOURCES À portalScope NULL — verdict depuis le RAW ═══\n`);
for (const k of ['MONO', 'MULTI', 'ANONYME', 'NON_LISIBLE'])
  console.log(`  ${k.padEnd(12)} ${String(bilan[k]).padStart(4)} sources  ${String(ann[k]).padStart(6)} annonces`);
console.log('\n  MONO        : le RAW nomme UN employeur — scope déductible');
console.log('  MULTI       : plusieurs employeurs — MULTI_BRAND, attribution par annonce');
console.log('  ANONYME     : la page ne nomme personne — certification requise (règle du 09/09)');
console.log('  NON_LISIBLE : corps HTML, non analysé par cette sonde JSON — NON MESURÉ');
await prisma.$disconnect();
