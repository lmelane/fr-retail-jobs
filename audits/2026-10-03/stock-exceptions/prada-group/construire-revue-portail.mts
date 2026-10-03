/**
 * prada-group : construit la revue « propriétaire de portail » (PortalOwnerReview) qui attribue chaque offre à la
 * marque que la ligne de liste du portail nomme (colonne « Brand », td.colFacility). LECTURE SEULE.
 *
 *   CATWALKS_DB_ACCESS=… python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/2026-10-03/stock-exceptions/prada-group/construire-revue-portail.mts <dossier-cassette> <sortie.json>
 *
 * Entrées : la cassette `record-cassette.mts --key=prada-group` (pages de liste réelles, leur empreinte et leur date
 * HTTP) et la base (empreinte de configuration de la source, offres actives de la source). Rien n'est écrit en base ;
 * la revue s'inspecte ensuite par `remediation/cli.ts plan-portal-owners` (transaction READ ONLY).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { parseListingBrands } from '../../../../apps/aggregator/src/ats/adapters/successfactors.js';
import { sourceIdentityHash } from '../../../../apps/aggregator/src/connectors/sourceIdentity.js';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: construire-revue-portail.mts <dossier-cassette> <sortie.json>'); process.exit(2); }

/** Libellé natif → marque revue. Les libellés du groupe restent au propriétaire (non listés). */
const MARQUES: Record<string, string> = {
  'Prada': 'Prada', 'プラダ': 'Prada', 'Miu Miu': 'Miu Miu', 'ミュウミュウ': 'Miu Miu', 'Versace': 'Versace',
  "Church's": "Church's", 'Marchesi 1824': 'Marchesi 1824',
};
const GROUPE = new Set(['Prada Group', 'プラダ・グループ']);

type Entry = { method: string; url: string; status: number; headers: Record<string, string>; body: string };
const pages = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as Entry)
  .filter(e => e.status === 200 && new URL(e.url).pathname === '/search/');

const evidence = new Map<string, { url: string; sha256: string; value: string; observedAt: string }>();
const inconnus = new Map<string, number>();
for (const page of pages) {
  const sha256 = createHash('sha256').update(page.body).digest('hex');
  const observedAt = new Date(page.headers.date).toISOString();
  for (const [id, value] of parseListingBrands(page.body, 'facility')) {
    const previous = evidence.get(id);
    if (previous && previous.value !== value) throw new Error(`Deux marques pour ${id} : ${previous.value} / ${value}`);
    evidence.set(id, { url: page.url, sha256, value, observedAt });
    if (!MARQUES[value] && !GROUPE.has(value)) inconnus.set(value, (inconnus.get(value) ?? 0) + 1);
  }
}
if (inconnus.size) throw new Error(`Libellé non revu : ${JSON.stringify([...inconnus])}`);

const prisma = new PrismaClient();
try {
  const source = await prisma.source.findUniqueOrThrow({ where: { key: 'prada-group' } });
  const actives = await prisma.jobSource.findMany({ where: { sourceKey: 'prada-group', isActive: true }, select: { externalId: true, job: { select: { companyId: true, company: { select: { name: true } } } } } });
  const owners = [...new Set(actives.map(a => a.job?.companyId).filter((id): id is string => !!id))];
  const detail = pages.length ? readdirSync(dir).map(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as Entry).find(e => e.url.includes('/job/') && e.body.includes('Luna Rossa brands')) : undefined;
  if (!detail) throw new Error('Aucune page d’offre portant la phrase de périmètre du groupe');
  const phrase = /The Group, a world leader in the luxury sector, operates in more than 45 countries with the PRADA, Miu Miu, Versace, Church’s, Car Shoe and Luna Rossa brands/.exec(detail.body)?.[0];
  if (!phrase) throw new Error('Phrase de périmètre introuvable verbatim');
  const enBase = new Set(actives.map(a => a.externalId));
  const postings = [...evidence].filter(([id, e]) => enBase.has(id) && MARQUES[e.value]).sort(([a], [b]) => a.localeCompare(b))
    .map(([externalId, e]) => ({ externalId, targetName: MARQUES[e.value], targetKind: 'BRAND' as const,
      evidence: { url: e.url, sha256: e.sha256, property: 'facility', value: e.value, observedAt: e.observedAt } }));
  const review = {
    batchId: randomUUID(), reviewedAt: new Date().toISOString(), reviewer: 'claude-d522-6-portails',
    sources: [{
      sourceKey: source.key, expectedSourceHash: sourceIdentityHash(source), fromCompanyIds: owners,
      targetName: 'Prada Group', targetKind: 'GROUP' as const, officialDomain: 'pradagroup.com', portalUrl: 'https://jobs.pradagroup.com',
      configPatch: { brandProperty: 'facility' },
      postings,
      evidence: [{ url: detail.url, artifactText: phrase, sha256: createHash('sha256').update(phrase).digest('hex'),
        statement: 'The official Prada Group careers portal states that the Group operates the PRADA, Miu Miu, Versace, Church’s, Car Shoe and Luna Rossa brands; its result table names the employing brand of each posting in the Brand column.' }],
    }],
  };
  writeFileSync(out, JSON.stringify(review, null, 1));
  const parMarque: Record<string, number> = {};
  for (const [id, e] of evidence) parMarque[`${e.value}${enBase.has(id) ? '' : ' (absente de la base)'}`] = (parMarque[`${e.value}${enBase.has(id) ? '' : ' (absente de la base)'}`] ?? 0) + 1;
  console.log(JSON.stringify({ pagesListe: pages.length, offresLues: evidence.size, activesEnBase: actives.length,
    employeursActuels: [...new Set(actives.map(a => a.job?.company.name))], postingsRevus: postings.length, parMarque,
    activesNonVuesAujourdhui: actives.filter(a => !evidence.has(a.externalId)).length }, null, 1));
} finally { await prisma.$disconnect(); }
