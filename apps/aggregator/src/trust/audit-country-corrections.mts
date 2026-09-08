/**
 * AUDIT DES CORRECTIONS DE PAYS — lecture seule, avant tout écrasement.
 *
 * Ici on ne comble pas un vide : on REMPLACE une valeur existante, jugée valide
 * jusqu'ici. Loïc (2026-09-08) : *une valeur existante ne peut être remplacée
 * que si la nouvelle preuve est STRICTEMENT PLUS FORTE* — et jamais sur la foi
 * d'une ville seule ou d'un token de deux lettres isolé.
 *
 * Produit la matrice complète `ancien → nouveau × source × méthode`, et sépare
 * les corrections démontrées de celles qui resteraient ambiguës.
 *
 *   DATABASE_URL=<prod> npx tsx src/trust/audit-country-corrections.mts
 */

import { PrismaClient } from '@prisma/client';
import { resolveGeography } from '../normalize/geography.js';

const prisma = new PrismaClient();
const BATCH = 5000;

/**
 * Les codes qui sont À LA FOIS un état/province et un code ISO pays valide.
 * C'est la population à risque : un `TN` en base peut être le Tennessee ou la
 * Tunisie, et rien dans le code seul ne le dit.
 */
const AMBIGUOUS = new Set([
  'CA', 'IN', 'AL', 'GA', 'KY', 'NC', 'SC', 'SD', 'NE', 'TN', 'MO',
  'LA', 'MT', 'ID', 'MS', 'PA', 'VA', 'DE', 'ME', 'AR', 'MD', 'MA', 'NV', 'OH', 'OR',
]);

/**
 * Une preuve est-elle STRICTEMENT PLUS FORTE qu'un code legacy à deux lettres ?
 *
 * Oui seulement si elle vient d'un FORMAT de localisation qui situe le token
 * dans un contexte géographique cohérent :
 *  - `US-PA-Philadelphia` : le pays est en tête, position non ambiguë ;
 *  - `Nashville, TN` : le token est en position de SUBDIVISION, après une ville ;
 *  - `Montreal, Quebec, CAN` : code alpha-3, aucune collision possible ;
 *  - « Mahé, Seychelles » : le pays est nommé en toutes lettres.
 *
 * Une ville seule, ou un code isolé sans structure, ne prouve rien.
 */
const STRONGER_THAN_LEGACY = new Set([
  // Un champ pays DÉCLARÉ par la source : la preuve la plus forte qui soit.
  // Mesuré : « Los Angeles, CA » porte `country: US`, « Toronto, Canada »
  // porte `country: Canada` — le raw tranche là où le suffixe ne peut pas.
  'RAW_COUNTRY',
  'RAW_COUNTRY_CODE',
  // Des FORMATS qui situent le token : le pays est en tête, ou nommé en toutes
  // lettres, ou le code est en alpha-3 (aucune collision possible).
  'LOCATION_COUNTRY_PREFIX',
  'LOCATION_COUNTRY_NAME',
  // Le suffixe à deux lettres n'est retenu que si la garde de collision l'a
  // laissé passer, c'est-à-dire confirmé par une preuve indépendante.
  'LOCATION_ADMIN1_SUFFIX',
]);

async function main(): Promise<void> {
  const matrix = new Map<string, number>();
  const byMethod = new Map<string, number>();
  const bySource = new Map<string, number>();
  const samples = new Map<string, string[]>();
  let proven = 0;
  let stillAmbiguous = 0;
  const ambiguousSamples: string[] = [];
  let scanned = 0;
  let cursor: string | undefined;

  const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

  for (;;) {
    const rows = await prisma.job.findMany({
      where: { isActive: true, country: { not: null } },
      select: {
        id: true, title: true, country: true, city: true, location: true, raw: true,
        sources: { where: { isActive: true }, select: { sourceKey: true }, take: 1 },
      },
      orderBy: { id: 'asc' }, take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      scanned++;
      if (!row.country || !AMBIGUOUS.has(row.country)) continue;

      const payload =
        row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)
          ? (row.raw as Record<string, unknown>)
          : {};
      const r = resolveGeography({
        rawCountryCode: typeof payload.country_code === 'string' ? payload.country_code : undefined,
        rawCountry: typeof payload.country === 'string' ? payload.country : undefined,
        location: row.location,
        city: row.city,
        // Le pays déjà stocké arbitre les codes qui collisionnent : sans lui,
        // « Berlin, DE » et « El Segundo, CA » sont indiscernables.
        legacyCountry: row.country,
      });

      if (!r.countryCode || r.countryCode === row.country) continue;

      const key = `${row.country} → ${r.countryCode}`;
      const source = row.sources[0]?.sourceKey ?? '(sans source)';
      const method = r.method ?? '(aucune)';

      /**
       * LE CONTRÔLE : la preuve est-elle strictement plus forte ? Une méthode
       * de format situe le token ; tout le reste laisse le doute, et on ne
       * corrige pas.
       */
      if (STRONGER_THAN_LEGACY.has(method)) {
        proven++;
        bump(matrix, `${key}|${method}`);
        bump(byMethod, method);
        bump(bySource, source);
        const bucket = samples.get(key) ?? [];
        if (bucket.length < 3) {
          bucket.push(
            `location=« ${(row.location ?? '').slice(0, 30)} » city=${row.city ?? '-'} ` +
            `legacy=${row.country} → ${r.countryCode} admin=${r.adminArea1 ?? '-'} [${method}]`,
          );
          samples.set(key, bucket);
        }
      } else {
        stillAmbiguous++;
        if (ambiguousSamples.length < 8) {
          ambiguousSamples.push(`${row.country} → ${r.countryCode} via ${method} « ${(row.location ?? '').slice(0, 34)} »`);
        }
      }
    }
    process.stderr.write(`  … ${scanned}\r`);
  }

  console.log(`\n\n=== AUDIT DES CORRECTIONS DE PAYS — ${scanned} offres avec pays ===\n`);
  console.log(`Corrections DÉMONTRÉES (preuve strictement plus forte) : ${proven}`);
  console.log(`Corrections encore AMBIGUËS (non appliquées)           : ${stillAmbiguous}\n`);

  console.log(`MATRICE  ancien → nouveau × méthode :`);
  for (const [k, n] of [...matrix].sort((a, b) => b[1] - a[1])) {
    const [pair, method] = k.split('|');
    console.log(`  ${pair.padEnd(12)} ${String(n).padStart(5)}   ${method}`);
  }

  console.log(`\nPar méthode :`);
  for (const [m, n] of [...byMethod].sort((a, b) => b[1] - a[1])) console.log(`  ${m.padEnd(26)} ${String(n).padStart(5)}`);

  console.log(`\nPar source :`);
  for (const [s, n] of [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${s.padEnd(26)} ${String(n).padStart(5)}`);

  console.log(`\nEXEMPLES RÉELS par famille :`);
  for (const [k, list] of [...samples].sort()) {
    console.log(`\n  ── ${k}`);
    for (const s of list) console.log(`     ${s}`);
  }

  if (stillAmbiguous > 0) {
    console.log(`\nRESTENT AMBIGUËS (inchangées) :`);
    for (const s of ambiguousSamples) console.log(`  · ${s}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
