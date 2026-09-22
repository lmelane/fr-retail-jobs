/**
 * PAYS ET MARCHÉS SUR `CATALOGUE_CONSOLIDE_V1` — le registre fait foi, jamais le code pays.
 *
 * ── L'ERREUR QUE CE SCRIPT NE COMMET PLUS ──────────────────────────────────────────────────────
 *
 * Une première mesure assimilait `marketCode = countryCode` et rangeait donc l'Irlande et
 * l'Autriche parmi les « pays hors registre ». C'est faux : le registre déclare
 * `MARCHES.GB.pays = ['GB','IE']` et `MARCHES.DE.pays = ['DE','AT']`. Un marché n'est pas un pays,
 * c'est un ENSEMBLE de pays servis sous une même interface.
 *
 * Le mapping `countryCode → marketCode` est donc construit depuis les tableaux `pays` du registre,
 * et un pays n'est « hors registre » que s'il est absent de TOUS ces tableaux.
 *
 * ── DEUX DISTINCTIONS QU'ON NE MÉLANGE JAMAIS ──────────────────────────────────────────────────
 *
 * 1. `countryIntegrity = null` signifie **PAYS NON PROUVÉ**, jamais « pays faux ». C'est l'absence
 *    d'une provenance assez forte pour attester, pas une contradiction
 *    (`src/normalize/countryIntegrity.ts`).
 *
 * 2. Les **locales produit** (l'interface proposée au candidat) ne sont pas les **langues des
 *    annonces** (ce que la source a publié). Un marché peut servir des annonces anglaises sous une
 *    interface néerlandaise.
 */
import { PrismaClient } from '@prisma/client';
import { CODES_MARCHE_LOCALISES, MARCHES, MARCHES_ROUTABLES } from '../../../../../packages/db/marches.js';

