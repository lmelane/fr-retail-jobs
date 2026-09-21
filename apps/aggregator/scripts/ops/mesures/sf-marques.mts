/**
 * LE SIGNAL DE MARQUE DES TENANTS SUCCESSFACTORS — mesuré, tenant par tenant.
 *
 * Douglas déclare `sfstd_marketingBrand_obj`. Rien ne dit que les autres tenants portent le même
 * champ : SuccessFactors est un socle configurable, et chaque employeur nomme ses propriétés.
 * On mesure donc AVANT de généraliser.
 */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../src/capture/store.js';
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const srcs = await p.$queryRawUnsafe<Array<{ key: string }>>(
  `SELECT DISTINCT b."sourceKey" AS key FROM "CaptureBatch" b JOIN "Source" s ON s.key=b."sourceKey"
    WHERE s.kind='successfactors' AND b.purpose='JOBS' ORDER BY 1`);
console.log(`  ${'source'.padEnd(22)} ${'champ RAW'.padEnd(28)} ${'couv.'.padStart(6)} valeurs`);
for (const s of srcs) {
  const outs = await p.$queryRawUnsafe<Array<{ h: string }>>(
    `SELECT e."outputHash" AS h FROM "SourceExtraction" e JOIN "CaptureBatch" b ON b.id=e."batchId"
      WHERE b."sourceKey"=$1 LIMIT 40`, s.key);
  if (!outs.length) { console.log(`  ${s.key.padEnd(22)} (aucune extraction)`); continue; }
  /* On cherche TOUT champ du RAW dont le nom évoque une marque, sans présumer lequel. */
  const champs = new Map<string, { n: number; vals: Set<string> }>();
  for (const o of outs) {
    try {
      const j = JSON.parse(new TextDecoder().decode(await readRawBlob(p, o.h)));
      for (const [k, v] of Object.entries(j.raw ?? {})) {
        if (!/brand|marque|entity|societe|company|employer|division/i.test(k)) continue;
        const val = Array.isArray(v) ? v.join('|') : typeof v === 'string' ? v : null;
        if (!val?.trim()) continue;
        const e = champs.get(k) ?? { n: 0, vals: new Set<string>() };
        e.n++; e.vals.add(val); champs.set(k, e);
      }
    } catch {}
  }
  if (!champs.size) { console.log(`  ${s.key.padEnd(22)} ${'(aucun champ de marque)'.padEnd(28)} ${'0%'.padStart(6)}`); continue; }
  for (const [k, e] of [...champs].sort((a, b) => b[1].n - a[1].n).slice(0, 2))
    console.log(`  ${s.key.padEnd(22)} ${k.slice(0,28).padEnd(28)} ${`${Math.round(e.n/outs.length*100)}%`.padStart(6)} ${[...e.vals].slice(0,3).join(', ').slice(0,44)}`);
}
await p.$disconnect();
