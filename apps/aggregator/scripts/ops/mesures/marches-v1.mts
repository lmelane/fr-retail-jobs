/**
 * LES MARCHÉS SUR LE CATALOGUE CONSOLIDÉ — registre confronté au réel.
 *
 * `audit-step2-marches.mts` cartographie les marchés sur les offres ACTIVES. Ce script mesure le
 * périmètre du catalogue consolidé — les offres PUBLIABLES — et confronte le résultat au registre
 * `packages/db/marches.ts`, dont les `offresMesurees` datent du 2026-09-15.
 *
 * Trois questions, et trois seulement :
 *
 *   1. QUE DIT LE RÉEL pour chaque marché du registre : volume publiable, part de pays PROUVÉ ?
 *   2. QUELS PAYS SONT SERVIS SANS ÊTRE AU REGISTRE — du volume qu'aucun marché ne route ?
 *   3. QUELS MARCHÉS DU REGISTRE SONT VIDES ou presque, donc invendables en l'état ?
 *
 * On ne confond jamais REMPLI et PROUVÉ : `countryIntegrity` porte un verdict, et seuls
 * `RAW_COUNTRY_CODE`, `RAW_COUNTRY`, `VERIFIED` prouvent le pays
 * (`src/normalize/countryIntegrity.ts`). Un marché à 100 % de `countryCode` peut être à 11 % de
 * preuve — c'est le cas des Pays-Bas, mesuré.
 */
import { PrismaClient } from '@prisma/client';
import { CODES_MARCHE_LOCALISES, MARCHES_ROUTABLES, MARCHES } from '../../../../../packages/db/marches.js';

const url = process.env.DATABASE_URL ?? '';
if (!url) { console.error('DATABASE_URL requise.'); process.exit(2); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

const lignes = await prisma.$queryRawUnsafe<Array<{
  pays: string | null; offres: bigint; prouvees: bigint; sources: bigint; langues: string | null;
}>>(`
  WITH publiables AS (
    SELECT j.id, j."countryCode", j."countryIntegrity", j.language
      FROM "Job" j
     WHERE j."isActive" AND j."mergedIntoId" IS NULL
       AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."jobId" = j.id AND js."isActive"
                     AND (js."expiresAt" IS NULL OR js."expiresAt" > now())))
  SELECT p."countryCode" AS pays, count(*) AS offres,
         count(*) FILTER (WHERE p."countryIntegrity" IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED')) AS prouvees,
         (SELECT count(DISTINCT js."sourceKey") FROM "JobSource" js
           WHERE js."jobId" IN (SELECT id FROM publiables q WHERE q."countryCode" IS NOT DISTINCT FROM p."countryCode")) AS sources,
         string_agg(DISTINCT p.language, ',' ORDER BY p.language) AS langues
    FROM publiables p GROUP BY 1 ORDER BY 2 DESC`);

const parPays = new Map(lignes.map(l => [l.pays ?? '(aucun)', l]));
const total = lignes.reduce((n, l) => n + Number(l.offres), 0);
const routables = new Map(MARCHES_ROUTABLES.map(m => [m.code, m]));
const pct = (a: number, b: number) => b ? `${Math.round((100 * a) / b)}%` : '—';

console.log(`\n═══ MARCHÉS — CATALOGUE CONSOLIDÉ V1 · ${total} offres publiables ═══\n`);

console.log(`── 1. LES ${CODES_MARCHE_LOCALISES.length} MARCHÉS LOCALISÉS (interface traduite) ──\n`);
console.log(`   marché  locales        offres   prouvé  %prouvé  sources  langues`);
let volumeLocalise = 0;
for (const code of CODES_MARCHE_LOCALISES) {
  const l = parPays.get(code);
  const o = Number(l?.offres ?? 0), p = Number(l?.prouvees ?? 0);
  volumeLocalise += o;
  console.log(`   ${code.padEnd(7)} ${(MARCHES[code]?.locales?.join(' ') ?? '—').padEnd(13)} ${String(o).padStart(6)} ${String(p).padStart(8)} ${pct(p, o).padStart(8)} ${String(l?.sources ?? 0).padStart(8)}  ${l?.langues ?? '—'}`);
}
console.log(`\n   couverture des marchés localisés : ${volumeLocalise} / ${total} (${pct(volumeLocalise, total)})`);

console.log(`\n── 2. MARCHÉS ROUTABLES NON LOCALISÉS (servis, interface non traduite) ──\n`);
const nonLocalises = MARCHES_ROUTABLES.filter(m => !CODES_MARCHE_LOCALISES.includes(m.code as never));
let volumeRoutable = 0, routablesVides = 0;
for (const m of nonLocalises) {
  const o = Number(parPays.get(m.code)?.offres ?? 0);
  volumeRoutable += o;
  if (o === 0) routablesVides++;
}
console.log(`   ${nonLocalises.length} marchés routables · ${volumeRoutable} offres (${pct(volumeRoutable, total)}) · ${routablesVides} à ZÉRO offre`);
/* Un marché routable sans offre est une promesse vide : le nommer sert à décider s'il reste. */
const vides = nonLocalises.filter(m => Number(parPays.get(m.code)?.offres ?? 0) === 0).map(m => m.code);
if (vides.length) console.log(`   à zéro : ${vides.join(', ')}`);

console.log(`\n── 3. PAYS SERVIS HORS REGISTRE — volume qu'aucun marché ne route ──\n`);
const connus = new Set<string>([...MARCHES_ROUTABLES.map(m => m.code as string), ...CODES_MARCHE_LOCALISES]);
const horsRegistre = lignes.filter(l => l.pays && !connus.has(l.pays));
const volumeHors = horsRegistre.reduce((n, l) => n + Number(l.offres), 0);
console.log(`   ${horsRegistre.length} pays · ${volumeHors} offres (${pct(volumeHors, total)})`);
for (const l of horsRegistre.slice(0, 12)) console.log(`      ${l.pays}  ${String(l.offres).padStart(5)} offres · ${pct(Number(l.prouvees), Number(l.offres))} prouvé`);

const sansPays = parPays.get('(aucun)');
console.log(`\n── 4. SANS PAYS — UNKNOWN explicite, jamais inféré ──\n`);
console.log(`   ${Number(sansPays?.offres ?? 0)} offres (${pct(Number(sansPays?.offres ?? 0), total)}) · aucun marché attribuable`);

await prisma.$disconnect();
