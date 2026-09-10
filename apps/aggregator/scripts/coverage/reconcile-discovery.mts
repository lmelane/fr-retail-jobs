/**
 * Reconcile a web-discovery report (markdown tables of actors / portals / ATS tenants) with the CURRENT catalogue.
 *
 * Usage: npx tsx apps/aggregator/scripts/coverage/reconcile-discovery.mts <report.md> <output.json> [output.md]
 *
 * Read-only. For every table row that names an actor and a portal, the tool looks up — in the database, never in a CSV —
 * the canonical company (name, alias display names, domain), the sources whose careersDomain / config origin / tenantKey
 * match the portal host or tenant, and classifies the row:
 *   ALREADY_COVERED            an ACTIVE source already reads this portal (same host or tenant);
 *   COVERED_BUT_NOT_ACTIVE     the portal is catalogued but PAUSED / RETIRED / DRAFT (re-activation is a review, never a replay);
 *   NEW_SOURCE_EXISTING_ACTOR  the actor exists (company, alias or domain) but no source reads this portal;
 *   NEW_ACTOR                  neither the actor nor the portal is known;
 *   CONFIG_OR_ATTRIBUTION      a source exists for the actor on another host/tenant, or the report says the config is to repair;
 *   INVESTIGATION              the row names no portal host or an unsupported/unknown ATS.
 * The report's own category is kept next to the verdict so that its counters can be recomputed honestly.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const [reportPath, outJson, outMd] = process.argv.slice(2);
if (!reportPath || !outJson) { console.error('usage: reconcile-discovery.mts <report.md> <output.json> [output.md]'); process.exit(2); }
const text = readFileSync(reportPath, 'utf8');

type Row = { section: string; actor: string; presence: string; officialSite: string; portal: string; ats: string; action: string; raw: string[] };
const rows: Row[] = [];
let section = '';
for (const line of text.split('\n')) {
  const h = /^##\s+(.*)/.exec(line);
  if (h) { section = h[1]!.trim(); continue; }
  if (!line.startsWith('|') || /^\|\s*-+/.test(line) || /^\|\s*Acteur\s*\|/i.test(line)) continue;
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length < 4) continue;
  if (cells.length >= 12) rows.push({ section, actor: cells[0]!, presence: cells[4]!, officialSite: cells[5]!, portal: cells[6]!, ats: cells[7]!, action: cells[11]!, raw: cells });
  else rows.push({ section, actor: cells[0]!, presence: cells[1] ?? '', officialSite: '', portal: cells[1] ?? '', ats: cells[2] ?? '', action: cells[cells.length - 1]!, raw: cells });
}
const clean = (s: string) => s.replace(/\*\*/g, '').replace(/`/g, '').trim();
const hostsOf = (s: string): string[] => [...new Set((clean(s).match(/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s,;()]*)?/gi) ?? []).map((h) => h.split('/')[0]!.toLowerCase()).filter((h) => !/^(fr|en|de|it|es|us)\.?$/.test(h)))];
const norm = (s: string) => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const rootDomain = (h: string) => { const parts = h.replace(/^www\./, '').split('.'); return parts.length > 2 && /^(co|com|org|net)$/.test(parts[parts.length - 2]!) ? parts.slice(-3).join('.') : parts.slice(-2).join('.'); };

const prisma = new PrismaClient({ log: [] });
try {
  const sources = await prisma.source.findMany({ select: { key: true, maison: true, kind: true, status: true, careersDomain: true, tenantKey: true, config: true } });
  const srcHosts = sources.map((s) => {
    const cfg = (s.config ?? {}) as Record<string, unknown>;
    const hosts = new Set<string>();
    if (s.careersDomain) hosts.add(s.careersDomain.toLowerCase());
    for (const k of ['origin', 'listingUrl', 'jobs_url', 'careers_url', 'careersUrl', 'sitemapUrl', 'baseUrl', 'endpoint']) { const v = cfg[k]; if (typeof v === 'string') { try { hosts.add(new URL(v).hostname.toLowerCase()); } catch { /* not a URL */ } } }
    return { ...s, hosts: [...hosts], tenant: (s.tenantKey ?? '').toLowerCase(), cfg };
  });
  // A host shared by several catalogued sources (jobs.lever.co, careers.smartrecruiters.com, welcometothejungle.com, career*.sapsf.eu…)
  // proves nothing by itself: on such a host the row must name a tenant/slug that a source config carries.
  const hostUse = new Map<string, number>();
  for (const s of srcHosts) for (const h of s.hosts) hostUse.set(h, (hostUse.get(h) ?? 0) + 1);
  const shared = (h: string) => (hostUse.get(h) ?? 0) >= 3 || /^(jobs\.lever\.co|careers\.smartrecruiters\.com|job-boards\.greenhouse\.io|boards\.greenhouse\.io|www\.welcometothejungle\.com|welcometothejungle\.com|apply\.workable\.com|jobs\.ashbyhq\.com)$/.test(h) || /sapsf\.(eu|com)$|successfactors\.(eu|com)$/.test(h);
  const out: any[] = [];
  for (const r of rows) {
    if (!r.actor || /^(Cas|Acteur)$/i.test(r.actor)) continue;
    const actorName = clean(r.actor).split(/\s[—(]/)[0]!.trim();
    const n = norm(actorName);
    const first = n.split(' ')[0]!;
    const companies = await prisma.company.findMany({ where: { mergedIntoId: null, OR: [{ name: { equals: actorName, mode: 'insensitive' } }, { name: { contains: first.length >= 4 ? first : actorName, mode: 'insensitive' } }, { aliases: { some: { displayName: { contains: first.length >= 4 ? first : actorName, mode: 'insensitive' } } } }] }, select: { id: true, name: true, kind: true, domain: true, parentGroup: true, _count: { select: { jobs: { where: { isActive: true } } } } }, take: 8 });
    const officialHosts = hostsOf(r.officialSite).map(rootDomain);
    const byDomain = officialHosts.length ? await prisma.company.findMany({ where: { mergedIntoId: null, domain: { in: officialHosts } }, select: { id: true, name: true, kind: true, domain: true, _count: { select: { jobs: { where: { isActive: true } } } } } }) : [];
    const exact = companies.filter((c) => norm(c.name) === n);
    const known = [...exact, ...byDomain.filter((c) => !exact.some((e) => e.id === c.id))];
    const portalHosts = hostsOf(r.portal);
    const tenantTokens = (clean(r.ats).match(/`([^`]+)`/g) ?? []).map((t) => t.replace(/`/g, '').toLowerCase());
    const pathTokens = (clean(r.portal).match(/[a-z0-9.-]+\.[a-z]{2,}\/([A-Za-z0-9_-]{3,})/g) ?? []).map((m) => m.split('/')[1]!.toLowerCase());
    const tokens = [...new Set([...tenantTokens, ...pathTokens])].filter((t) => t.length >= 4 && !/^(fr|en|jobs|job|careers|career|company|companies|search)$/.test(t));
    const tokenMatch = (s: typeof srcHosts[number]) => tokens.some((t) => s.tenant.includes(t) || JSON.stringify(s.cfg).toLowerCase().includes(t) || s.key.includes(t));
    const portalSources = srcHosts.filter((s) => s.hosts.some((h) => portalHosts.includes(h) && (!shared(h) || tokenMatch(s))) || (tokens.length && !portalHosts.length && tokenMatch(s)));
    const actorSources = srcHosts.filter((s) => norm(s.maison.split('(')[0]!) === n || (first.length >= 5 && norm(s.maison).startsWith(first)));
    const active = portalSources.filter((s) => s.status === 'ACTIVE');
    let verdict: string;
    if (active.length) verdict = 'ALREADY_COVERED';
    else if (portalSources.length) verdict = 'COVERED_BUT_NOT_ACTIVE';
    else if (/réparable|Réparer|corriger|mettre à jour la fiche/i.test(r.action) || (actorSources.length && portalHosts.length)) verdict = 'CONFIG_OR_ATTRIBUTION';
    else if (!portalHosts.length || /aucun ats|portail propre|portail maison|page shopify|scraper|à créer|non résolu/i.test(r.ats + ' ' + r.action)) verdict = portalHosts.length ? 'INVESTIGATION' : 'INVESTIGATION';
    else if (known.length || actorSources.length) verdict = 'NEW_SOURCE_EXISTING_ACTOR';
    else verdict = 'NEW_ACTOR';
    out.push({ section: r.section, actor: actorName, reportPresence: clean(r.presence), officialSite: clean(r.officialSite), portalHosts, ats: clean(r.ats).slice(0, 120), reportAction: clean(r.action).slice(0, 140), verdict,
      companies: known.slice(0, 4).map((c) => ({ name: c.name, kind: c.kind, domain: c.domain, active: c._count.jobs })), nearNames: companies.filter((c) => !known.some((k) => k.id === c.id)).slice(0, 4).map((c) => c.name),
      portalSources: portalSources.map((s) => `${s.key} [${s.status}] ${s.hosts.join(',')}`), actorSources: actorSources.filter((s) => !portalSources.some((ps) => ps.key === s.key)).map((s) => `${s.key} [${s.status}] ${s.hosts.join(',')}`) });
  }
  const counts: Record<string, number> = {}; for (const o of out) counts[o.verdict] = (counts[o.verdict] ?? 0) + 1;
  const bySection: Record<string, Record<string, number>> = {}; for (const o of out) { (bySection[o.section] ??= {})[o.verdict] = ((bySection[o.section] ??= {})[o.verdict] ?? 0) + 1; }
  writeFileSync(outJson, JSON.stringify({ at: new Date().toISOString(), report: reportPath, rows: out.length, counts, bySection, items: out }, null, 1));
  if (outMd) {
    const lines = ['| Section du rapport | Acteur | Présence (rapport) | Portail | Verdict BDD | Sociétés connues | Sources sur ce portail | Sources de l\'acteur (autre portail) | Action du rapport |', '|---|---|---|---|---|---|---|---|---|'];
    for (const o of out) lines.push(`| ${o.section.slice(0, 40)} | ${o.actor} | ${o.reportPresence.slice(0, 40)} | ${o.portalHosts.join(', ')} | **${o.verdict}** | ${o.companies.map((c: any) => `${c.name} (${c.active})`).join('; ') || '—'} | ${o.portalSources.join('; ') || '—'} | ${o.actorSources.join('; ') || '—'} | ${o.reportAction.slice(0, 80)} |`);
    writeFileSync(outMd, `# Rapprochement du rapport de découverte avec la base (${new Date().toISOString().slice(0, 10)})\n\nLignes : ${out.length} · ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}\n\n${lines.join('\n')}\n`);
  }
  console.log(JSON.stringify({ rows: out.length, counts, bySection }, null, 1));
} finally {
  await prisma.$disconnect();
}
