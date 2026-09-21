/**
 * LE PORTAIL SERT-IL UNE MAISON OU PLUSIEURS ? — répondu par les RAW, pas par jugement.
 *
 * `portalScope` conditionne l'attribution automatique quand la page ne nomme aucun employeur.
 * C'est une donnée FACTUELLE : il suffit de compter les employeurs distincts que les annonces
 * de la source déclarent elles-mêmes. Une source dont toutes les annonces nomment le même
 * employeur est mono-marque ; plusieurs employeurs distincts = multimarque.
 */
import { ouvrirAccesAudit } from '../audit-acces.ts';
import { readRawBlob } from '../../../src/capture/store.js';
const { prisma } = await ouvrirAccesAudit();

const srcs = await prisma.$queryRawUnsafe<Array<{ key: string; maison: string; scope: string | null; annonces: bigint }>>(`
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       m AS (SELECT DISTINCT b."sourceKey" AS k FROM "CaptureBatch" b
              WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub))
  SELECT s.key, s.maison, s."portalScope" AS scope,
         (SELECT count(DISTINCT e."externalId") FROM "SourceExtraction" e
            JOIN "CaptureBatch" b2 ON b2.id = e."batchId" WHERE b2."sourceKey" = s.key) AS annonces
    FROM "Source" s WHERE s.key IN (SELECT k FROM m) AND s."portalScope" IS NULL AND s.status = 'ACTIVE'
   ORDER BY 4 DESC LIMIT 12`);

/** Les clés où un employeur se déclare, tous adaptateurs confondus. */
const CLES = ['company', 'companyName', 'employer', 'employerName', 'brand', 'brandName',
  'hiringOrganization', 'organization', 'maison', 'businessGroup', 'subsidiary'];

function employeurs(v: unknown, trouves = new Set<string>(), prof = 0): Set<string> {
  if (prof > 6 || v === null || typeof v !== 'object') return trouves;
  if (Array.isArray(v)) { for (const x of v) employeurs(x, trouves, prof + 1); return trouves; }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (CLES.includes(k)) {
      if (typeof val === 'string' && val.trim()) trouves.add(val.trim());
      else if (val && typeof val === 'object' && typeof (val as any).name === 'string') trouves.add((val as any).name.trim());
    }
    employeurs(val, trouves, prof + 1);
  }
  return trouves;
}

console.log('═══ EMPLOYEURS DÉCLARÉS DANS LE RAW — sources à portalScope NULL ═══\n');
for (const s of srcs) {
  const [cap] = await prisma.$queryRawUnsafe<Array<{ blobHash: string }>>(
    `SELECT c."blobHash" FROM "RawCapture" c JOIN "CaptureBatch" b ON b.id = c."batchId"
      WHERE b."sourceKey" = $1 AND c."blobHash" IS NOT NULL AND b.purpose = 'JOBS'
      ORDER BY c."capturedAt" DESC LIMIT 1`, s.key);
  if (!cap) { console.log(`  ${s.key.padEnd(26)} (aucun corps JOBS)`); continue; }
  try {
    const texte = new TextDecoder().decode(await readRawBlob(prisma, cap.blobHash));
    const noms = employeurs(JSON.parse(texte));
    const liste = [...noms].slice(0, 4).join(' | ') || '(aucun employeur nommé)';
    const verdict = noms.size === 0 ? 'PAGE NE NOMME PERSONNE' : noms.size === 1 ? 'MONO' : `${noms.size} employeurs`;
    console.log(`  ${s.key.slice(0, 26).padEnd(26)} ${String(s.annonces).padStart(5)} ann.  ${verdict.padEnd(22)} ${liste.slice(0, 60)}`);
  } catch (e) {
    console.log(`  ${s.key.slice(0, 26).padEnd(26)} ${String(s.annonces).padStart(5)} ann.  (corps illisible: ${String(e).slice(0, 40)})`);
  }
}
await prisma.$disconnect();