const url = process.env.DATABASE_URL ?? '';
if (!url) { console.error('DATABASE_URL requise.'); process.exit(2); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

/* ── LE MAPPING, ET SES CONTRÔLES ─────────────────────────────────────────────────────────────── */
const marchePourPays = new Map<string, string>();
const doubleAffectation: Array<{ pays: string; marches: string[] }> = [];
for (const [code, marche] of Object.entries(MARCHES)) {
  for (const pays of marche.pays) {
    const deja = marchePourPays.get(pays);
    /* Un pays servi par deux marchés rendrait le routage ambigu : on le NOMME au lieu de choisir. */
    if (deja && deja !== code) doubleAffectation.push({ pays, marches: [deja, code] });
    else marchePourPays.set(pays, code);
  }
}
const paysDuRegistre = new Set(marchePourPays.keys());

const lignes = await prisma.$queryRawUnsafe<Array<{
  pays: string | null; offres: bigint; prouvees: bigint; sansPreuve: bigint; langues: string | null; sources: bigint;
}>>(`
  WITH publiables AS (
    SELECT j.id, j."countryCode", j."countryIntegrity", j.language FROM "Job" j
     WHERE j."isActive" AND j."mergedIntoId" IS NULL
       AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."jobId" = j.id AND js."isActive"
                     AND (js."expiresAt" IS NULL OR js."expiresAt" > now())))
  SELECT p."countryCode" AS pays, count(*) AS offres,
         count(*) FILTER (WHERE p."countryIntegrity" IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED')) AS prouvees,
         count(*) FILTER (WHERE p."countryCode" IS NOT NULL
                            AND p."countryIntegrity" IS DISTINCT FROM 'RAW_COUNTRY_CODE'
                            AND p."countryIntegrity" IS DISTINCT FROM 'RAW_COUNTRY'
                            AND p."countryIntegrity" IS DISTINCT FROM 'VERIFIED') AS "sansPreuve",
         string_agg(DISTINCT p.language, ',' ORDER BY p.language) AS langues,
         (SELECT count(DISTINCT js."sourceKey") FROM "JobSource" js
           WHERE js."jobId" IN (SELECT id FROM publiables q WHERE q."countryCode" IS NOT DISTINCT FROM p."countryCode")) AS sources
    FROM publiables p GROUP BY 1 ORDER BY 2 DESC`);
await prisma.$disconnect();

const parPays = new Map(lignes.map(l => [l.pays ?? '(aucun)', l]));
const total = lignes.reduce((n, l) => n + Number(l.offres), 0);
const n = (v: bigint | undefined) => Number(v ?? 0);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');

console.log(`\n═══ PAYS & MARCHÉS — CATALOGUE_CONSOLIDE_V1 · ${total} offres publiables uniques ═══\n`);

/* ── 1. LES TROIS CLASSES DE PREUVE ───────────────────────────────────────────────────────────── */
const prouve = lignes.reduce((s, l) => s + n(l.prouvees), 0);
const sansPreuve = lignes.reduce((s, l) => s + n(l.sansPreuve), 0);
const absent = n(parPays.get('(aucun)')?.offres);
console.log(`── 1. FORCE DE PREUVE DU PAYS ──\n`);
console.log(`   PAYS PROUVÉ (RAW_COUNTRY_CODE / RAW_COUNTRY / VERIFIED)  ${String(prouve).padStart(6)}  ${pct(prouve, total)}`);
console.log(`   PAYS PRÉSENT SANS PREUVE (non prouvé, PAS « faux »)      ${String(sansPreuve).padStart(6)}  ${pct(sansPreuve, total)}`);
console.log(`   PAYS ABSENT (UNKNOWN explicite)                          ${String(absent).padStart(6)}  ${pct(absent, total)}`);
console.log(`   ${'—'.repeat(62)}\n   TOTAL                                                    ${String(prouve + sansPreuve + absent).padStart(6)}`);

/* ── 2. INTÉGRITÉ DU MAPPING ──────────────────────────────────────────────────────────────────── */
console.log(`\n── 2. MAPPING countryCode → marketCode (depuis MARCHES[*].pays) ──\n`);
console.log(`   ${paysDuRegistre.size} pays mappés vers ${new Set(marchePourPays.values()).size} marché(s)`);
console.log(`   pays affectés à DEUX marchés : ${doubleAffectation.length}${doubleAffectation.length ? ' ← ' + doubleAffectation.map(d => `${d.pays}(${d.marches.join('/')})`).join(', ') : ' ✓'}`);
const routablesSansMarche = MARCHES_ROUTABLES.filter(m => !marchePourPays.has(m.code)).map(m => m.code);
console.log(`   marchés routables sans entrée de mapping : ${routablesSansMarche.length}${routablesSansMarche.length ? ' ← ' + routablesSansMarche.join(', ') : ' ✓'}`);

/* ── 3. LES MARCHÉS LOCALISÉS ─────────────────────────────────────────────────────────────────── */
console.log(`\n── 3. MARCHÉS LOCALISÉS — pays membres, preuve, langues ──\n`);
console.log(`   marché  pays        offres  prouvé  %prv  sansPrv  locales produit          langues annonces`);
let volumeLocalise = 0;
for (const code of CODES_MARCHE_LOCALISES) {
  const membres = MARCHES[code].pays;
  const o = membres.reduce((s, p) => s + n(parPays.get(p)?.offres), 0);
  const pr = membres.reduce((s, p) => s + n(parPays.get(p)?.prouvees), 0);
  const sp = membres.reduce((s, p) => s + n(parPays.get(p)?.sansPreuve), 0);
  const langues = [...new Set(membres.flatMap(p => (parPays.get(p)?.langues ?? '').split(',').filter(Boolean)))].sort();
  volumeLocalise += o;
  console.log(`   ${code.padEnd(7)} ${membres.join('+').padEnd(11)} ${String(o).padStart(6)} ${String(pr).padStart(7)} ${pct(pr, o).padStart(5)} ${String(sp).padStart(8)}  ${(MARCHES[code].locales ?? []).join(' ').padEnd(24)} ${langues.join(',')}`);
}
console.log(`\n   couverture des marchés localisés : ${volumeLocalise} / ${total} (${pct(volumeLocalise, total)})`);

/* ── 4. HORS REGISTRE — absents de TOUS les tableaux `pays` ───────────────────────────────────── */
console.log(`\n── 4. PAYS RÉELLEMENT HORS REGISTRE ──\n`);
const hors = lignes.filter(l => l.pays && !paysDuRegistre.has(l.pays));
const volumeHors = hors.reduce((s, l) => s + n(l.offres), 0);
console.log(`   ${hors.length} pays · ${volumeHors} offres (${pct(volumeHors, total)})`);
for (const l of hors.slice(0, 10)) console.log(`      ${l.pays}  ${String(n(l.offres)).padStart(4)} offres · ${pct(n(l.prouvees), n(l.offres))} prouvé`);
