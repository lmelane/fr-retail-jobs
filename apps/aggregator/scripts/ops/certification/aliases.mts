import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildEmployerRepair, applyEmployerRepair } from '../../../src/identity/repair.js';
import { digest } from '../../../src/remediation/plan.js';
import { resolveCompany } from '../../../src/normalize/company.js';
import { classifyLabel } from '../../../src/lib/candidateChecks.js';
import { archivedPage, loadSpecs, ROOT as root } from './lib.mts';

// B6 — reviewed aliases for a MULTI_BRAND candidate BEFORE its certification and promotion: on a portal where several brands of one
// group publish (headquarters_us_Uniqlo: UNIQLO USA LLC + GU USA LLC), the gate refuses every first posting of a label without a
// reviewed alias — and must. The spec lists label → Maison; each Maison must exist as a canonical company (created here, idempotently,
// under its canonical key when absent), each label must be an entity of its Maison (classifyLabel OWNER / OWNER_ENTITY, never OTHER),
// and the labels must be exactly those read by the validation proof of the phase. Evidence: the archived official page of the spec +
// the validation proof. Same plan on clone then production; replay 0. No-op for keys without `aliases`.
// usage: b6-aliases.mts <clone|production> <key[,key…]>
const [phase, keysArg] = process.argv.slice(2);
if (!['clone', 'production'].includes(phase ?? '') || !keysArg) throw Error('usage: <clone|production> <key[,key…]>');
const u = new URL(process.env.DATABASE_URL!);
const local = ['127.0.0.1', 'localhost'].includes(u.hostname);
if ((phase === 'clone') !== local) throw Error('Environment mismatch');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const specs = loadSpecs();
const p = new PrismaClient({ log: [] });
try {
  for (const key of keysArg.split(',')) {
    const s = specs.find((x: { key: string }) => x.key === key) as any;
    if (!s) throw Error(`no spec for ${key}`);
    if (!s.aliases?.length) { console.log(`${key} | aliases | none declared (SINGLE_BRAND path)`); continue; }
    const proofFile = `${root}/b6-validate-${phase}-${key}.json`;
    if (!existsSync(proofFile)) throw Error(`${key}: validation proof missing`);
    const validation = JSON.parse(readFileSync(proofFile, 'utf8'));
    // MULTI_BRAND: every native label needs a reviewed alias (or is deliberately left to review). SINGLE_BRAND with exceptions: the
    // owner's own labels (OWNER / OWNER_ENTITY) are credited by the certified portal rule; only labels OUTSIDE the owner must be covered.
    const mustCover = (l: any) => l.class !== 'CATALOGUE' && (s.portalScope === 'MULTI_BRAND' || l.class === 'OTHER');
    const read = new Map<string, number>(validation.scopeEvidence.labels.filter(mustCover).map((l: any) => [l.label, l.n]));
    const declared = new Set<string>([...s.aliases.map((a: any) => a.rawName), ...(s.unresolvedLabels ?? []).map((u: any) => u.rawName)]); // unresolved labels are declared too: collected, refused at the gate (review), never silently credited
    const missing = [...read.keys()].filter((l) => !declared.has(l)); const extra = [...declared].filter((l) => !read.has(l) && !(s.unresolvedLabels ?? []).some((u: any) => u.rawName === l));
    if (missing.length || extra.length) throw Error(`${key}: aliases must cover exactly the labels read — missing ${JSON.stringify(missing)}, not read ${JSON.stringify(extra)}`);
    for (const a of s.aliases) { const c = classifyLabel(a.rawName, a.maison); if (c === 'OTHER') throw Error(`${key}: "${a.rawName}" is not an entity of ${a.maison}`); }
    const companies = new Map<string, any>();
    for (const a of s.aliases) {
      const identity = resolveCompany(a.maison); const fj = `resolved:${identity.companyId}`;
      let c = await p.company.findUnique({ where: { fashionjobsUrl: fj } });
      if (c?.mergedIntoId) c = await p.company.findUniqueOrThrow({ where: { id: c.mergedIntoId } });
      if (!c) c = await p.company.create({ data: { name: a.maison, canonicalKey: identity.companyId, fashionjobsUrl: fj, kind: 'BRAND' } });
      companies.set(a.maison, c);
    }
    const page = archivedPage(s); if (createHash('sha256').update(page.buffer).digest('hex') !== s.proofSha) throw Error('official page hash mismatch');
    const spec = {
      batchId: `20260910-LOT4-B6-ALIASES-${key.toUpperCase()}-v1`,
      statement: `${(s.unresolvedLabels ?? []).length ? `Labels deliberately left to identity review (no alias): ${(s.unresolvedLabels ?? []).map((u: any) => `"${u.rawName}" — ${u.reason}`).join('; ')}. ` : ''}Reviewed aliases for the MULTI_BRAND candidate ${key} (${s.portalUrl}): ${s.aliases.map((a: any) => `"${a.rawName}" (×${read.get(a.rawName)}) → ${a.maison}`).join('; ')}. Each label is a legal entity of its Maison (classifyLabel), all brands are named on the archived official page ${s.proofUrl}; labels = exactly those read on ${validation.at.slice(0, 10)} (${validation.parsed} postings).`,
      reviewedBy: 'B6 MULTI_BRAND alias review (Claude, LOT 4, 2026-09-10)', reviewedAt: new Date().toISOString(),
      evidence: [{ url: s.proofUrl, sha256: s.proofSha, artifactText: page.text, explanation: 'Official employment page naming the group brands and linking the site.' }, (() => { const text = JSON.stringify(validation.scopeEvidence, null, 1); return { url: s.portalUrl, sha256: createHash('sha256').update(text).digest('hex'), artifactText: text, explanation: 'Native employer labels read on the board by validate-candidate.' }; })()],
      merges: [], aliases: s.aliases.map((a: any) => ({ sourceKey: key, rawName: a.rawName, companyId: companies.get(a.maison)!.id })),
    };
    const planFile = `${root}/b6-aliases-${key}-${phase}-plan.json`;
    // The clone is restored fresh before every rehearsal: its plan is always rebuilt (a stale plan would carry ids of a previous restore).
    // Production reuses its own plan only if one exists for this key (idempotent replay), and is compared with the clone plan by labels, never by ids.
    const plan = phase === 'production' && existsSync(planFile) ? JSON.parse(readFileSync(planFile, 'utf8')) : await buildEmployerRepair(p, spec);
    writeFileSync(planFile, JSON.stringify(plan, null, 1));
    if (phase === 'production') { const clone = JSON.parse(readFileSync(`${root}/b6-aliases-${key}-clone-plan.json`, 'utf8')); if (digest(clone.aliases.map((a: any) => `${a.sourceKey}|${a.rawName}`).sort()) !== digest(plan.aliases.map((a: any) => `${a.sourceKey}|${a.rawName}`).sort())) throw Error('Production plan differs from clone rehearsal'); }
    const result = await applyEmployerRepair(p, plan, digest(plan), commit);
    const replay = await applyEmployerRepair(p, plan, digest(plan), commit);
    const proof = { at: new Date().toISOString(), environment: phase, key, commit, planHash: digest(plan), aliases: spec.aliases.map((a: any) => ({ ...a, company: [...companies.values()].find((c) => c.id === a.companyId)?.name })), result, replay };
    writeFileSync(`${root}/b6-aliases-${key}-${phase}-proof.json`, JSON.stringify(proof, null, 2));
    console.log(`${key} | aliases | ${JSON.stringify({ aliases: spec.aliases.length, result, replay })}`);
  }
} finally { await p.$disconnect(); }
