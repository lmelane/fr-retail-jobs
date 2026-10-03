import '../test/setup-integration.js';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ingestSyntheticFeed, qualifiedSource, releaseQualifiedSources, resolvedCompany, type SyntheticPosting } from '../test/ingestionFixture.js';
import { evaluateSourceHealth } from './health.js';
import { classifySourceRun } from './ingestOrchestrator.js';
import { computeSourceState } from './sourceState.js';
import { DETAIL_CONTENT_MISSING } from './publicationDisposition.js';
import { unqualifiedAllowanceFor } from '../connectors/sourceCertification.js';
import type { IngestStats } from './ingest.js';

/**
 * D-523 §3 (03/10/2026, audit du lot d'exceptions) : « une offre qui ne peut pas être servie est retenue ; sa source ne
 * change pas ». Avant, la validation native refusait la SOURCE entière au-delà de quelques fiches vides (cotton-on 9 pour
 * une tolérance de 4, fastrack 6 pour 2), à chaque RUN, y compris pour une source ACTIVE ; en deçà, elle publiait ces
 * fiches sans contenu. Témoins par la vraie ingestion (seul le réseau amont est synthétique).
 */
const db = new PrismaClient();
const keys: string[] = [];
afterAll(async () => { await releaseQualifiedSources(db); await db.$disconnect(); });

async function activeSource(prefix: string) {
  const key = `${prefix}-${randomUUID().slice(0, 8)}`; keys.push(key);
  await qualifiedSource(db, key);
  await db.source.update({ where: { key }, data: { portalScope: 'SINGLE_BRAND' } });
  await resolvedCompany(db, key);
  return key;
}
const feed = (readable: number, empty: number): SyntheticPosting[] => [
  ...Array.from({ length: readable }, (_, i) => ({ id: `lisible-${i}` })),
  ...Array.from({ length: empty }, (_, i) => ({ id: `vide-${i}`, description: '' })),
];
const servedIds = async (key: string) => (await db.jobSource.findMany({ where: { sourceKey: key, isActive: true }, select: { externalId: true } }))
  .map(row => row.externalId).sort();
const stateOf = (stat: IngestStats, health: ReturnType<typeof evaluateSourceHealth>) => {
  const { issues } = classifySourceRun([stat], [health].filter(h => h.status !== 'OK' && h.status !== 'NEW'));
  return computeSourceState({ source: { key: stat.source, status: 'ACTIVE', note: null }, previous: null, now: new Date(),
    outcome: { kind: 'RUN', at: new Date(), runId: null, runStatus: health.status, jobs: health.jobs, note: health.note, issues } });
};

describe('D-523 §3 — la fiche sans contenu est retenue, la source n’est pas refusée', () => {
  it('source ACTIVE avec quelques fiches vides : les lisibles sont publiées, les vides retenues avec leur cause, la source reste normale', async () => {
    const key = await activeSource('quelques-vides');
    const stat = await ingestSyntheticFeed(db, key, feed(8, 2));
    // Prémisse : deux fiches au texte vide, dans la tolérance d'un lot de 10.
    expect(unqualifiedAllowanceFor(10)).toBe(2);
    expect(stat).toMatchObject({ created: 8, held: 2, heldReasons: { [DETAIL_CONTENT_MISSING]: 2 }, errors: 0 });
    expect(await servedIds(key)).toEqual(Array.from({ length: 8 }, (_, i) => `lisible-${i}`).sort());
    const health = evaluateSourceHealth(stat, null);
    expect(stateOf(stat, health)).toMatchObject({ state: 'NORMALE' });
  });

  it('au-delà de la tolérance (cotton-on) : la source n’est plus refusée, les lisibles sont publiées, les vides sont à instruire', async () => {
    const key = await activeSource('cotton-on-like');
    const stat = await ingestSyntheticFeed(db, key, feed(6, 4));
    // Prémisse : 4 fiches vides sur 10 dépassent la tolérance, ce qui refusait la validation de la source entière.
    expect(4).toBeGreaterThan(unqualifiedAllowanceFor(10));
    expect(stat).toMatchObject({ created: 6, held: 4, heldReasons: { [DETAIL_CONTENT_MISSING]: 4 } });
    expect(await servedIds(key)).toHaveLength(6);
    const health = evaluateSourceHealth(stat, null);
    expect(health).toMatchObject({ finding: 'RETENTION_TO_INSTRUCT' });
    expect(stateOf(stat, health)).toMatchObject({ cause: 'RETENUE_A_INSTRUIRE' });
    expect((await db.source.findUniqueOrThrow({ where: { key } })).status).toBe('ACTIVE');
  });

  it('chute brutale de lisibilité (9 fiches vides sur 10, toutes lisibles au RUN de référence) : classée « lecteur », sans refus', async () => {
    const key = await activeSource('chute-lisibilite');
    const stat = await ingestSyntheticFeed(db, key, feed(1, 9));
    expect(stat).toMatchObject({ created: 1, held: 9 });
    const health = evaluateSourceHealth(stat, 10, { fetched: 10, accepted: 10 });
    expect(health).toMatchObject({ status: 'DEGRADED', finding: 'DETAIL_READABILITY_COLLAPSE' });
    expect(stateOf(stat, health)).toMatchObject({ cause: 'LECTEUR', trajectory: 'A_REPARER' });
    // Toutes vides, sans référence : rien de publiable, même soupçon de lecture.
    const allEmpty = await ingestSyntheticFeed(db, await activeSource('toutes-vides'), feed(0, 3));
    expect(evaluateSourceHealth(allEmpty, null)).toMatchObject({ status: 'BROKEN', finding: 'DETAIL_READABILITY_COLLAPSE' });
  });
});
