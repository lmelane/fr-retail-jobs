/**
 * DRY-RUN GÉOGRAPHIE — lecture seule, sans réseau.
 *
 * Produit les DEUX métriques exigées par Loïc (2026-09-08), pour que le dry-run
 * et la prod finale soient directement comparables :
 *
 *   reconstructableFromRaw     ce que le moteur sait reconstruire DEPUIS ZÉRO
 *   finalExpectedAfterMigration  ce que la prod contiendra après :
 *                                conversion legacy fiable + enrichissement
 *                                − valeurs invalides
 *
 *   DATABASE_URL=<prod> npx tsx src/trust/dryrun-geography.mts
 */

import { PrismaClient } from '@prisma/client';
import { resolveGeography, isValidCityName, type GeoMethod } from '../normalize/geography.js';

const prisma = new PrismaClient();
const BATCH = 5000;

/** Les codes qui sont À LA FOIS un état US et un code ISO pays — le piège mesuré. */
const AMBIGUOUS_CODES = new Set(['TN', 'GA', 'SC', 'NE', 'MO', 'KY', 'NC', 'SD', 'AL', 'CA', 'IN', 'LA', 'MT', 'ID', 'MS', 'PA', 'VA', 'DE', 'ME']);

async function main(): Promise<void> {
  let scanned = 0;
  let cursor: string | undefined;

  // — État actuel —
  let hasCountryNow = 0;
  let hasCityNow = 0;

  // — Ce que le moteur reconstruit depuis zéro —
  let reconCountry = 0;
  let reconCity = 0;
  let reconAdmin1 = 0;

  // — Ce que la prod contiendra après migration —
  let finalCountry = 0;
  let finalCity = 0;
  let finalAdmin1 = 0;

  let countryGained = 0;
  let countryCorrected = 0;
  let cityRejected = 0;
  let ambiguousUnresolved = 0;
  const byMethod = new Map<GeoMethod, number>();
  const bySource = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const corrections: string[] = [];
  const rejections: string[] = [];
  const unresolved = new Map<string, number>();

  const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

  for (;;) {
    const rows = await prisma.job.findMany({
      where: { isActive: true },
      select: {
        id: true, title: true, countryCode: true, city: true, location: true, raw: true,
        sources: { where: { isActive: true }, select: { sourceKey: true }, take: 1 },
      },
      orderBy: { id: 'asc' }, take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      scanned++;
      if (row.countryCode) hasCountryNow++;
      if (row.city) hasCityNow++;

      const payload =
        row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)
          ? (row.raw as Record<string, unknown>)
          : {};
      const resolved = resolveGeography({
        rawCountryCode: typeof payload.country_code === 'string' ? payload.country_code : undefined,
        rawCountry: typeof payload.country === 'string' ? payload.country : undefined,
        location: row.location,
        city: row.city,
      });

      if (resolved.countryCode) reconCountry++;
      if (resolved.city) reconCity++;
      if (resolved.adminArea1) reconAdmin1++;

      /**
       * L'ÉTAT FINAL : la valeur existante est conservée SAUF si elle est
       * démontrée fausse (un code ambigu que le moteur corrige), et le moteur
       * comble ce qui manque.
       */
      const legacyCountryIsWrong =
        row.countryCode !== null &&
        AMBIGUOUS_CODES.has(row.countryCode) &&
        resolved.countryCode !== undefined &&
        resolved.countryCode !== row.countryCode;

      const finalCountryValue = legacyCountryIsWrong
        ? resolved.countryCode
        : (row.countryCode ?? resolved.countryCode);
      const finalCityValue = row.city && isValidCityName(row.city) ? row.city : resolved.city;

      if (finalCountryValue) finalCountry++;
      if (finalCityValue) finalCity++;
      if (resolved.adminArea1) finalAdmin1++;

      if (!row.countryCode && resolved.countryCode) {
        countryGained++;
        if (resolved.method) bump(byMethod, resolved.method);
        bump(bySource, row.sources[0]?.sourceKey ?? '(sans source)');
        bump(byCountry, resolved.countryCode);
      }
      if (legacyCountryIsWrong) {
        countryCorrected++;
        if (corrections.length < 10) {
          corrections.push(`${row.countryCode} → ${resolved.countryCode} (${resolved.adminArea1 ?? '-'}) « ${(row.location ?? '').slice(0, 34)} »`);
        }
      }
      if (row.city && !isValidCityName(row.city)) {
        cityRejected++;
        if (rejections.length < 8) rejections.push(`« ${row.city} » ← ${row.title.slice(0, 40)}`);
      }
      if (!finalCountryValue && finalCityValue) {
        ambiguousUnresolved++;
        bump(unresolved, finalCityValue);
      }
    }
    process.stderr.write(`  … ${scanned}\r`);
  }

  const pct = (n: number) => `${((n / scanned) * 100).toFixed(1)} %`;
  console.log(`\n\n=== DRY-RUN GÉOGRAPHIE — ${scanned} offres, LECTURE SEULE ===\n`);

  console.log(`ÉTAT ACTUEL`);
  console.log(`  country          ${String(hasCountryNow).padStart(6)}  ${pct(hasCountryNow)}`);
  console.log(`  city             ${String(hasCityNow).padStart(6)}  ${pct(hasCityNow)}`);

  console.log(`\nreconstructableFromRaw  (le moteur, depuis zéro)`);
  console.log(`  countryCode      ${String(reconCountry).padStart(6)}  ${pct(reconCountry)}`);
  console.log(`  city             ${String(reconCity).padStart(6)}  ${pct(reconCity)}`);
  console.log(`  adminArea1       ${String(reconAdmin1).padStart(6)}  ${pct(reconAdmin1)}`);

  console.log(`\nfinalExpectedAfterMigration  (legacy fiable + enrichissement − invalides)`);
  console.log(`  countryCode      ${String(finalCountry).padStart(6)}  ${pct(finalCountry)}`);
  console.log(`  city             ${String(finalCity).padStart(6)}  ${pct(finalCity)}`);
  console.log(`  adminArea1       ${String(finalAdmin1).padStart(6)}  ${pct(finalAdmin1)}`);

  console.log(`\nGAINS`);
  console.log(`  pays ajoutés     ${countryGained}`);
  console.log(`  pays CORRIGÉS    ${countryCorrected}   (codes ambigus : état US pris pour un pays)`);
  for (const c of corrections) console.log(`     ${c}`);
  console.log(`  villes REJETÉES  ${cityRejected}`);
  for (const r of rejections) console.log(`     ${r}`);

  console.log(`\nProvenance des pays ajoutés :`);
  for (const [m, n] of [...byMethod].sort((a, b) => b[1] - a[1])) console.log(`  ${m.padEnd(26)} ${String(n).padStart(6)}`);

  console.log(`\nPar source :`);
  for (const [s, n] of [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${s.padEnd(26)} ${String(n).padStart(6)}`);

  console.log(`\nPays produits :`);
  for (const [c, n] of [...byCountry].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${c.padEnd(6)} ${String(n).padStart(6)}`);

  console.log(`\nAMBIGUÏTÉS NON RÉSOLUES (ville connue, pays refusé) : ${ambiguousUnresolved}`);
  for (const [c, n] of [...unresolved].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${c.slice(0, 26).padEnd(28)} ${String(n).padStart(5)}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
