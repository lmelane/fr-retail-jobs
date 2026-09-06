import { PrismaClient } from '@prisma/client';
/**
 * Domaines posés à la main (domainSource = manual) pour les Maisons que ni le
 * catalogue ni Wikidata ne résolvent (rapport g7, 2026-09-06) : Dior (entités
 * Wikidata sans site officiel, le seul lien pointe sur LVMH — refusé) et MAC.
 * Usage : DATABASE_URL=… npx tsx src/discovery/ops-manual-domains.mts
 */
const MANUAL: Array<{ name: RegExp; domain: string }> = [
  { name: /^christian dior couture$/i, domain: 'dior.com' },
  { name: /^parfums christian dior$/i, domain: 'dior.com' },
  { name: /^dior$/i, domain: 'dior.com' },
  { name: /^mac( cosmetics)?$/i, domain: 'maccosmetics.com' },
];
const p = new PrismaClient();
const companies = await p.company.findMany({ select: { id: true, name: true, domain: true } });
let set = 0;
for (const c of companies) {
  const rule = MANUAL.find((r) => r.name.test(c.name.trim()));
  if (!rule || c.domain) continue;
  await p.company.update({ where: { id: c.id }, data: { domain: rule.domain, domainSource: 'manual' } });
  console.log(`${c.name} → ${rule.domain}`);
  set++;
}
console.log('posés:', set);
await p.$disconnect();
