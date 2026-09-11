/**
 * LES SCÉNARIOS DE CYCLE DE VIE, exécutés sur clone avec le VRAI `runRefresh`.
 *
 * On ne vérifie pas qu'une règle est écrite : on la met à l'épreuve. Chaque scénario fabrique un état de départ
 * dans la base du CLONE (jamais la production), appelle `runRefresh` — la fonction de production, importée telle
 * quelle — puis relit l'état et le compare par identifiants, valeurs et événements.
 *
 * Les scénarios, dans l'ordre de la validation demandée :
 *
 *   1. AUCUNE FERMETURE ABUSIVE  un run BROKEN / tronqué / en erreur / effondré ne ferme rien, même si ses
 *                                offres sont périmées depuis longtemps.
 *   2. FERMETURE PROPAGÉE        un run fiable qui ne liste plus une offre la ferme, avec `closedAt` daté et un
 *                                événement CLOSED.
 *   3. RÉOUVERTURE PROPAGÉE      une offre fermée qui réapparaît sous la MÊME identité est réouverte, sans
 *                                doublon, et `reopenedCount` s'incrémente.
 *   4. RETRAIT ≠ FERMETURE       une offre sans attestation est RETIRÉE (`withdrawnAt`), jamais fermée : notre
 *                                incapacité à la vérifier n'est pas une décision de l'employeur.
 *   5. PAS DE DATE EMPLOYEUR     une republication après un retrait administratif n'incrémente PAS
 *                                `reopenedCount` : il n'y avait pas eu de fermeture employeur à annuler.
 *
 * Clone uniquement — la garde est le nom de la base.
 *
 * usage: lifecycle-scenarios.mts [--out=<file.json>]
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { runRefresh } from '../../src/pipeline/refresh.js';

const outFile = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const p = new PrismaClient({ log: [] });

/** Loin derrière la fenêtre de péremption : sans garde, ces offres se fermeraient toutes. */
const LONG_STALE = new Date(Date.now() - 30 * 86_400_000);
const FRESH = new Date();

type Scenario = { name: string; expectation: string; before: unknown; after: unknown; events: unknown; verdict: 'PASS' | 'FAIL' };
const scenarios: Scenario[] = [];

