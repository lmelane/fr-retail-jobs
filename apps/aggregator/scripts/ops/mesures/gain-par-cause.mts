/** Le gain net VENTILÉ PAR CAUSE de blocage — un total global n'est pas actionnable. */
import { ouvrirAccesAudit } from '../audit-acces.ts';
import { sourceSubjectKey } from '../../../src/connectors/sourceIdentity.js';
const { prisma } = await ouvrirAccesAudit();
const q = <T,>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);

const srcs = await q<any>(`
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       m AS (SELECT DISTINCT b."sourceKey" AS k FROM "CaptureBatch" b
              WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub))
  SELECT s.key, s.maison, s."portalScope", s."currentRevisionId", s."tenantKey", s.status::text AS status,
    (SELECT count(DISTINCT e."externalId") FROM "SourceExtraction" e
       JOIN "CaptureBatch" b2 ON b2.id = e."batchId" WHERE b2."sourceKey" = s.key) AS annonces,
    EXISTS (SELECT 1 FROM "SourceIngestionCompletion" c JOIN "CaptureBatch" b3 ON b3.id = c."batchId"
             WHERE b3."sourceKey" = s.key AND c."writeFailed" > 0) AS bloquee_identite,
    EXISTS (SELECT 1 FROM "CaptureBatch" b4 JOIN "CaptureOutcome" o ON o."batchId" = b4.id
             WHERE b4."sourceKey" = s.key AND o.status = 'EXTRACTED' AND b4."accessDecisionId" IS NULL) AS lots_sans_acces
   FROM "Source" s WHERE s.key IN (SELECT k FROM m)`);

const cls: Record<string, { n: number; ann: number; ex: string[] }> = {};
for (const s of srcs) {
  const [co] = await q<any>(`SELECT id FROM "Company" WHERE "fashionjobsUrl" = $1`, `resolved:${sourceSubjectKey(s)}`);
  let c: string;
  if (s.status !== 'ACTIVE') c = 'G. source non ACTIVE — exclue volontairement';
  else if (s.bloquee_identite && !s.portalScope) c = 'A. portalScope NULL — configuration absente';
  else if (s.bloquee_identite && s.portalScope === 'MULTI_BRAND') c = 'B. MULTI_BRAND — employeur par annonce';
  else if (s.bloquee_identite && !co) c = 'C. SINGLE_BRAND, Company introuvable';
  else if (s.bloquee_identite) c = 'D. SINGLE_BRAND + Company — blocage ailleurs';
  else if (s.lots_sans_acces) c = 'E. lots sans decision d acces';
  else c = 'F. aucune cause identifiee — a instruire';
  cls[c] ??= { n: 0, ann: 0, ex: [] };
  cls[c].n++; cls[c].ann += Number(s.annonces);
  if (cls[c].ex.length < 3 && Number(s.annonces) > 0) cls[c].ex.push(`${s.key}(${s.annonces})`);
}
console.log('═══ GAIN POTENTIEL PAR CAUSE — 144 sources muettes ═══\n');
let tot = 0;
for (const [k, v] of Object.entries(cls).sort((a, b) => b[1].ann - a[1].ann)) {
  tot += v.ann;
  console.log(`  ${String(v.n).padStart(3)} sources  ${String(v.ann).padStart(6)} annonces  ${k}`);
  if (v.ex.length) console.log(`                              ex. ${v.ex.join(', ')}`);
}
console.log(`\n  TOTAL ${tot} annonces distinctes (les causes sont EXCLUSIVES ici : une source = une classe)`);
await prisma.$disconnect();
