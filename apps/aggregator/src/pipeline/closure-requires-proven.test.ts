import '../test/setup-integration.js';
import { attestSyntheticFeed, ingestSyntheticFeed, releaseQualifiedSources } from '../test/ingestionFixture.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { runRefresh, readRefreshPlan } from './refresh.js';
import { attestationFacts } from './attestingCapture.js';
import { enumerationVerdict, verdictToComplete } from './enumeration.js';

/**
 * LES QUATRE CAS BORNÉS DE LA RÈGLE « SEUL UN PARCOURS DÉMONTRÉ FERME » (2026-09-11).
 *
 * Depuis le lot 5G3C, le droit d'attester est dérivé des faits SCELLÉS d'une capture admise : le manifeste
 * d'extraction (complétude, total déclaré, troncature) et le rapport de fin d'ingestion (publiées, retenues,
 * échecs). `attestationFacts` est la dérivation pure ; les trois refus se vérifient sur elle avec les faits
 * exacts des cas mesurés. Le cas positif s'exécute sur le CHEMIN RÉEL : ingestion de production d'un flux natif
 * synthétique, puis `runRefresh` — la fonction de clôture elle-même — décide.
 *
 *   1. UNKNOWN, MÊME volume que la collecte précédente mais ensemble d'identifiants DIFFÉRENT → aucun droit.
 *      C'est le cœur de l'objection : un volume stable ne prouve pas qu'on a parcouru le même périmètre.
 *   2. UNKNOWN à 60 % du volume précédent → aucun droit, bien que la garde d'effondrement (50 %) soit franchie.
 *      Franchir un indicateur de santé n'est pas une preuve de disparition.
 *   3. Total déclaré 100, 90 identifiants lus → aucun droit. Les 10 % non lus ne sont pas attestés.
 *   4. ATS sans total dont la pagination est réellement parcourue jusqu'à sa fin → PROVEN, fermeture autorisée.
 */

const prisma = new PrismaClient();
const STALE = new Date(Date.now() - 30 * 86_400_000);
const FRESH = new Date();

const facts = (over: Partial<Parameters<typeof attestationFacts>[0]> = {}) => attestationFacts({
  sourceKey: 'crp', captureBatchId: 'batch-1', startedAt: new Date(), metadata: { truncated: false },
  outputs: 3, counts: { published: 3, held: 0, writeFailed: 0, skipped: 0 }, unreadableRows: 0, previousPublished: 3, ...over,
});

describe('attestationFacts — les trois refus, sur les faits scellés', () => {
  it('1. UNKNOWN, même volume : un parcours non démontré ne donne aucun droit', () => {
    const run = facts({ metadata: { truncated: false } });
    expect(run).toMatchObject({ status: 'OK', complete: null, previous: 3, canAttestAbsence: false });
  });

  it('2. UNKNOWN à 60 % du volume précédent : aucun droit, même au-dessus de la garde d’effondrement', () => {
    const run = facts({ outputs: 60, counts: { published: 60, held: 0, writeFailed: 0, skipped: 0 }, previousPublished: 100 });
    expect(run).toMatchObject({ status: 'OK', previous: 100, canAttestAbsence: false });
    // Et en dessous de la garde, un effondrement inexpliqué refuse même un parcours démontré.
    expect(facts({ metadata: { complete: true }, outputs: 40, counts: { published: 40, held: 0, writeFailed: 0, skipped: 0 }, previousPublished: 100 }).canAttestAbsence).toBe(false);
  });

  it('3. total déclaré 100, 90 identifiants lus : aucun droit sans preuve de fin d’énumération', () => {
    expect(verdictToComplete(enumerationVerdict({ declaredTotal: 100, uniqueCollected: 90 }))).toBeUndefined();
    const run = facts({ metadata: { declaredTotal: 100 }, outputs: 90, counts: { published: 90, held: 0, writeFailed: 0, skipped: 0 }, previousPublished: 90 });
    expect(run.canAttestAbsence).toBe(false);
    // Sous le seuil de couverture, le parcours démontré est lui-même refusé : l'indicateur ne sert qu'à refuser.
    expect(facts({ metadata: { complete: true, declaredTotal: 100 }, outputs: 80, counts: { published: 80, held: 0, writeFailed: 0, skipped: 0 }, previousPublished: 80 }).canAttestAbsence).toBe(false);
  });

  it('une première collecte n’a pas de passé : NEW, aucun droit — sauf un zéro explicitement déclaré', () => {
    expect(facts({ metadata: { complete: true }, previousPublished: null })).toMatchObject({ status: 'NEW', canAttestAbsence: false });
    expect(facts({ metadata: { complete: true, declaredTotal: 0 }, outputs: 0, counts: { published: 0, held: 0, writeFailed: 0, skipped: 0 }, previousPublished: null }))
      .toMatchObject({ status: 'OK', canAttestAbsence: true });
  });

  it('une erreur d’écriture, une ligne illisible ou une troncature refusent ; une retenue seule ne refuse pas', () => {
    expect(facts({ metadata: { complete: true }, counts: { published: 2, held: 0, writeFailed: 1, skipped: 0 } })).toMatchObject({ status: 'DEGRADED', errors: 1, canAttestAbsence: false });
    expect(facts({ metadata: { complete: true }, unreadableRows: 1 })).toMatchObject({ errors: 1, canAttestAbsence: false });
    expect(facts({ metadata: { complete: true, truncated: true } })).toMatchObject({ truncated: true, canAttestAbsence: false });
    expect(facts({ metadata: { complete: true }, counts: { published: 2, held: 1, writeFailed: 0, skipped: 0 } })).toMatchObject({ status: 'DEGRADED', canAttestAbsence: true });
    expect(facts({ metadata: { complete: true }, counts: { published: 0, held: 3, writeFailed: 0, skipped: 0 } })).toMatchObject({ status: 'BROKEN', canAttestAbsence: false });
  });
});

