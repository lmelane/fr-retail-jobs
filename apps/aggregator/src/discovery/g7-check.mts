import { PrismaClient } from '@prisma/client';
import {
  domainFromEmployerSources,
  resolveCompanyDomain,
  wikidataClient,
  type EmployerSourceLike,
} from '../normalize/companyDomain.js';

/**
 * g7 — preuve par exécution : 40 Maisons de la base de PROD (lecture seule),
 * 20 avec une source directe au catalogue (chemin (i)), 20 issues de flux de
 * groupe (chemin (ii), Wikidata). Pour chacune : domaine + provenance, puis le
 * favicon téléchargé avec la MÊME logique que `/api/logo` (DuckDuckGo puis
 * Google, placeholder DDG de 1 478 octets refusé). Aucune écriture.
 *
 *   PW=$(railway variables --service Postgres --kv | grep '^POSTGRES_PASSWORD=' | cut -d= -f2-)
 *   DATABASE_URL="postgresql://postgres:${PW}@sakura.proxy.rlwy.net:40792/railway" npx tsx src/discovery/g7-check.mts
 */

const GROUP_FED_NAMES = [
  'Christian Dior Couture', 'Cartier', 'Gucci', 'MAC', 'Tom Ford', 'Loewe', 'Bulgari', 'Tiffany & Co.',
  'Omega', 'Guerlain', 'Clinique', 'Jo Malone London', 'Montblanc', 'Louis Vuitton', 'Celine',
  'Loro Piana', 'Saint Laurent', 'Balenciaga', 'Van Cleef & Arpels', 'VanCleef-Aprels', 'Bottega Veneta',
  'Fendi', 'Givenchy', 'Hermès', 'Parfums Christian Dior',
];
const PER_BUCKET = 20;

// Copie volontaire de apps/web/app/api/logo/route.ts : le script doit mesurer
// exactement ce que la route sert, et un import inter-apps n'existe pas.
const DDG_PLACEHOLDER_BYTES = 1478;
const PROVIDERS: [string, (domain: string) => string][] = [
  ['ddg', (domain) => `https://icons.duckduckgo.com/ip3/${domain}.ico`],
  ['google', (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`],
];

async function favicon(domain: string): Promise<{ provider: string; bytes: number } | null> {
  for (const [provider, buildUrl] of PROVIDERS) {
    try {
      const response = await fetch(buildUrl(domain), { signal: AbortSignal.timeout(4000) });
      if (!response.ok) continue;
      const bytes = (await response.arrayBuffer()).byteLength;
      if (bytes < 100 || bytes === DDG_PLACEHOLDER_BYTES) continue;
      return { provider, bytes };
    } catch {
      // Fournisseur injoignable : le suivant.
    }
  }
  return null;
}

const prisma = new PrismaClient();
const t0 = Date.now();

// `select` explicite : la colonne Company.domain n'existe pas encore en prod.
const sources: EmployerSourceLike[] = await prisma.source.findMany({
  where: { status: 'ACTIVE' },
  select: { maison: true, tier: true, careersDomain: true },
});
const companies = await prisma.company.findMany({
  select: { id: true, name: true, canonicalKey: true, _count: { select: { jobs: { where: { isActive: true } } } } },
});
const active = companies.filter((c) => c._count.jobs > 0).sort((a, b) => b._count.jobs - a._count.jobs);

const direct = active.filter((c) => domainFromEmployerSources(c.canonicalKey, sources)).slice(0, PER_BUCKET);
const groupFed = GROUP_FED_NAMES.map((name) => active.find((c) => c.name === name))
  .filter((c): c is NonNullable<typeof c> => Boolean(c))
  .filter((c) => !direct.some((d) => d.id === c.id))
  .slice(0, PER_BUCKET);

console.log(`prod : ${active.length} Maisons actives, ${sources.length} sources ACTIVE`);
console.log(`chemin (i) possible sur ${active.filter((c) => domainFromEmployerSources(c.canonicalKey, sources)).length} Maisons actives`);
console.log(`échantillon : ${direct.length} directes + ${groupFed.length} flux de groupe\n`);

const wikidata = wikidataClient();
type Row = { bucket: string; name: string; jobs: number; domain: string; source: string; logo: string };
const rows: Row[] = [];

for (const [bucket, list] of [['direct', direct], ['groupe', groupFed]] as const) {
  for (const company of list) {
    const resolved = await resolveCompanyDomain({ name: company.name, canonicalKey: company.canonicalKey }, sources, wikidata);
    const logo = resolved ? await favicon(resolved.domain) : null;
    rows.push({
      bucket,
      name: company.name,
      jobs: company._count.jobs,
      domain: resolved?.domain ?? '—',
      source: resolved?.domainSource ?? 'non résolu',
      logo: logo ? `${logo.bytes} o (${logo.provider})` : resolved ? 'AUCUN favicon' : 'initiale',
    });
    console.log(
      `${bucket.padEnd(7)} ${company.name.padEnd(28)} ${String(company._count.jobs).padStart(5)}  ` +
        `${(resolved?.domain ?? '—').padEnd(28)} ${(resolved?.domainSource ?? 'non résolu').padEnd(15)} ${rows.at(-1)!.logo}`,
    );
  }
}

const resolved = rows.filter((r) => r.source !== 'non résolu');
const withLogo = rows.filter((r) => /\d+ o/.test(r.logo));
console.log(`\n${rows.length} Maisons : ${resolved.length} résolues (${rows.filter((r) => r.source === 'source-careers').length} catalogue, ` +
  `${rows.filter((r) => r.source === 'wikidata').length} wikidata), ${rows.length - resolved.length} non résolues ; ` +
  `${withLogo.length} favicons servis ; ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(`non résolues : ${rows.filter((r) => r.source === 'non résolu').map((r) => r.name).join(', ') || '—'}`);
console.log(`résolues sans favicon : ${rows.filter((r) => r.logo === 'AUCUN favicon').map((r) => `${r.name} (${r.domain})`).join(', ') || '—'}`);

console.log('\nTSV');
console.log(['bucket', 'maison', 'offres', 'domaine', 'provenance', 'favicon'].join('\t'));
for (const r of rows) console.log([r.bucket, r.name, r.jobs, r.domain, r.source, r.logo].join('\t'));

await prisma.$disconnect();