try {
  const [{ current_database: db }]: any[] = await p.$queryRaw`SELECT current_database()`;
  if (!/replay|clone|test/.test(db)) throw new Error(`refusing: ${db} is not a clone/replay/test database`);

  /** Un décor isolé : une société, une source, N offres attestées par elle. */
  const build = async (key: string, runStatus: string, canAttest: boolean, postings: number, lastSeenAt: Date, extra: Record<string, unknown> = {}) => {
    await p.jobSource.deleteMany({ where: { sourceKey: key } });
    await p.sourceRun.deleteMany({ where: { sourceKey: key } });
    await p.job.deleteMany({ where: { canonicalSourceKey: key } });
    // `Company.name` n'est pas une clé unique (plusieurs entités peuvent porter le même libellé) : on cherche
    // puis on crée, plutôt que d'inventer une contrainte que le schéma ne porte pas.
    const company = await p.company.findFirst({ where: { name: `P4 ${key}` } })
      ?? await p.company.create({ data: { name: `P4 ${key}`, canonicalKey: `P4 ${key}`, fashionjobsUrl: `https://p4.example/company/${key}` } });
    const ids: string[] = [];
    for (let i = 0; i < postings; i++) {
      const externalId = `${key}-${i}`;
      const job = await p.job.create({ data: {
        companyId: company.id, title: `Poste ${i}`, url: `https://p4.example/${key}/${i}`,
        source: 'GENERIC_JSONLD', externalId, isActive: true, firstSeenAt: lastSeenAt, lastSeenAt,
        canonicalSourceKey: key, canonicalExternalId: externalId, canonicalTier: 'EMPLOYER_DIRECT',
        // La clé de cluster est celle du décor : chaque poste est distinct, aucune dédup à tester ici.
        fingerprint: `p4:${key}:${i}`,
        pipelineVersion: 1, ...extra,
      } });
      await p.jobSource.create({ data: {
        jobId: job.id, sourceKey: key, sourceTier: 'EMPLOYER_DIRECT', externalId,
        url: job.url, isActive: true, firstSeenAt: lastSeenAt, lastSeenAt,
      } });
      ids.push(job.id);
    }
    await p.sourceRun.create({ data: {
      sourceKey: key, status: runStatus, jobs: postings, previousJobs: postings,
      canAttestAbsence: canAttest, ranAt: FRESH,
    } });
    return { companyId: company.id, ids };
  };

  const stateOf = async (ids: string[]) => {
    const rows = await p.job.findMany({ where: { id: { in: ids } },
      select: { id: true, externalId: true, isActive: true, closedAt: true, withdrawnAt: true, withdrawalReason: true, reopenedCount: true },
      orderBy: { externalId: 'asc' } });
    const reps = await p.jobSource.findMany({ where: { jobId: { in: ids } }, select: { id: true, externalId: true, isActive: true }, orderBy: { externalId: 'asc' } });
    return { jobs: rows, representations: reps };
  };
  const eventsOf = async (ids: string[]) => p.jobEvent.findMany({
    where: { jobId: { in: ids } }, select: { jobId: true, type: true, after: true }, orderBy: { at: 'asc' } });

  // ── 1. Aucune fermeture abusive ─────────────────────────────────────────────
  for (const [label, status] of [['BROKEN', 'BROKEN'], ['TIMEOUT', 'TIMEOUT'], ['CHALLENGED', 'CHALLENGED'], ['ERROR', 'ERROR']] as const) {
    const key = `p4-nofail-${status.toLowerCase()}`;
    const { ids } = await build(key, status, false, 3, LONG_STALE);
    const before = await stateOf(ids);
    await runRefresh(p as any);
    const after = await stateOf(ids);
    scenarios.push({
      name: `aucune fermeture abusive — run ${label}`,
      expectation: 'les 3 offres restent actives, aucun closedAt, aucun withdrawnAt',
      before, after, events: await eventsOf(ids),
      verdict: after.jobs.every((j) => j.isActive && !j.closedAt && !j.withdrawnAt) ? 'PASS' : 'FAIL',
    });
  }

  // ── 2. Fermeture correctement propagée ──────────────────────────────────────
  {
    const key = 'p4-close';
    const { ids } = await build(key, 'OK', true, 3, LONG_STALE);
    const before = await stateOf(ids);
    await runRefresh(p as any);
    const after = await stateOf(ids);
    const events = await eventsOf(ids);
    scenarios.push({
      name: 'fermeture propagée — run fiable qui ne liste plus les offres',
      expectation: 'les 3 offres fermées, closedAt daté, withdrawnAt nul, un événement CLOSED chacune',
      before, after, events,
      verdict: after.jobs.every((j) => !j.isActive && j.closedAt && !j.withdrawnAt)
        && events.filter((e) => e.type === 'CLOSED').length === 3 ? 'PASS' : 'FAIL',
    });
  }

  // ── 3. Réouverture correctement propagée ────────────────────────────────────
  {
    const key = 'p4-reopen';
    const { ids } = await build(key, 'OK', true, 2, LONG_STALE);
    await runRefresh(p as any); // ferme
    const closed = await stateOf(ids);
    // La source reliste les MÊMES identifiants : on ré-attesta la représentation existante, sans en créer.
    await p.jobSource.updateMany({ where: { sourceKey: key }, data: { isActive: true, lastSeenAt: FRESH } });
    await runRefresh(p as any); // rouvre
    const after = await stateOf(ids);
    const events = await eventsOf(ids);
    scenarios.push({
      name: 'réouverture propagée — la même identité réapparaît',
      expectation: 'offres réactivées, closedAt effacé, reopenedCount à 1, aucune représentation en double, un événement REOPENED',
      before: closed, after, events,
      verdict: closed.jobs.every((j) => !j.isActive && j.closedAt)
        && after.jobs.every((j) => j.isActive && !j.closedAt && j.reopenedCount === 1)
        && after.representations.length === 2
        && events.filter((e) => e.type === 'REOPENED').length === 2 ? 'PASS' : 'FAIL',
    });
  }

  // ── 4. Retrait administratif ≠ fermeture employeur ──────────────────────────
  {
    const key = 'p4-orphan';
    const { ids } = await build(key, 'OK', true, 2, LONG_STALE);
    // Aucune attestation vivante : la représentation est désactivée sans qu'un run fiable l'ait constaté.
    await p.jobSource.updateMany({ where: { sourceKey: key }, data: { isActive: false } });
    await runRefresh(p as any);
    const after = await stateOf(ids);
    const events = await eventsOf(ids);
    scenarios.push({
      name: 'retrait ≠ fermeture — offre sans attestation vivante',
      expectation: 'withdrawnAt daté avec ATTESTATION_MISSING, closedAt NUL : notre incapacité n\'est pas une décision employeur',
      before: null, after, events,
      verdict: after.jobs.every((j) => !j.isActive && !j.closedAt && j.withdrawnAt && j.withdrawalReason === 'ATTESTATION_MISSING')
        && events.filter((e) => e.type === 'WITHDRAWN').length === 2 ? 'PASS' : 'FAIL',
    });
  }

  // ── 5. Une republication après un RETRAIT n'est pas une réouverture ─────────
  {
    const key = 'p4-republish';
    const { ids } = await build(key, 'OK', true, 1, LONG_STALE);
    await p.jobSource.updateMany({ where: { sourceKey: key }, data: { isActive: false } });
    await runRefresh(p as any); // retire
    const withdrawn = await stateOf(ids);
    await p.jobSource.updateMany({ where: { sourceKey: key }, data: { isActive: true, lastSeenAt: FRESH } });
    await runRefresh(p as any); // republie
    const after = await stateOf(ids);
    const events = await eventsOf(ids);
    scenarios.push({
      name: 'republication après retrait — aucune date employeur inventée',
      expectation: 'offre réactivée, reopenedCount reste à 0, événement REPUBLISHED et non REOPENED',
      before: withdrawn, after, events,
      verdict: withdrawn.jobs.every((j) => !j.isActive && j.withdrawnAt && !j.closedAt)
        && after.jobs.every((j) => j.isActive && j.reopenedCount === 0)
        && events.some((e) => e.type === 'REPUBLISHED')
        && !events.some((e) => e.type === 'REOPENED') ? 'PASS' : 'FAIL',
    });
  }

  const report = { at: new Date().toISOString(), database: db,
    summary: { total: scenarios.length, passed: scenarios.filter((s) => s.verdict === 'PASS').length,
               failed: scenarios.filter((s) => s.verdict === 'FAIL').length },
    scenarios };
  if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 1));
  for (const s of scenarios) console.log(`${s.verdict === 'PASS' ? 'PASS' : 'FAIL'}  ${s.name}`);
  console.log(JSON.stringify(report.summary));
  if (report.summary.failed > 0) process.exit(1);
} finally { await p.$disconnect(); }
