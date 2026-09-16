import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerSourceCandidate } from '../../../src/connectors/sourceCandidate.js';
import { recordSourceIdentityReview, sourceIdentityHash, sourceSubjectKey, certifiedPortalScope } from '../../../src/connectors/sourceIdentity.js';
import { promoteSource } from '../../../src/connectors/sourceStore.js';
import { loadSpecs, portalReferences, ROOT as root } from './lib.mts';

// B6 — source-by-source integration through the EXISTING process, driven by b6-specs.json (one entry per candidate: identity
// proof page archived by the portal research, portal, perimeter, sector). Steps: register (DRAFT) → [validate-candidate --write
// --proof: robots + real adapter + native labels, run separately] → certify (SourceIdentityReview on the archived official page,
// refused unless the page names the EXACT board of the configuration and the labels read are consistent with the declared
// perimeter) → promote (controlled). Usage: b6-integrate.mts <clone|production> <register|certify|promote> <key[,key…]>
const [phase, step, keysArg] = process.argv.slice(2);
if (!['clone', 'production'].includes(phase ?? '') || !['register', 'certify', 'promote'].includes(step ?? '') || !keysArg) throw Error('usage: <clone|production> <register|certify|promote> <key[,key…]>');
const u = new URL(process.env.DATABASE_URL!);
const local = ['127.0.0.1', 'localhost'].includes(u.hostname);
if ((phase === 'clone') !== local) throw Error('Environment mismatch');
const specs = loadSpecs();
const keys = keysArg.split(',');
const VALIDATION_MAX_AGE_MS = 24 * 3600_000;

