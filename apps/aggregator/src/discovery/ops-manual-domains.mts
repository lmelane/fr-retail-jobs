import { PrismaClient } from '@prisma/client';
/**
 * Domaines posés à la main (domainSource = manual) pour les Maisons que ni le
 * catalogue ni Wikidata ne résolvent, et remise à NULL des domaines faux que
 * la garde nominative aurait refusés (mesure prod 2026-09-06 : 13 lignes sur
 * 487, toutes Wikidata). Chaque domaine manuel a été vérifié par HTTP le
 * 2026-09-06 (200 sur le site de la Maison elle-même).
 * Usage : DATABASE_URL=… npx tsx src/discovery/ops-manual-domains.mts
 */
const MANUAL: Array<{ name: RegExp; domain: string }> = [
  { name: /^christian dior couture$/i, domain: 'dior.com' },
  { name: /^parfums christian dior$/i, domain: 'dior.com' },
  { name: /^dior$/i, domain: 'dior.com' },
  { name: /^mac( cosmetics)?$/i, domain: 'maccosmetics.com' },
  { name: /^urbn$/i, domain: 'urbn.com' },
  { name: /^avolta$/i, domain: 'avoltaworld.com' },
  { name: /^oniverse$/i, domain: 'oniverse.it' },
  { name: /^dunhill$/i, domain: 'dunhill.com' },
  { name: /^moynat$/i, domain: 'moynat.com' },
  { name: /^bizzbee$/i, domain: 'b-z-b.com' },
  { name: /^eurofragrance$/i, domain: 'eurofragance.com' },
];

/**
 * Domaines faux à effacer (l'initiale vaut mieux qu'un logo d'une autre
 * entreprise) : homonymes Wikidata, ou groupe crédité à la Maison.
 */
const RESET: Array<{ name: RegExp; wrongDomain: string }> = [
  { name: /^urbn$/i, wrongDomain: 'co.id' },
  { name: /^avolta$/i, wrongDomain: 'dufry.com' },
  { name: /^moët hennessy$/i, wrongDomain: 'lvmh.com' },
  { name: /^wing$/i, wrongDomain: 'x.company' },
  { name: /^eurofragrance$/i, wrongDomain: 'eurofragance.com' },
  { name: /^towa$/i, wrongDomain: 'waw.pl' },
  { name: /^bizzbee$/i, wrongDomain: 'b-z-b.com' },
  { name: /^oniverse$/i, wrongDomain: 'calzedonia.it' },
  { name: /^dunhill$/i, wrongDomain: 'bat.com' },
  { name: /^moynat$/i, wrongDomain: 'audepart.com' },
  { name: /^dumebi$/i, wrongDomain: 'andreaiyamah.com' },
  { name: /^éclipse$/i, wrongDomain: 'lautapelit.fi' },
  { name: /^fhh$/i, wrongDomain: 'finehh.com' },
];

const p = new PrismaClient();
const companies = await p.company.findMany({ select: { id: true, name: true, domain: true } });
let reset = 0;
for (const c of companies) {
  const rule = RESET.find((r) => r.name.test(c.name.trim()));
  if (!rule || c.domain !== rule.wrongDomain) continue;
  await p.company.update({ where: { id: c.id }, data: { domain: null, domainSource: null } });
  console.log(`${c.name}: ${rule.wrongDomain} → (vide)`);
  reset++;
}
let set = 0;
for (const c of companies) {
  const rule = MANUAL.find((r) => r.name.test(c.name.trim()));
  const wasReset = RESET.some((r) => r.name.test(c.name.trim()) && c.domain === r.wrongDomain);
  if (!rule || (c.domain && !wasReset)) continue;
  await p.company.update({ where: { id: c.id }, data: { domain: rule.domain, domainSource: 'manual' } });
  console.log(`${c.name} → ${rule.domain}`);
  set++;
}
console.log('effacés:', reset, '| posés:', set);
await p.$disconnect();
