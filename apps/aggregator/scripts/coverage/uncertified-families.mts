/**
 * The ACTIVE sources not certified under the promotion contract, grouped by TREATMENT FAMILY — what proof already exists, what
 * blocks, what the next action is — from the production database (read-only) and the archived portal research. Counts are per
 * family with explicit denominators; a source belongs to exactly one family (first rule that applies, in the order below).
 * Nothing is written to the database. This is a PRE-SORT: it reuses the contract's own notions (sourceSubjectKey, the reviewed
 * official domain, reviewed aliases, merged identities) and never certifies anything itself.
 *
 * Rule order (first match wins):
 *  D. BOARD_OR_AGENCY        — jobboard / sector sweep / agency tiers or kinds → identity of a board, owner decision.
 *  G. GROUP_PORTAL           — the source feeds SEVERAL canonical companies (tier GROUP_OFFICIAL, or ≥ 2 credited companies none of
 *                              which is merged into another) → MULTI_BRAND certification + reviewed alias per label (Saks / KnitWell).
 *  A. HOMONYM_SUSPECT        — FED_NOT_MAISON: the single fed company is NOT the catalogued Maison's canonical company, nor merged
 *                              into it, nor a reviewed alias of this source; or SOLE_FEEDER_NO_PROOF: it is fed by this source only,
 *                              with no official domain known and no verified official link → audit first (the `loft` case).
 *  B. OFFICIAL_DOMAIN_PORTAL — the portal host's registrable domain (tldts) equals the Maison's official domain — Company.domain of
 *                              the canonical company, or the officialDomain of an existing VERIFIED review of this tenant — and the host
 *                              is not a shared ATS vendor host → certification by the hosted portal page (OFFICIAL_DOMAIN).
 *  C. RECIPROCAL_LINK_VERIFIED — the archived research holds a link from a page ON THE OFFICIAL DOMAIN to this tenant's portal →
 *                              certification from the archived page (OFFICIAL_LINK). A link from any other page is only a lead.
 *  E. RESEARCH_NEEDED        — none of the above; unverified leads (links from non-official pages) are listed.
 *
 * Tenant locator: on a shared vendor host the tenant lives in the PATH (jobs.smartrecruiters.com/ERICBOMPARD, jobs.lever.co/AMIRI,
 * job-boards.greenhouse.io/clubmonaco, welcometothejungle.com/fr/companies/<slug>), so links are matched on `<registrable>/<tenant>`
 * there and on the bare host everywhere else (<tenant>.wd3.myworkdayjobs.com, <tenant>.teamtailor.com, <tenant>.talentview.io…).
 *
 * Usage: npx tsx apps/aggregator/scripts/coverage/uncertified-families.mts <output-dir>
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'tldts';
import { assertIdentityReview, sourceSubjectKey } from '../../src/connectors/sourceIdentity.js';
import { resolveCompany } from '../../src/normalize/company.js';

const out = process.argv[2]; if (!out) { console.error('usage: uncertified-families.mts <output-dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const RESEARCH = 'backups/lot4-20260909/portal-research/research.jsonl';

// Shared ATS vendor domains: a portal hosted there is never "on the official domain". Mirrors `vendorDomains` (connectors/sourceIdentity.ts,
// the promotion gate) and `ATS_HOSTS` (ats/detect.ts) — neither is exported and this script must not edit them — plus the mutualised hosts
// named for this pre-sort. Compared on the registrable domain, so `cc.wd3.myworkdayjobs.com` and `boards.greenhouse.io` are both caught.
const VENDOR_DOMAINS = new Set([
  'jobaffinity.fr', 'candidater.fr', 'flatchr.io', 'werecruit.io', 'greenhouse.io', 'lever.co', 'smartrecruiters.com', 'teamtailor.com', 'myworkdayjobs.com', 'oraclecloud.com', 'recruitee.com', 'personio.de', 'personio.com', 'workable.com', 'welcometothejungle.com',
  'successfactors.com', 'ashbyhq.com', 'pinpointhq.com', 'eightfold.ai', 'avature.net', 'icims.com', 'taleo.net', 'harri.com', 'hr-manager.net',
  'talent-soft.com', 'successfactors.eu', 'welcometothejungle.co', 'talentview.io', 'jobs2web.com', 'phenompeople.com', 'digitalrecruiters.com', 'easycruit.com', 'jobylon.com', 'bamboohr.com', 'breezy.hr', 'jobvite.com', 'ultipro.com', 'paylocity.com', 'dayforcehcm.com', 'adp.com', 'cornerstoneondemand.com', 'csod.com', 'talentlyft.com', 'homerun.co', 'rippling.com', 'applytojob.com', 'jazz.co',
]);
/** Vendors whose host is shared by every tenant: the tenant is the first path segment. */
const PATH_TENANT_VENDORS = new Set(['smartrecruiters.com', 'lever.co', 'greenhouse.io', 'workable.com', 'ashbyhq.com']);
const registrable = (h: string): string | null => { const d = parse((h ?? '').toLowerCase()).domain; return d || null; };
const isVendorHost = (h: string): boolean => { const d = registrable(h); return !d || VENDOR_DOMAINS.has(d) || d.startsWith('successfactors.'); };
const sameRegistrable = (host: string, official: string): boolean => { const a = registrable(host), b = registrable(official); return !!a && !!b && a === b; };