const p = new PrismaClient({ log: [] });
try {
  const proofs: any[] = [];
  for (const key of keys) {
    const s = specs.find((x: { key: string }) => x.key === key);
    if (!s) throw Error(`no spec for ${key}`);
    let result: unknown;
    if (step === 'register') {
      result = await registerSourceCandidate(p, { key: s.key, maison: s.maison, kind: s.kind, tier: s.tier, config: s.config, careersDomain: s.careersDomain } as any);
    } else if (step === 'certify') {
      const artifact = readFileSync(`${root}/portal-research/artifacts/${s.proofSha}.txt`);
      if (createHash('sha256').update(artifact).digest('hex') !== s.proofSha) throw Error(`${key}: archived official page does not match its hash`);
      const source = await p.source.findUniqueOrThrow({ where: { key } });
      const config = (source.config ?? {}) as Record<string, unknown>;
      // 1. Board exact: the official page must name the configured board itself (tenant + site / board token / host+path).
      const text = artifact.toString('utf8');
      const refs = portalReferences(source.kind, config);
      const match = refs.map((r: RegExp) => r.exec(text)?.[0]).find(Boolean);
      if (!match) throw Error(`${key}: the archived official page does not reference the configured board (${refs.map(String).join(' | ')})`);
      if (s.mustContain && !text.toLowerCase().includes(String(s.mustContain).toLowerCase())) throw Error(`${key}: official page lost its link to the portal (${s.mustContain})`);
      // 2. Perimeter: the validation proof of THIS phase, fresh, with the labels really read on the board.
      const proofFile = `${root}/b6-validate-${phase}-${key}.json`;
      if (!existsSync(proofFile)) throw Error(`${key}: no validation proof ${proofFile} — run validate-candidate --write --proof first`);
      const validation = JSON.parse(readFileSync(proofFile, 'utf8'));
      if (Date.now() - Date.parse(validation.at) > VALIDATION_MAX_AGE_MS) throw Error(`${key}: validation proof older than 24 h`);
      // An already ACTIVE source (certification of an existing source) keeps its stored verdict: the validation tool never rewrites it, so `written` is not required there.
      // D62 : le robots OBSERVÉ ne décide plus seul. Une surface publique d'offres reste collectable sous
      // l'autorisation sectorielle du propriétaire ; le verdict lu est conservé tel quel dans la preuve et
      // recopié dans l'énoncé de la revue, jamais maquillé en ALLOWED.
      if ((source.status !== 'ACTIVE' && !validation.written) || !(validation.parsed >= 1)) throw Error(`${key}: validation proof has no parsed postings (${validation.robotsVerdict}, parsed ${validation.parsed})`);
      const scope = validation.scopeEvidence;
      if (!scope || scope.maison !== source.maison) throw Error(`${key}: validation proof has no perimeter evidence for ${source.maison}`);
      // A label outside the owner contradicts SINGLE_BRAND — unless a reviewed alias (declared in the spec, applied by b6-aliases before this step) already routes it to its own Maison: the alias outranks the portal rule at the gate.
      const aliased = new Set<string>(((s as any).aliases ?? []).map((a: any) => a.rawName));
      const outside = scope.labels.filter((l: any) => l.class === 'OTHER' && !aliased.has(l.label)).map((l: any) => `${l.label} (${l.n})`);
      if (s.portalScope === 'SINGLE_BRAND' && outside.length) throw Error(`${key}: SINGLE_BRAND contradicted by native labels outside the owner: ${outside.join('; ')} — review as MULTI_BRAND with aliases or exclude`);
      const labelsRead = scope.labels.map((l: any) => `${l.label} ×${l.n} [${l.class}]`).join(', ');
      const statement = `${s.statement} Board reference found on the archived official page: "${match}" (config ${JSON.stringify(config)}). Native employer labels read on ${validation.at.slice(0, 10)} (${validation.parsed} postings parsed, robots ${validation.robotsVerdict} HTTP ${validation.robots?.httpStatus ?? 'n/a'}): ${labelsRead} → ${scope.verdict}. ${validation.robotsVerdict === 'ALLOWED' ? '' : `Accès : robotsObserved=${validation.robotsVerdict}, accessSurface=PUBLIC_JOB_SURFACE, authorizationBasis=OWNER_SECTOR_AUTHORIZATION (D62, 2026-09-13), effectiveAccessDecision=ALLOWED, crawlerIdentity=CatwalksBot/1.0.`}`;
      const document = {
        sourceKey: key, sourceRevisionId: s.sourceRevisionId, tenantKey: source.tenantKey, subjectKey: sourceSubjectKey(source), sourceHash: sourceIdentityHash(source),
        verdict: 'VERIFIED', method: 'OFFICIAL_LINK', officialDomain: s.officialDomain, proofUrl: s.proofUrl, portalUrl: s.portalUrl, portalScope: s.portalScope,
        statement, artifactHash: s.proofSha, reviewer: 'Reciprocal-link certification on the archived official page + board/perimeter checks against the validation proof, B6 integration (Claude, LOT 4, 2026-09-10)', checkedAt: new Date().toISOString(),
      };
      result = { boardReference: match, scopeVerdict: scope.verdict, written: await recordSourceIdentityReview(p, document as any, artifact, true), scope: await certifiedPortalScope(p, key) };
    } else {
      result = await promoteSource(p, key);
    }
    const after = await p.source.findUniqueOrThrow({ where: { key }, select: { key: true, status: true, tenantKey: true, robotsVerdict: true, robotsCheckedAt: true, verifiedJobCount: true } });
    if (step === 'promote' && after.status !== 'ACTIVE') throw Error(`${key}: promotion did not end ACTIVE (${after.status})`);
    proofs.push({ key, step, result, after });
    console.log(`${key} | ${step} | ${JSON.stringify(after)}${step === 'certify' ? ` | ${JSON.stringify({ boardReference: (result as any).boardReference, scopeVerdict: (result as any).scopeVerdict })}` : ''}`);
  }
  writeFileSync(`${root}/b6-integrate-${phase}-${step}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}-proof.json`, JSON.stringify({ at: new Date().toISOString(), environment: phase, step, proofs }, null, 2));
} finally {
  await p.$disconnect();
}
