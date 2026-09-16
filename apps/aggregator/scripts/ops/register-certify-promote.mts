import { identityReviewOrder } from '../../src/connectors/sourceIdentity.js';
/**
 * REGISTER → CERTIFY → PROMOTE en PRODUCTION, par le chemin commun, sans collecte.
 *
 * `onboard-source.mts` refuse la production, et il a raison : il REJOUE une cassette, et une intégration de
 * production doit collecter pour de vrai, depuis l'egress qui exécutera les runs (D32). Ce programme fait
 * donc la moitié qui n'a pas besoin du réseau — l'enregistrement, la certification, la promotion — et laisse
 * la collecte à une ingestion bornée.
 *
 * Il n'implémente aucune de ces étapes : il appelle exactement les mêmes fonctions maintenues que le clone.
 *   register  `registerSourceCandidate`
 *   certify   `recordSourceIdentityReview`  — refuse sans artefact archivé, haché, et déclaration
 *   promote   `promoteSource`               — refuse une source non certifiée, sans robots daté, sans offre prouvée
 *
 * La porte de promotion exige un `verifiedJobCount ≥ 1` : il est posé depuis le **nombre réellement lu** lors
 * de la validation sur clone, jamais inventé. Sans validation préalable, la promotion est refusée — et c'est
 * le comportement voulu.
 *
 * `--apply` est obligatoire. Sans lui, l'état est lu et affiché, rien n'est écrit.
 *
 * usage: db.py production npx tsx scripts/ops/register-certify-promote.mts <dossier.json>
 *          --verified-jobs=<n> [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const APPLY = process.argv.includes('--apply');
const verifiedJobs = Number(arg('verified-jobs') ?? 0);

if (!file) { console.error('usage: register-certify-promote.mts <dossier.json> --verified-jobs=<n> [--apply]'); process.exit(2); }
const d = JSON.parse(readFileSync(file, 'utf8'));

const p = new PrismaClient({ log: [] });
const steps: any[] = [];

const stateOf = async () => {
  const source = await p.source.findUnique({
    where: { key: d.key },
    select: { currentRevisionId: true, key: true, status: true, tenantKey: true, kind: true, config: true, maison: true,
              careersDomain: true, tier: true, robotsVerdict: true, verifiedJobCount: true },
  });
  const review = await p.sourceIdentityReview.findFirst({
    where: { sourceKey: d.key }, orderBy: identityReviewOrder });
  let certification = 'NO_REVIEW';
  if (source && review) {
    const { assertIdentityReview } = await import('../../src/connectors/sourceIdentity.js');
    try { assertIdentityReview(source as any, review); certification = 'CERTIFIED'; }
    catch (e) { certification = `INVALID: ${(e as Error).message.replace(/^promote: /, '').slice(0, 80)}`; }
  }
  return { exists: !!source, status: source?.status ?? null, certification,
           robots: source?.robotsVerdict ?? null, verifiedJobCount: source?.verifiedJobCount ?? null };
};

const record = async (step: string, result: unknown) => {
  const after = await stateOf();
  steps.push({ step, result, after });
  console.log(`${step.padEnd(10)} → ${JSON.stringify(after)}`);
};

await record('initial', null);

if (!APPLY) {
  console.log(JSON.stringify({ mode: 'DRY-RUN', dossier: d.key, steps }, null, 1));
  await p.$disconnect();
  process.exit(0);
}

const { registerSourceCandidate } = await import('../../src/connectors/sourceCandidate.js');
const { promoteSource } = await import('../../src/connectors/sourceStore.js');
const { recordSourceIdentityReview, sourceIdentityHash, sourceSubjectKey } =
  await import('../../src/connectors/sourceIdentity.js');
const { readRobots, requestTarget } = await import('../../src/lib/candidateChecks.js');

// ── register
await record('register', await registerSourceCandidate(p as any, {
  key: d.key, maison: d.maison, kind: d.kind, tier: d.tier,
  config: d.config, careersDomain: d.careersDomain,
} as any));

/**
 * Le verdict d'accès est LU à la source, ici et maintenant — un verdict recopié d'une répétition serait un
 * verdict d'un autre instant, et il vieillit (D60 : un robots.txt absent ou injoignable n'autorise rien par
 * lui-même, et sa lecture doit être datée).
 */
const target = requestTarget(d.kind as any, d.config);
const robots = await readRobots(target.origin, target.path);
await p.source.update({
  where: { key: d.key },
  data: { robotsVerdict: robots.verdict, robotsCheckedAt: new Date(),
          verifiedJobCount: verifiedJobs > 0 ? verifiedJobs : undefined },
});
await record('robots+volume', { verdict: robots.verdict, verifiedJobs });

// ── certify : l'artefact archivé est relu et haché ici, jamais supposé.
const artifact = readFileSync(d.evidenceFile);
const artifactHash = createHash('sha256').update(artifact).digest('hex');
const source = await p.source.findUniqueOrThrow({ where: { key: d.key } });
await recordSourceIdentityReview(p as any, {
  sourceKey: d.key, sourceRevisionId: d.sourceRevisionId, tenantKey: source.tenantKey, subjectKey: sourceSubjectKey(source as any),
  sourceHash: sourceIdentityHash(source as any), verdict: 'VERIFIED', method: 'OFFICIAL_LINK',
  artifactHash, reviewer: 'lot4', statement: d.statement,
  proofUrl: d.proofUrl, portalUrl: d.portalUrl, officialDomain: d.officialDomain,
  portalScope: d.portalScope, checkedAt: new Date(),
} as any, artifact, true);
await record('certify', { artifactHash: artifactHash.slice(0, 16) });

// ── promote : la porte commune, avec ses six conditions.
await record('promote', await promoteSource(p as any, d.key));

console.log(JSON.stringify({ dossier: d.key, transitions: steps.map((s) => `${s.step}:${s.after.status}/${s.after.certification}`) }, null, 1));
await p.$disconnect();
