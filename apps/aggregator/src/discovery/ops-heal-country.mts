import { PrismaClient } from '@prisma/client';
import { normalizeCountry, countryFromLocation } from '../normalize/country.js';
import { displayCity } from '../normalize/location.js';
import { isFranceJob } from '../lib/france.js';
/**
 * Audit I-1 (prod, 2026-09-06) : 509 offres actives où isFrance et country se contredisent,
 * ~300 pays en graphie libre (« United States », « gb », « Mexique »…) et 49 villes à double
 * casse — toutes des lignes JAMAIS ré-attestées depuis les normalisations d'écriture (D37).
 * Ce script applique aux lignes existantes exactement les règles que l'ingest applique
 * à l'écriture : pays ISO, isFrance dérivé du pays, ville canonique. Idempotent.
 */
const p = new PrismaClient();
const rows = await p.job.findMany({
  where: { isActive: true },
  select: { id: true, countryCode: true, location: true, city: true, isFrance: true },
});
let country = 0, france = 0, city = 0;
for (const r of rows) {
  const data: Record<string, unknown> = {};
  const iso = r.countryCode && /^[A-Z]{2}$/.test(r.countryCode) ? r.countryCode : normalizeCountry(r.countryCode) ?? countryFromLocation(r.location) ?? null;
  if (iso !== r.countryCode && iso) { data.countryCode = iso; country++; }
  const isFrance = isFranceJob(iso ?? undefined, r.location);
  if (isFrance !== r.isFrance) { data.isFrance = isFrance; france++; }
  const canon = displayCity(r.city);
  if (r.city && canon && canon !== r.city) { data.city = canon; city++; }
  if (Object.keys(data).length) await p.job.update({ where: { id: r.id }, data });
}
console.log(JSON.stringify({ scanned: rows.length, countryFixed: country, isFranceFixed: france, cityFixed: city }));
await p.$disconnect();
