/**
 * BACKFILL GÉOGRAPHIE — sans réseau, avec la chaîne auditée.
 *
 * Deux opérations bien distinctes, que le rapport sépare (correction demandée
 * par Loïc, 2026-09-08) :
 *
 *   COMPLÉTUDE  combler un `country` vide           → change le taux de remplissage
 *   QUALITÉ     corriger un `country` faux          → ne change PAS la complétude
 *
 * Une correction `CA → US` remplace du non-nul par du non-nul.
 *
 * Les corrections ne s'appliquent QUE si une preuve indépendante du suffixe le
 * confirme (`RAW_COUNTRY` / `RAW_COUNTRY_CODE`) — l'audit a montré que sans
 * cette garde, 567 offres berlinoises partaient au Delaware.
 *
 *   DATABASE_URL=<prod> npx tsx src/trust/backfill-geography.mts [--apply]
 */

import { PrismaClient } from '@prisma/client';
import { resolveGeography } from '../normalize/geography.js';

const prisma = new PrismaClient();
const BATCH = 5000;
const APPLY = process.argv.includes('--apply');

/** Les méthodes autorisées à ÉCRASER une valeur existante : un champ déclaré. */
const CAN_CORRECT = new Set(['RAW_COUNTRY', 'RAW_COUNTRY_CODE']);

async function main(): Promise<void> {
  let scanned = 0;
  let cursor: string | undefined;
  let countryBefore = 0;
  let cityBefore = 0;
  let countryAdded = 0;
  let countryCorrected = 0;
  let adminSet = 0;
  /** Graphies libres ramenées à la forme canonique (« FL » → « Florida »). */
  let adminCanonical = 0;
  /** Subdivisions EFFACÉES : la chaîne corrigée ne les reconnaît plus. */
  let adminCleared = 0;
  /** Corrections REFUSÉES faute de preuve indépendante — elles restent en base. */
  let ambiguousRefused = 0;
  const updates: { id: string; data: Record<string, string | null> }[] = [];

  for (;;) {
    const rows = await prisma.job.findMany({
      where: { isActive: true },
      select: { id: true, country: true, city: true, location: true, adminArea1: true, raw: true },
      orderBy: { id: 'asc' }, take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      scanned++;
      if (row.country) countryBefore++;
      if (row.city) cityBefore++;

      const payload =
        row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)
          ? (row.raw as Record<string, unknown>)
          : {};
      const r = resolveGeography({
        rawCountryCode: typeof payload.country_code === 'string' ? payload.country_code : undefined,
        rawCountry: typeof payload.country === 'string' ? payload.country : undefined,
        location: row.location,
        city: row.city,
        legacyCountry: row.country,
      });

      const data: Record<string, string> = {};
      let clearAdmin = false;

      // — COMPLÉTUDE : combler un vide, jamais risqué —
      if (!row.country && r.countryCode) {
        data.country = r.countryCode;
        countryAdded++;
      }
      // — QUALITÉ : corriger une valeur existante, sous preuve déclarée —
      else if (row.country && r.countryCode && r.countryCode !== row.country) {
        if (r.method && CAN_CORRECT.has(r.method)) {
          data.country = r.countryCode;
          countryCorrected++;
        } else {
          // Sans preuve indépendante, la valeur existante reste : « null ou
          // legacy incertain vaut mieux qu'une correction inventée ».
          ambiguousRefused++;
        }
      }

      /**
       * `adminArea1` se remplit INDÉPENDAMMENT du pays : « Columbus, Ohio »
       * donne la subdivision même quand le pays reste ambigu.
       */
      if (!row.adminArea1 && r.adminArea1) {
        data.adminArea1 = r.adminArea1;
        adminSet++;
      } else if (row.adminArea1 && r.adminArea1 && r.adminArea1 !== row.adminArea1) {
        /**
         * CANONICALISATION : « FL » et « Florida » désignent le même état mais
         * n'agrègent pas ensemble. La colonne existe pour agréger — une graphie
         * libre la rend inutilisable.
         */
        data.adminArea1 = r.adminArea1;
        adminCanonical++;
      } else if (row.adminArea1 && !r.adminArea1) {
        /**
         * PURGE : la chaîne corrigée ne reconnaît plus cette subdivision — elle
         * n'en était pas une (« Outlet », « Macquarie Centre »), ou appartenait
         * à un autre pays (« Amsterdam, NH » lu comme Terre-Neuve). Mesuré :
         * 702 lignes hors US/CA après le premier backfill.
         *
         * « null > donnée insuffisamment fiable » : on efface.
         */
        clearAdmin = true;
        adminCleared++;
      }

      // `null` et les valeurs texte partent dans le MÊME update : une ligne peut
      // avoir un pays à corriger ET une subdivision à effacer.
      if (clearAdmin || Object.keys(data).length > 0) {
        updates.push({ id: row.id, data: clearAdmin ? { ...data, adminArea1: null } : data });
      }
    }
    process.stderr.write(`  … ${scanned}\r`);
  }

  console.log(`\n\n=== BACKFILL GÉOGRAPHIE ${APPLY ? '(APPLIQUÉ)' : '(À BLANC)'} — ${scanned} offres ===\n`);
  console.log(`COMPLÉTUDE`);
  console.log(`  country  ${countryBefore} → ${countryBefore + countryAdded}   (+${countryAdded} vides comblés)`);
  console.log(`  city     ${cityBefore} (inchangée : aucune ville n'est ajoutée par ce lot)`);
  console.log(`\nQUALITÉ`);
  console.log(`  ${countryCorrected} valeurs existantes corrigées (preuve déclarée : RAW_COUNTRY)`);
  console.log(`  corrections ambiguës REFUSÉES  : ${ambiguousRefused} (valeur existante conservée)`);
  console.log(`  corrections ambiguës APPLIQUÉES : 0  ← invariant`);
  console.log(`\nadminArea1`);
  console.log(`  renseignés (vide → valeur)  : ${adminSet}`);
  console.log(`  canonicalisés (« FL » → « Florida ») : ${adminCanonical}`);
  console.log(`  EFFACÉS (non reconnus)      : ${adminCleared}`);
  console.log(`\nLignes à modifier : ${updates.length}`);

  if (APPLY) {
    console.log(`\n=== ÉCRITURE ===`);
    let written = 0;
    for (const u of updates) {
      await prisma.job.update({ where: { id: u.id }, data: u.data });
      written++;
      if (written % 500 === 0) process.stderr.write(`  … ${written}\r`);
    }
    console.log(`  ${written} Jobs mis à jour`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