/** Locator of the tenant a URL points at: `<registrable>/<tenant>` on shared vendor hosts, `wttj:<slug>` on WTTJ, the bare host elsewhere. */
function locatorOfUrl(raw: string): string | null {
  let u: URL; try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase(); const reg = registrable(host); if (!reg) return null;
  if (reg === 'welcometothejungle.com' || reg === 'welcometothejungle.co') { const m = u.pathname.match(/\/companies\/([^/?#]+)/i); return m ? `wttj:${m[1]!.toLowerCase()}` : host; }
  if (PATH_TENANT_VENDORS.has(reg)) { const seg = u.pathname.split('/').filter(Boolean)[0]; return seg ? `${reg}/${seg.toLowerCase()}` : host; }
  return host;
}
/** Where the source's adapter reads: locators + a display host, from the config URLs and from the slug the adapter kind uses. */
function locatorsOf(s: any): { host: string; locators: string[] } {
  const c = (s.config ?? {}) as Record<string, unknown>; const str = (k: string) => (typeof c[k] === 'string' ? String(c[k]).trim() : '');
  const urls = ['origin', 'listingUrl', 'jobs_url', 'sitemapUrl', 'careers_url', 'baseUrl', 'url', 'board_url'].map(str).filter(Boolean);
  if (str('domainName')) urls.push(`https://${str('domainName')}`); if (str('host')) urls.push(`https://${str('host')}`); if (s.careersDomain) urls.push(`https://${s.careersDomain}`);
  const byKind: Record<string, () => { host: string; locator: string } | null> = {
    'workable': () => (str('account') ? { host: 'apply.workable.com', locator: `workable.com/${str('account').toLowerCase()}` } : null),
    'smartrecruiters-whitelabel': () => (str('company') ? { host: 'jobs.smartrecruiters.com', locator: `smartrecruiters.com/${str('company').toLowerCase()}` } : null),
    'smartrecruiters': () => (str('company') ? { host: 'jobs.smartrecruiters.com', locator: `smartrecruiters.com/${str('company').toLowerCase()}` } : null),
    'greenhouse': () => (str('board') ? { host: 'boards.greenhouse.io', locator: `greenhouse.io/${str('board').toLowerCase()}` } : null),
    'lever': () => (str('site') ? { host: 'jobs.lever.co', locator: `lever.co/${str('site').toLowerCase()}` } : null),
    'ashby': () => (str('slug') ? { host: 'jobs.ashbyhq.com', locator: `ashbyhq.com/${str('slug').toLowerCase()}` } : null),
    'recruitee': () => (str('subdomain') ? { host: `${str('subdomain').toLowerCase()}.recruitee.com`, locator: `${str('subdomain').toLowerCase()}.recruitee.com` } : null),
    'talentview': () => (str('slug') ? { host: `${str('slug').toLowerCase()}.talentview.io`, locator: `${str('slug').toLowerCase()}.talentview.io` } : null),
    'wttj': () => (str('slug') ? { host: 'www.welcometothejungle.com', locator: `wttj:${str('slug').toLowerCase()}` } : null),
  };
  const kindLoc = byKind[s.kind]?.() ?? null;
  const urlHosts = urls.map((u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } }).filter((h) => h && !h.startsWith('api.'));
  const locators = [...new Set([...(kindLoc ? [kindLoc.locator] : []), ...urls.filter((u) => { try { return !new URL(u).hostname.startsWith('api.'); } catch { return false; } }).map(locatorOfUrl).filter((l): l is string => !!l)])];
  return { host: urlHosts[0] ?? kindLoc?.host ?? (s.careersDomain ?? '').toLowerCase(), locators };
}

const linksToLocator = new Map<string, Set<string>>(); // tenant locator → hosts of archived pages linking to it (other host, never LinkedIn)
try {
  for (const line of readFileSync(RESEARCH, 'utf8').split('\n')) {
    if (!line.trim()) continue; let d: any; try { d = JSON.parse(line); } catch { continue; }
    for (const l of d.links ?? []) {
      try {
        const to = new URL(l.to).hostname.toLowerCase(); const from = new URL(l.from).hostname.toLowerCase();
        if (to === from || from.endsWith('linkedin.com')) continue;
        const loc = locatorOfUrl(l.to); if (!loc) continue;
        if (!linksToLocator.has(loc)) linksToLocator.set(loc, new Set()); linksToLocator.get(loc)!.add(from);
      } catch { /* malformed link */ }
    }
  }
} catch { /* research archive absent: family C is empty and E says so */ }

const p = new PrismaClient({ log: [] });
try {
  const db: any = await p.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const sources = await tx.source.findMany({ where: { status: 'ACTIVE' } });
    // Same order as requireSourceIdentity: the latest decision per source is the one that counts.
    const reviews = await tx.sourceIdentityReview.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const companies: any[] = await tx.$queryRaw`SELECT id, name, "canonicalKey", domain, "mergedIntoId", "fashionjobsUrl" FROM "Company"`;
    const feeds: any[] = await tx.$queryRaw`SELECT js."sourceKey", j."companyId", COUNT(*)::int n FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" WHERE js."isActive" AND j."isActive" GROUP BY 1,2`;
    const feeders: any[] = await tx.$queryRaw`SELECT j."companyId", COUNT(DISTINCT js."sourceKey")::int n FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" WHERE js."isActive" AND j."isActive" GROUP BY 1`;
    const aliases: any[] = await tx.$queryRaw`SELECT "sourceKey", "companyId" FROM "CompanyAlias" WHERE "reviewId" IS NOT NULL`;
    const perSource: any[] = await tx.$queryRaw`SELECT js."sourceKey", COUNT(*)::int n, COUNT(DISTINCT j."countryCode")::int countries, MODE() WITHIN GROUP (ORDER BY j."countryCode") top_country FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" WHERE js."isActive" AND j."isActive" GROUP BY 1`;
    const titles: any[] = await tx.$queryRaw`SELECT "sourceKey", title FROM (SELECT js."sourceKey", j.title, ROW_NUMBER() OVER (PARTITION BY js."sourceKey" ORDER BY j."firstSeenAt" DESC, j.id) rn FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" WHERE js."isActive" AND j."isActive") x WHERE rn <= 12`;
    return { sources, reviews, companies, feeds, feeders, aliases, perSource, titles };
  });

  const byId = new Map<string, any>(db.companies.map((c: any) => [c.id, c]));
  const byResolved = new Map<string, any>(db.companies.map((c: any) => [c.fashionjobsUrl, c]));
  const canon = (c: any): any => { let cur = c; for (let i = 0; cur?.mergedIntoId && i < 8; i++) cur = byId.get(cur.mergedIntoId) ?? cur; return cur; };
  const feedersOf = new Map<string, number>(db.feeders.map((f: any) => [f.companyId, f.n]));
  const reviewedAlias = new Set<string>(db.aliases.map((a: any) => `${a.sourceKey}|${canon(byId.get(a.companyId))?.id ?? a.companyId}`));
  const aliasSources = new Set<string>(db.aliases.map((a: any) => a.sourceKey));
  const perSource = new Map<string, any>(db.perSource.map((r: any) => [r.sourceKey, r]));
  const titlesOf = new Map<string, string[]>(); for (const t of db.titles) { const l = titlesOf.get(t.sourceKey) ?? []; const v = String(t.title ?? '').trim(); if (v && !l.includes(v) && l.length < 3) l.push(v); titlesOf.set(t.sourceKey, l); }
  const feedsBySource = new Map<string, any[]>(); for (const f of db.feeds) { const l = feedsBySource.get(f.sourceKey) ?? []; l.push(f); feedsBySource.set(f.sourceKey, l); }

  const rows: any[] = []; let certifiedCount = 0;
  for (const s of db.sources) {
    const review = db.reviews.find((r: any) => r.sourceKey === s.key) ?? null;
    let certified = false; if (review) { try { assertIdentityReview(s, review); certified = true; } catch { certified = false; } }
    if (certified) { certifiedCount++; continue; }
    const subjectKey = sourceSubjectKey(s);
    const maisonCompany = byResolved.has(`resolved:${subjectKey}`) ? canon(byResolved.get(`resolved:${subjectKey}`)) : null;
    // Postings credited by this source, per CANONICAL company (merged identities folded into their target).
    const perCompany = new Map<string, { company: any; n: number }>();
    for (const f of feedsBySource.get(s.key) ?? []) { const c = canon(byId.get(f.companyId)); if (!c) continue; const e = perCompany.get(c.id) ?? { company: c, n: 0 }; e.n += f.n; perCompany.set(c.id, e); }
    const fed = [...perCompany.values()].sort((a, b) => b.n - a.n);
    const stats = perSource.get(s.key); const active = stats?.n ?? 0;
    const isMaisonCompany = (c: any) => (maisonCompany ? c.id === maisonCompany.id : resolveCompany(String(c.name)).companyId === subjectKey);
    const legit = (c: any) => isMaisonCompany(c) || reviewedAlias.has(`${s.key}|${c.id}`);
    const mainFed = fed[0]?.company ?? null;
    const officialCompany = maisonCompany ?? (mainFed && isMaisonCompany(mainFed) ? mainFed : null);
    const verifiedReviews = db.reviews.filter((r: any) => r.tenantKey === s.tenantKey && r.verdict === 'VERIFIED');
    const officialDomains = [...new Set<string>([officialCompany?.domain, ...verifiedReviews.map((r: any) => r.officialDomain)].filter((d): d is string => !!d).map((d) => d.toLowerCase()))];
    const { host, locators } = locatorsOf(s); const vendorHosted = isVendorHost(host);
    const onOfficialDomain = !!host && !vendorHosted && officialDomains.some((d) => sameRegistrable(host, d));
    const linkers = [...new Set(locators.flatMap((l) => [...(linksToLocator.get(l) ?? [])]))];
    const verifiedFrom = linkers.filter((from) => !isVendorHost(from) && officialDomains.some((d) => sameRegistrable(from, d)));
    const unverifiedFrom = linkers.filter((from) => !verifiedFrom.includes(from));
    const board = ['SPECIALIST_JOBBOARD', 'AGGREGATOR'].includes(s.tier) || ['wttj-sector', 'fashionjobs', 'jobboard'].includes(s.kind) || /jobboard|wttj|fashionjobs/.test(s.key);
    const groupPortal = s.tier === 'GROUP_OFFICIAL' || fed.length >= 2; // canonical companies: none is merged into another by construction
    const soleFeeder = !!mainFed && (feedersOf.get(mainFed.id) ?? 0) === 1 && fed.length === 1;
    const reason = !mainFed ? '' : !legit(mainFed) ? 'FED_NOT_MAISON' : soleFeeder && officialDomains.length === 0 && !onOfficialDomain && verifiedFrom.length === 0 ? 'SOLE_FEEDER_NO_PROOF' : '';
    const family = board ? 'D_BOARD_OR_AGENCY' : groupPortal ? 'G_GROUP_PORTAL' : reason ? 'A_HOMONYM_SUSPECT' : onOfficialDomain ? 'B_OFFICIAL_DOMAIN_PORTAL' : verifiedFrom.length ? 'C_RECIPROCAL_LINK_VERIFIED' : 'E_RESEARCH_NEEDED';
    const secondaryShare = fed.length >= 2 && active ? (active - fed[0]!.n) / active : 0;
    rows.push({
      key: s.key, maison: s.maison, kind: s.kind, tier: s.tier, host, hostRegistrable: registrable(host) ?? '', vendorHosted, locators: locators.join(' '), active,
      fedCompanies: fed.map((f) => `${f.company.name} ${f.n}`).join(' · '), fedCount: fed.length, secondaryShare,
      mainCompany: mainFed?.name ?? null, maisonCompany: maisonCompany?.name ?? null, maisonHasCompany: !!maisonCompany, maisonFed: fed.some((f) => legit(f.company)), reason,
      officialDomains: officialDomains.join(' '), onOfficialDomain, verifiedFrom: verifiedFrom.join(' '), unverifiedLinks: unverifiedFrom.join(' '),
      topCountry: stats?.top_country ?? null, countries: stats?.countries ?? 0, feeders: mainFed ? feedersOf.get(mainFed.id) ?? 0 : 0,
      hasReviewedAlias: aliasSources.has(s.key), staleReview: !!review, sampleTitles: (titlesOf.get(s.key) ?? []).join(' | '), family,
    });
  }

  const families: Record<string, { label: string; blocker: string; next: string }> = {
    G_GROUP_PORTAL: { label: 'Portail de groupe (plusieurs sociétés canoniques nourries, ou tier GROUP_OFFICIAL)', blocker: 'aucun technique : il faut une certification MULTI_BRAND et un alias revu par libellé (la porte refuse chaque libellé sans alias)', next: 'comme Saks / KnitWell : `b6-aliases.mts <clone|production> <clés>` (libellé → Maison, page officielle archivée) puis `b6-certify-existing.sh <nom> <clés>` avec périmètre MULTI_BRAND' },
    A_HOMONYM_SUSPECT: { label: 'Homonymie suspecte (société nourrie ≠ Maison cataloguée et ni fusionnée ni alias revu ; ou nourrie par cette seule source sans domaine ni lien officiel vérifié)', blocker: 'l\'identité peut être fausse (cas loft, vitamin-a, one) : rien ne se certifie avant l\'audit', next: 'audit hors ligne sur les indices (pays, titres, hôte) ; mauvais tenant → `retire-source <clé>` (D27) ; même employeur → alias/fusion revus puis B ou C' },
    B_OFFICIAL_DOMAIN_PORTAL: { label: 'Portail hébergé sur le domaine officiel de la Maison (domaine enregistrable identique, hôte non mutualisé)', blocker: 'aucun', next: '`b6-certify-existing.sh <nom> <clés>` par lots de 10–15 (méthode OFFICIAL_DOMAIN : page du portail hébergée), libellés lus à la validation' },
    C_RECIPROCAL_LINK_VERIFIED: { label: 'Lien réciproque archivé DEPUIS une page du domaine officiel vers le portail du tenant', blocker: 'aucun', next: '`b6-certify-existing.sh <nom> <clés>` par lots (méthode OFFICIAL_LINK depuis la page archivée ; dump, clone, validation réelle, certification)' },
    D_BOARD_OR_AGENCY: { label: 'Jobboard, balayage sectoriel ou cabinet', blocker: 'décision : identité de board, pas de portail employeur', next: 'décision Loïc sur le flux B ; identité de board documentée' },
    E_RESEARCH_NEEDED: { label: 'Aucune provenance officielle vérifiée (ni domaine, ni lien depuis le domaine officiel)', blocker: 'recherche à mener ; les liens archivés depuis d\'autres pages sont des pistes, pas des preuves', next: '`research-portals.mts <input.json> <dossier>` ciblé sur la Maison (pistes : colonne unverifiedLinks), puis C ; sinon documenter le blocage daté' },
  };
  const order = Object.keys(families);
  const byFamily = Object.fromEntries(order.map((f) => [f, rows.filter((r) => r.family === f).sort((a, b) => b.active - a.active)]));
  const sum = (l: any[]) => l.reduce((n, r) => n + r.active, 0);
  const csvEsc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const cols = ['family', 'reason', 'sourceKey', 'maison', 'kind', 'tier', 'host', 'hostRegistrable', 'vendorHosted', 'tenantLocators', 'activePostings', 'fedCompanies', 'fedCount', 'mainCompany', 'maisonCompany', 'maisonHasCompany', 'maisonFed', 'officialDomains', 'onOfficialDomain', 'verifiedLinksFrom', 'unverifiedLinks', 'topCountry', 'countries', 'feedersOfMainCompany', 'hasReviewedAlias', 'staleReview', 'sampleTitles'];
  const csvRow = (r: any) => [r.family, r.reason, r.key, r.maison, r.kind, r.tier, r.host, r.hostRegistrable, r.vendorHosted, r.locators, r.active, r.fedCompanies, r.fedCount, r.mainCompany, r.maisonCompany, r.maisonHasCompany, r.maisonFed, r.officialDomains, r.onOfficialDomain, r.verifiedFrom, r.unverifiedLinks, r.topCountry, r.countries, r.feeders, r.hasReviewedAlias, r.staleReview, r.sampleTitles].map(csvEsc).join(',');
  writeFileSync(`${out}/uncertified-sources.csv`, [cols.join(','), ...order.flatMap((f) => byFamily[f]!.map(csvRow))].join('\n') + '\n');

  const noMaisonCompany = rows.filter((r) => !r.maisonHasCompany);
  const gMinor = byFamily.G_GROUP_PORTAL!.filter((r) => r.tier !== 'GROUP_OFFICIAL' && r.secondaryShare < 0.05);
  const gMaisonAbsent = byFamily.G_GROUP_PORTAL!.filter((r) => !r.maisonFed);
  const zeroActive = rows.filter((r) => r.active === 0);
  const noHost = rows.filter((r) => !r.host);
  const aByReason = Object.fromEntries(['FED_NOT_MAISON', 'SOLE_FEEDER_NO_PROOF'].map((k) => [k, byFamily.A_HOMONYM_SUSPECT!.filter((r) => r.reason === k).length]));
  const suspectLine = (r: any) => `| ${r.key} | ${r.maison} | ${r.mainCompany ?? '—'}${r.maisonCompany ? ` (Maison en base : ${r.maisonCompany})` : ' (Maison sans société en base)'} | ${r.reason} | ${r.host || '—'} | ${r.active} | ${r.topCountry ?? '—'} (${r.countries}) | ${r.feeders} | ${r.sampleTitles.replace(/\|/g, '/') || '—'} |`;
  const md = [
    `# Sources ACTIVE non certifiées — familles de traitement (${new Date().toISOString().slice(0, 16)}Z)`, '',
    `Dénominateur : **${rows.length} sources ACTIVE** dont la configuration courante n'a pas de revue d'identité valide, sur **${db.sources.length} actives** (${certifiedCount} certifiées au contrat strict). Une source = une famille, première règle qui s'applique dans l'ordre D → G → A → B → C → E. Généré par \`scripts/coverage/uncertified-families.mts\` (lecture seule, aucune collecte) ; liste complète avec les indices dans \`uncertified-sources.csv\`.`, '',
    '**Ce que le pré-tri compare** : le domaine enregistrable (`tldts`, comme la porte de promotion) — un hôte d\'ATS mutualisé (`*.myworkdayjobs.com`, `*.teamtailor.com`, `boards.greenhouse.io`, `jobs.lever.co`, `*.talent-soft.com`, `*.successfactors.*`…) n\'est jamais « sur le domaine officiel » ; le domaine officiel d\'une Maison = `Company.domain` de sa société canonique (`Source.maison` → `sourceSubjectKey` → `Company.fashionjobsUrl = resolved:<id>`, fusions suivies) ou l\'`officialDomain` d\'une revue VERIFIED existante du même tenant ; un lien archivé ne vaut que depuis une page de ce domaine, et il vise le TENANT (sur un hôte partagé, `jobs.smartrecruiters.com/<société>`, `jobs.lever.co/<site>`, `welcometothejungle.com/…/companies/<slug>`), pas l\'hôte ; une société nourrie est légitime si elle EST la société canonique de la Maison, y est fusionnée, ou porte un alias revu pour cette source (`CompanyAlias.reviewId`).', '',
    '| Famille | Sources | Offres actives | Blocage réel | Prochaine action |', '|---|---:|---:|---|---|',
    ...order.map((f) => `| ${families[f]!.label} | ${byFamily[f]!.length} | ${sum(byFamily[f]!)} | ${families[f]!.blocker} | ${families[f]!.next} |`),
    `| **Total** | **${rows.length}** | **${sum(rows)}** | | |`, '',
    `## Homonymie suspecte — toutes les sources, avec les indices lisibles hors ligne (FED_NOT_MAISON ${aByReason.FED_NOT_MAISON} · SOLE_FEEDER_NO_PROOF ${aByReason.SOLE_FEEDER_NO_PROOF})`, '',
    '`FED_NOT_MAISON` : la société créditée n\'est ni la société canonique de la Maison, ni fusionnée dedans, ni un alias revu de cette source. `SOLE_FEEDER_NO_PROOF` : la société n\'est nourrie que par cette source, sans domaine officiel connu en base et sans lien vérifié — l\'identité repose sur le seul libellé (une grande Maison sans `Company.domain` y tombe aussi : à lever en posant le domaine, D45).', '',
    '| Source | Maison cataloguée | Société nourrie | Motif | Hôte du portail | Offres | Pays principal (nb pays) | Sources de la société | 3 titres récents |', '|---|---|---|---|---|---:|---|---:|---|',
    ...byFamily.A_HOMONYM_SUSPECT!.map(suspectLine), '',
    '## Portails de groupe — sociétés nourries', '',
    '| Source | Maison cataloguée | Tier | Hôte | Offres | Sociétés créditées (offres) | Maison ou alias revu parmi elles |', '|---|---|---|---|---:|---|---|',
    ...byFamily.G_GROUP_PORTAL!.map((r) => `| ${r.key} | ${r.maison} | ${r.tier} | ${r.host || '—'} | ${r.active} | ${r.fedCompanies || '—'} | ${r.maisonFed ? 'oui' : 'NON'} |`), '',
    '## Par famille — les dix premières sources par volume', '',
    ...order.filter((f) => !['A_HOMONYM_SUSPECT', 'G_GROUP_PORTAL'].includes(f)).flatMap((f) => [`### ${families[f]!.label} (${byFamily[f]!.length})`, '', '| Source | Maison | ATS | Hôte | Offres | Société nourrie (pays principal, nb pays, nb sources) | Domaine officiel connu | Lien vérifié depuis | Pistes non vérifiées |', '|---|---|---|---|---:|---|---|---|---|', ...byFamily[f]!.slice(0, 10).map((r) => `| ${r.key} | ${r.maison} | ${r.kind} | ${r.host || '—'} | ${r.active} | ${r.mainCompany ?? '—'} (${r.topCountry ?? '—'}, ${r.countries}, ${r.feeders}) | ${r.officialDomains || '—'} | ${r.verifiedFrom || '—'} | ${r.unverifiedLinks || '—'} |`), '']),
    '## Limites du pré-tri (mesurées)', '',
    `- ${noMaisonCompany.length} sources dont la Maison cataloguée n'a **aucune société en base** sous sa clé canonique (\`resolved:<sourceSubjectKey>\`) : la légitimité de la société nourrie y est jugée par \`resolveCompany(nom)\`, sans domaine officiel possible côté société${noMaisonCompany.length ? ` — ${noMaisonCompany.slice(0, 12).map((r) => r.key).join(', ')}${noMaisonCompany.length > 12 ? '…' : ''}` : ''}.`,
    `- ${gMinor.length} sources classées G par la règle « ≥ 2 sociétés » alors que la seconde société pèse moins de 5 % des offres (probable libellé d'entité, pas un portail de groupe) : à traiter par alias revu plutôt que MULTI_BRAND${gMinor.length ? ` — ${gMinor.map((r) => r.key).join(', ')}` : ''}.`,
    `- ${gMaisonAbsent.length} portails de groupe dont AUCUNE société nourrie n'est la Maison cataloguée ni un alias revu : l'homonymie n'y est pas exclue, elle est simplement dominée par la règle G${gMaisonAbsent.length ? ` — ${gMaisonAbsent.map((r) => r.key).join(', ')}` : ''}.`,
    `- ${zeroActive.length} sources sans offre active (aucun indice de société possible)${zeroActive.length ? ` — ${zeroActive.map((r) => r.key).join(', ')}` : ''} ; ${noHost.length} sources sans hôte lisible dans la configuration${noHost.length ? ` — ${noHost.map((r) => r.key).join(', ')}` : ''}.`,
    `- Les liens archivés viennent de \`${RESEARCH}\` (${linksToLocator.size} tenants cibles) : une Maison jamais recherchée n'y a pas de lien, ce qui la range en E sans préjuger de son site.`,
    '- Le pré-tri ne lit ni robots.txt ni les libellés natifs : B et C restent soumis à la validation réelle de `b6-certify-existing.sh` (accès ALLOWED lu, board exact, périmètre).',
  ].join('\n');
  writeFileSync(`${out}/uncertified-families.md`, md + '\n');
  console.log(JSON.stringify({ uncertified: rows.length, active: db.sources.length, certified: certifiedCount, families: Object.fromEntries(order.map((f) => [f, { sources: byFamily[f]!.length, postings: sum(byFamily[f]!) }])), homonymByReason: aByReason, limits: { noMaisonCompany: noMaisonCompany.length, gMinorSecondary: gMinor.length, gMaisonAbsent: gMaisonAbsent.length, zeroActive: zeroActive.length, noHost: noHost.map((r) => r.key) } }, null, 1));
} finally { await p.$disconnect(); }