/** Attache N offres à une source, vues pour la dernière fois à l'instant donné. */
async function addPostings(sourceKey: string, externalIds: string[], lastSeenAt: Date) {
  const company = await prisma.company.findFirst({ where: { name: `CRP ${sourceKey}` } })
    ?? await prisma.company.create({ data: { name: `CRP ${sourceKey}`, canonicalKey: `CRP ${sourceKey}`,
      fashionjobsUrl: `https://crp.example/${sourceKey}` } });
  const ids: string[] = [];
  for (const externalId of externalIds) {
    const key = `${sourceKey}-${externalId}`;
    const job = await prisma.job.create({ data: {
      companyId: company.id, title: `Poste ${externalId}`, url: `https://crp.example/${sourceKey}/${externalId}`,
      source: 'GENERIC_JSONLD', externalId: key, fingerprint: `crp:${key}`, pipelineVersion: 1,
      isActive: true, firstSeenAt: lastSeenAt, lastSeenAt,
      canonicalSourceKey: sourceKey, canonicalExternalId: key, canonicalTier: 'EMPLOYER_DIRECT',
    } });
    await prisma.jobSource.create({ data: {
      jobId: job.id, sourceKey, sourceTier: 'EMPLOYER_DIRECT', externalId: key,
      url: job.url, isActive: true, firstSeenAt: lastSeenAt, lastSeenAt,
    } });
    ids.push(job.id);
  }
  return ids;
}

const stateOf = (ids: string[]) => prisma.job.findMany({ where: { id: { in: ids } },
  select: { id: true, externalId: true, isActive: true, closedAt: true, withdrawnAt: true }, orderBy: { externalId: 'asc' } });

describe('seul un parcours démontré ferme une offre — chemin réel', () => {
  beforeEach(async () => {
    await prisma.jobEvent.deleteMany({});
    await prisma.jobSource.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.sourceRun.deleteMany({});
  });
  afterAll(async () => { await releaseQualifiedSources(prisma); await prisma.$disconnect(); });

  it('4. ATS sans total, parcours démontré (FULL_RESPONSE) : PROVEN et fermeture autorisée', async () => {
    const ids = await addPostings('crp-proven', ['A', 'B', 'C'], STALE);
    expect(enumerationVerdict({ uniqueCollected: 3, adapterProvesCompletion: true })).toBe('PROVEN');
    // Two productive collections of D/E/F: the second has a past and proves the board's full extent.
    await attestSyntheticFeed(prisma, 'crp-proven', ['D', 'E', 'F'].map(id => ({ id: `crp-proven-${id}` })));
    const plan = await readRefreshPlan(prisma, { onlyKeys: ['crp-proven'] });
    expect(plan.absencePlan.eligibility[0]).toMatchObject({ eligible: true, termination: 'FULL_RESPONSE' });

    await runRefresh(prisma);
    const after = await stateOf(ids);
    // Les offres n'ont pas été relistées depuis 30 jours et le parcours est démontré : elles se ferment.
    expect(after.every((j) => !j.isActive && j.closedAt && !j.withdrawnAt)).toBe(true);
    const fresh = await prisma.job.findMany({ where: { externalId: { in: ['crp-proven-D', 'crp-proven-E', 'crp-proven-F'] } } });
    expect(fresh).toHaveLength(3);
    expect(fresh.every(job => job.isActive && job.lastSeenAt >= FRESH)).toBe(true);
  });

  it('une première collecte, sans passé, ne ferme rien même avec un parcours démontré', async () => {
    // A source never ingested before in this database: its first completion has no productive past.
    const sourceKey = `crp-first-${randomUUID()}`;
    const ids = await addPostings(sourceKey, ['A', 'B'], STALE);
    expect((await ingestSyntheticFeed(prisma, sourceKey, [{ id: `${sourceKey}-D` }])).errors).toBe(0);
    const plan = await readRefreshPlan(prisma, { onlyKeys: [sourceKey] });
    expect(plan.absencePlan.eligibility[0].reasons).toEqual(expect.arrayContaining(['statut non probant : NEW', 'canAttestAbsence = false']));
    await runRefresh(prisma);
    expect((await stateOf(ids)).every((j) => j.isActive && !j.closedAt && !j.withdrawnAt)).toBe(true);
  });
});
