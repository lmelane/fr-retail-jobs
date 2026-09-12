/**
 * PARITÉ PRÉVISUALISATION / MUTATION — démontrée sur CLONE, sur les dix situations qui comptent.
 *
 * La question n'est pas « le refresh fonctionne-t-il » mais « la mutation fait-elle EXACTEMENT ce que la revue
 * annonçait ». Le programme construit donc chaque situation dans une base de répétition, produit le plan par
 * le planificateur COMMUN, fige le manifeste, exécute le VRAI `runRefresh`, et compare.
 *
 * Les dix situations :
 *   1. une JobSource absente et fermable ;
 *   2. une autre source active HORS allowlist qui maintient l'offre ouverte ;
 *   3. une ligne PRESENT_BUT_REJECTED ;
 *   4. une ligne PRESENT_BUT_HELD ;
 *   5. une ligne PRESENT_BUT_WRITE_FAILED ;
 *   6. une source UNVERIFIABLE ;
 *   7. un board vide prouvé ;
 *   8. une source avec une ligne anonyme ;
 *   9. un état modifié APRÈS génération du manifeste ;
 *  10. une ligne extérieure au manifeste.
 *
 * Clone uniquement — la garde est le nom de la base.
 * usage: refresh-parity.mts [--out=<f.json>]
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import {
  sourceEligibility, representationState, planRefresh,
  type Representation, type RepresentationState, type EnumerationEvidence, type SourceRunFacts,
} from '../../src/pipeline/refreshPlan.js';
import { freezeManifest, verifyManifest, compareTouched, type ManifestEntry } from '../../src/pipeline/refreshManifest.js';
import { runRefresh } from '../../src/pipeline/refresh.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const p = new PrismaClient({ log: [] });

const results: Array<{ scenario: string; passed: boolean; detail: unknown }> = [];
const check = (scenario: string, passed: boolean, detail: unknown) => {
  results.push({ scenario, passed, detail });
  console.log(`${passed ? '✓' : '✗'} ${scenario}`);
  if (!passed) console.log(`    ${JSON.stringify(detail)}`);
};

const STALE = new Date(Date.now() - 72 * 3_600_000);
const FRESH = new Date();

try {
  const [{ current_database: db }]: any[] = await p.$queryRaw`SELECT current_database()`;
  if (!/replay|clone|test|parity/.test(db)) throw new Error(`refus : ${db} n'est pas un clone`);

  /** Un décor propre : chaque scénario part du même état vide. */
  const wipe = async () => {
    await p.jobSource.deleteMany({});
    await p.job.deleteMany({});
    await p.company.deleteMany({});
    await p.sourceRun.deleteMany({});
  };

  const company = async () => p.company.create({
    data: { name: 'Acme', canonicalKey: `acme-${Math.random()}`, fashionjobsUrl: `resolved:acme-${Math.random()}` },
  });

  const makeJob = async (companyId: string, sourceKey: string, externalId: string, seen: Date) =>
    p.job.create({
      data: {
        companyId, externalId, source: 'GENERIC_JSONLD', title: 'Vendeur',
        url: `https://x/${externalId}`, fingerprint: `fp-${externalId}-${Math.random()}`,
        isActive: true, lastSeenAt: seen,
        sources: { create: { sourceKey, sourceTier: 'ATS_OFFICIAL', externalId,
          url: `https://x/${externalId}`, isActive: true, lastSeenAt: seen } },
      },
      include: { sources: true },
    });

  const health = async (sourceKey: string, canAttestAbsence = true) =>
    p.sourceRun.create({ data: { sourceKey, status: 'OK', jobs: 10, canAttestAbsence, complete: true, ranAt: FRESH } });

  const runFacts = (sourceKey: string): SourceRunFacts => ({
    sourceKey, runId: 'run-parity', status: 'OK', errors: 0, truncated: false,
    complete: true, canAttestAbsence: true, ranAt: FRESH,
  });
  const proof = (sourceKey: string, observed: string[], over: Partial<EnumerationEvidence> = {}): EnumerationEvidence => ({
    sourceKey, runId: 'run-parity', termination: 'DECLARED_TOTAL_REACHED',
    canonicalSet: observed, canonicalContractDeclared: true, canonicalContractBroken: false, ...over,
  });

  /**
   * Le cœur du harnais : produire le plan comme la prévisualisation, figer le manifeste, exécuter le VRAI
   * refresh, puis comparer les deux — par identifiants et conséquence par conséquence.
   */
  const runParity = async (
    reps: Representation[], evidence: EnumerationEvidence, allowKeys: string[],
    activeByJob: Map<string, string[]>,
  ) => {
    const verdict = sourceEligibility(runFacts(evidence.sourceKey), evidence);
    const observed = verdict.eligible ? new Set(evidence.canonicalSet) : null;
    const states = new Map<string, RepresentationState>();
    for (const rep of reps) states.set(rep.jobSourceId, representationState(rep, observed, verdict.eligible));
    const { deactivations, jobs } = planRefresh(reps, states, activeByJob);

    const entries: ManifestEntry[] = deactivations.map((d) => ({
      jobSourceId: d.jobSourceId, sourceKey: d.sourceKey, externalId: d.externalId, jobId: d.jobId,
      state: d.state, consequence: jobs.get(d.jobId)!,
    }));
    const manifest = freezeManifest(allowKeys, entries);

    const before = await p.jobSource.findMany({ where: { isActive: true }, select: { id: true } });
    const valid = verifyManifest(manifest, new Set(before.map((b) => b.id)));

    await runRefresh(p, { onlyKeys: allowKeys, manifestJobSourceIds: manifest.entries.map((e) => e.jobSourceId) });

    const after = await p.jobSource.findMany({ where: { isActive: false }, select: { id: true } });
    return { verdict, states, manifest, valid, parity: compareTouched(manifest, after.map((a) => a.id)), jobs };
  };

  // ── 1. une JobSource absente et fermable ───────────────────────────────────────────────────────────────
  await wipe();
  {
    const c = await company();
    const j = await makeJob(c.id, 'vague', 'partie', STALE);
    await health('vague');
    const rep: Representation = { sourceKey: 'vague', externalId: 'partie', jobId: j.id,
      jobSourceId: j.sources[0]!.id, lastSeenAt: STALE, held: false, writeFailed: false };
    const r = await runParity([rep], proof('vague', ['encore-la']), ['vague'],
      new Map([[j.id, [j.sources[0]!.id]]]));
    const job = await p.job.findUniqueOrThrow({ where: { id: j.id } });
    check('1. absente et fermable → désactivée ET fermée, parité exacte',
      r.states.get(rep.jobSourceId) === 'ABSENT_FROM_PROVEN_ENUMERATION' && r.parity.equal
      && !job.isActive && job.closedAt !== null,
      { state: r.states.get(rep.jobSourceId), parity: r.parity, isActive: job.isActive, closedAt: !!job.closedAt });
  }

  // ── 2. une autre source active HORS allowlist maintient l'offre ouverte ────────────────────────────────
  await wipe();
  {
    const c = await company();
    const j = await makeJob(c.id, 'vague', 'partagee', STALE);
    const other = await p.jobSource.create({ data: { jobId: j.id, sourceKey: 'hors-vague',
      sourceTier: 'ATS_OFFICIAL', externalId: 'partagee-2', url: 'https://x/p2', isActive: true, lastSeenAt: STALE } });
    await health('vague');
    const rep: Representation = { sourceKey: 'vague', externalId: 'partagee', jobId: j.id,
      jobSourceId: j.sources[0]!.id, lastSeenAt: STALE, held: false, writeFailed: false };
    const r = await runParity([rep], proof('vague', []), ['vague'],
      new Map([[j.id, [j.sources[0]!.id, other.id]]]));
    const job = await p.job.findUniqueOrThrow({ where: { id: j.id } });
    check('2. autre source hors allowlist → offre CONSERVÉE, conséquence conforme',
      r.jobs.get(j.id) === 'JOB_KEPT_BY_ANOTHER_SOURCE' && job.isActive && r.parity.equal,
      { consequence: r.jobs.get(j.id), isActive: job.isActive, parity: r.parity });
  }

  // ── 3, 4, 5. vue mais non persistée : aucune mutation ──────────────────────────────────────────────────
  for (const [label, flags] of [
    ['3. PRESENT_BUT_REJECTED', { rejected: true }],
    ['4. PRESENT_BUT_HELD', { held: true }],
    ['5. PRESENT_BUT_WRITE_FAILED', { writeFailed: true }],
  ] as const) {
    await wipe();
    const c = await company();
    const j = await makeJob(c.id, 'vague', 'vue', STALE);
    await health('vague');
    const rep: Representation = { sourceKey: 'vague', externalId: 'vue', jobId: j.id,
      jobSourceId: j.sources[0]!.id, lastSeenAt: STALE, held: false, writeFailed: false, ...flags };
    const r = await runParity([rep], proof('vague', ['vue']), ['vague'],
      new Map([[j.id, [j.sources[0]!.id]]]));
    const job = await p.job.findUniqueOrThrow({ where: { id: j.id } });
    check(`${label} → aucune désactivation, offre intacte`,
      r.manifest.entries.length === 0 && job.isActive && r.parity.equal,
      { state: r.states.get(rep.jobSourceId), entries: r.manifest.entries.length, isActive: job.isActive });
  }

  // ── 6. une source UNVERIFIABLE ─────────────────────────────────────────────────────────────────────────
  await wipe();
  {
    const c = await company();
    const j = await makeJob(c.id, 'vague', 'inconnue', STALE);
    await health('vague');
    const rep: Representation = { sourceKey: 'vague', externalId: 'inconnue', jobId: j.id,
      jobSourceId: j.sources[0]!.id, lastSeenAt: STALE, held: false, writeFailed: false };
    const r = await runParity([rep], proof('vague', [], { canonicalContractDeclared: false }), ['vague'],
      new Map([[j.id, [j.sources[0]!.id]]]));
    const job = await p.job.findUniqueOrThrow({ where: { id: j.id } });
    check('6. source UNVERIFIABLE → aucune mutation',
      r.states.get(rep.jobSourceId) === 'UNVERIFIABLE' && r.manifest.entries.length === 0 && job.isActive,
      { state: r.states.get(rep.jobSourceId), isActive: job.isActive });
  }

  // ── 7. un board vide PROUVÉ ferme bien ses offres ──────────────────────────────────────────────────────
  await wipe();
  {
    const c = await company();
    const j = await makeJob(c.id, 'vague', 'derniere', STALE);
    await health('vague');
    const rep: Representation = { sourceKey: 'vague', externalId: 'derniere', jobId: j.id,
      jobSourceId: j.sources[0]!.id, lastSeenAt: STALE, held: false, writeFailed: false };
    const r = await runParity([rep], proof('vague', [], { termination: 'FULL_XML_DOCUMENT' }), ['vague'],
      new Map([[j.id, [j.sources[0]!.id]]]));
    const job = await p.job.findUniqueOrThrow({ where: { id: j.id } });
    check('7. board vide PROUVÉ → offre fermée (et non invérifiable)',
      r.states.get(rep.jobSourceId) === 'ABSENT_FROM_PROVEN_ENUMERATION' && !job.isActive && r.parity.equal,
      { state: r.states.get(rep.jobSourceId), isActive: job.isActive });
  }

  // ── 8. une source avec une ligne ANONYME ───────────────────────────────────────────────────────────────
  await wipe();
  {
    const c = await company();
    const j = await makeJob(c.id, 'vague', 'peut-etre-anonyme', STALE);
    await health('vague');
    const rep: Representation = { sourceKey: 'vague', externalId: 'peut-etre-anonyme', jobId: j.id,
      jobSourceId: j.sources[0]!.id, lastSeenAt: STALE, held: false, writeFailed: false };
    const r = await runParity([rep], proof('vague', ['autre'], { canonicalAbsenceProofUsable: false }), ['vague'],
      new Map([[j.id, [j.sources[0]!.id]]]));
    const job = await p.job.findUniqueOrThrow({ where: { id: j.id } });
    check('8. ligne anonyme → source non recevable, aucune fermeture',
      !r.verdict.eligible && r.manifest.entries.length === 0 && job.isActive,
      { reasons: r.verdict.reasons, isActive: job.isActive });
  }

  // ── 9. l'état a changé APRÈS génération du manifeste ───────────────────────────────────────────────────
  await wipe();
  {
    const c = await company();
    const j = await makeJob(c.id, 'vague', 'deja-traitee', STALE);
    await health('vague');
    const entries: ManifestEntry[] = [{ jobSourceId: j.sources[0]!.id, sourceKey: 'vague',
      externalId: 'deja-traitee', jobId: j.id, state: 'ABSENT_FROM_PROVEN_ENUMERATION',
      consequence: 'JOB_CANDIDATE_FOR_CLOSURE' }];
    const manifest = freezeManifest(['vague'], entries);
    // Une autre opération traite la ligne entre la revue et la mutation.
    await p.jobSource.update({ where: { id: j.sources[0]!.id }, data: { isActive: false } });
    const stillActive = await p.jobSource.findMany({ where: { isActive: true }, select: { id: true } });
    const verdict = verifyManifest(manifest, new Set(stillActive.map((s) => s.id)));
    check('9. état modifié après le manifeste → REFUS avant toute mutation',
      !verdict.valid && verdict.problems.some((x) => /déjà inactive/.test(x)), verdict.problems);
  }

  // ── 10. une ligne extérieure au manifeste n'est jamais touchée ─────────────────────────────────────────
  await wipe();
  {
    const c = await company();
    const inside = await makeJob(c.id, 'vague', 'dans-manifeste', STALE);
    const outside = await makeJob(c.id, 'vague', 'hors-manifeste', STALE);
    await health('vague');
    const manifest = freezeManifest(['vague'], [{ jobSourceId: inside.sources[0]!.id, sourceKey: 'vague',
      externalId: 'dans-manifeste', jobId: inside.id, state: 'ABSENT_FROM_PROVEN_ENUMERATION',
      consequence: 'JOB_CANDIDATE_FOR_CLOSURE' }]);
    await runRefresh(p, { onlyKeys: ['vague'], manifestJobSourceIds: manifest.entries.map((e) => e.jobSourceId) });
    const touched = await p.jobSource.findMany({ where: { isActive: false }, select: { id: true } });
    const parity = compareTouched(manifest, touched.map((t) => t.id));
    const out = await p.job.findUniqueOrThrow({ where: { id: outside.id } });
    check('10. ligne hors manifeste → jamais touchée, parité exacte',
      parity.equal && out.isActive, { parity, outsideActive: out.isActive });
  }

  await wipe();
  const passed = results.filter((r) => r.passed).length;
  const out = arg('out');
  if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), database: db, results }, null, 2));
  console.log(`\n${passed}/${results.length} scénarios de parité vérifiés`);
  if (passed !== results.length) process.exitCode = 1;
} finally {
  await p.$disconnect();
}
