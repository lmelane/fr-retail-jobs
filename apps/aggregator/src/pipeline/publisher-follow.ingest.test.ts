import '../test/setup-integration.js';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ingestSyntheticFeed, qualifiedSource, releaseQualifiedSources, resolvedCompany } from '../test/ingestionFixture.js';
import { checkSourceHealth } from './health.js';
import { log } from '../observability/logger.js';
import { resolveCompany } from '../normalize/company.js';
import type { NormalizedJob } from '../types.js';

/**
 * D-506 §3 PAR L'INGESTION DE PRODUCTION : « une offre qui change d'employeur chez l'éditeur suit l'éditeur sans revue
 * si la même source publie déjà sous ce nouvel employeur ; la revue humaine reste obligatoire pour un employeur jamais
 * vu dans la source ; au-delà de max(5, 5 %) des offres d'une source dans un même RUN, la revue humaine revient ».
 *
 * Seul l'amont HTTP est synthétique (`ingestionFixture.ts`) : registre, portes, capture scellée, rejeu de validation,
 * écriture, rapport de fin d'ingestion et bilan de santé tournent tels quels. Le flux Ashby ne nomme pas d'employeur ;
 * ce fichier lui fait lire `employerName` comme un libellé natif, dans la lecture ET dans son rejeu, pour exercer le
 * chemin d'un éditeur qui nomme l'employeur de chaque offre (Workday `hiringOrganization`, `logoImage.alt`).
 */
vi.mock('../ats/adapters/ashby.js', async importOriginal => {
  const original = await importOriginal<typeof import('../ats/adapters/ashby.js')>();
  const named = (job: NormalizedJob): NormalizedJob => {
    const label = (job.raw as { employerName?: unknown } | undefined)?.employerName;
    return typeof label === 'string' ? { ...job, company: label, employerEvidence: { rawName: label, path: 'synthetic.employerName', rule: 'SYNTHETIC_NATIVE_LABEL' } } : job;
  };
  return {
    ...original,
    fetchAshbyJobs: async (config: Record<string, unknown>) => {
      const result = await original.fetchAshbyJobs(config);
      return { ...result, jobs: result.jobs.map(named) };
    },
    parseAshbyJob: (...args: Parameters<typeof original.parseAshbyJob>) => {
      const job = original.parseAshbyJob(...args);
      return job && named(job);
    },
  };
});

const db = new PrismaClient();
afterAll(async () => { await releaseQualifiedSources(db); await db.$disconnect(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Without `employer`, the posting names no employer: the certified portal owner takes it (`SOURCE_CATALOGUE_LABEL`). */
type Posting = { id: string; employer?: string };
const feed = (postings: Posting[]) => JSON.stringify({ apiVersion: '1', jobs: postings.map(({ id, employer }) => ({
  id, title: `Conseiller de vente ${id}`, isListed: true, descriptionPlain: 'Native responsibilities',
  ...(employer === undefined ? {} : { employerName: employer }) })) });
const ingest = (key: string, postings: Posting[]) => ingestSyntheticFeed(db, key, feed(postings));
const employerOf = async (key: string, externalId: string) => (await db.jobSource.findUniqueOrThrow({
  where: { sourceKey_externalId: { sourceKey: key, externalId } }, select: { job: { select: { id: true, companyId: true, company: { select: { name: true } } } } } })).job!;
/** The payloads one logger method received for one event, in emission order. */
const emitted = (spy: { mock: { calls: unknown[][] } }, event: string) =>
  spy.mock.calls.filter(call => call[0] === event).map(call => call[1] as Record<string, unknown>);
const followedEvents = (spy: { mock: { calls: unknown[][] } }) => emitted(spy, 'employer.followed_publisher');

const NORD = 'Atelier Nord SAS', SUD = 'Atelier Sud SAS';

describe('D-506 §3 — une offre suit l’éditeur vers un employeur déjà publié par sa source', () => {
  it('passe sans revue vers un employeur que la source publie déjà, trace l’événement et garde l’historique', async () => {
    const key = `suivi-editeur-${randomUUID()}`;
    await ingest(key, [{ id: 'p1', employer: NORD }, { id: 'p2', employer: SUD }]);
    const before = await employerOf(key, 'p1');
    // PRÉMISSE : p1 est sous Atelier Nord, et la source publie déjà Atelier Sud (p2), sous une autre société.
    expect(before.company.name).toBe(NORD);
    const sud = (await employerOf(key, 'p2')).companyId;
    expect(sud).not.toBe(before.companyId);

    const events = vi.spyOn(log, 'info');
    const stats = await ingest(key, [{ id: 'p1', employer: SUD }, { id: 'p2', employer: SUD }]);
    expect(stats).toMatchObject({ errors: 0, updated: 2, fetched: 2 });
    expect(stats.writeFailures).toBeUndefined();
    const after = await employerOf(key, 'p1');
    expect(after).toMatchObject({ id: before.id, companyId: sud });
    expect(followedEvents(events)).toEqual([expect.objectContaining({ sourceKey: key, jobId: 'p1', catwalksJobId: before.id,
      fromCompanyId: before.companyId, fromName: NORD, toCompanyId: sud, toName: SUD, previousLabel: NORD.toLowerCase(),
      rawEmployerName: SUD, jobCompanyChanged: true, decision: 'D-506 §3' })]);
    // L'historique de l'employeur précédent est conservé.
    expect((await db.employerObservation.findMany({ where: { sourceKey: key, externalId: 'p1' }, orderBy: { observedAt: 'asc' } }))
      .map(o => [o.rawEmployerName, o.rule, o.canonicalEmployerId])).toEqual([[NORD, 'NATIVE_SOURCE_LABEL', before.companyId], [SUD, 'PUBLISHER_FOLLOWED', sud]]);
    expect(await db.jobEvent.findMany({ where: { jobId: before.id, type: 'CHANGED' }, select: { field: true, before: true, after: true } }))
      .toEqual([{ field: 'companyId', before: before.companyId, after: sud }]);
    // L'ancienne société n'est ni fusionnée ni modifiée ; le RUN n'a rien à instruire.
    expect(await db.company.findUniqueOrThrow({ where: { id: before.companyId } })).toMatchObject({ name: NORD, mergedIntoId: null });
    const health = await checkSourceHealth(db, [stats]);
    expect(health.incidents).toEqual([]);
  });

  it('garde la revue humaine pour un employeur jamais vu dans la source', async () => {
    const key = `suivi-editeur-jamais-vu-${randomUUID()}`;
    await ingest(key, [{ id: 'p1', employer: NORD }, { id: 'p2', employer: SUD }]);
    const before = await employerOf(key, 'p1');
    // Atelier Est existe au référentiel sous sa clé globale — celle que le résolveur propose pour ce libellé — et une
    // AUTRE source le publie : pour celle-ci, c'est pourtant un employeur jamais vu.
    const EST = `Atelier Est ${randomUUID().slice(0, 8)} SAS`;
    const { companyId: estKey } = resolveCompany(EST);
    const est = await db.company.create({ data: { name: EST, canonicalKey: estKey, fashionjobsUrl: `resolved:${estKey}` } });
    const other = `suivi-editeur-autre-${randomUUID()}`;
    await ingest(other, [{ id: 'e1', employer: EST }]);
    expect((await employerOf(other, 'e1')).companyId).toBe(est.id);
    const events = vi.spyOn(log, 'info');
    const stats = await ingest(key, [{ id: 'p1', employer: EST }, { id: 'p2', employer: SUD }]);
    expect(stats).toMatchObject({ errors: 1, updated: 1, writeFailures: { 'EmployerIdentityReviewRequired:EMPLOYER_SPELLING_DIVERGED': 1 } });
    expect((await employerOf(key, 'p1')).companyId).toBe(before.companyId);
    expect(followedEvents(events)).toEqual([]);
    const health = await checkSourceHealth(db, [stats]);
    expect(health.incidents).toMatchObject([{ source: key, note: expect.stringContaining('nouvelle graphie de l’employeur : 1') }]);
  });

  it('au-delà de max(5, 5 %) des offres de la source, aucune ne suit : toutes passent en revue', async () => {
    const key = `suivi-editeur-masse-${randomUUID()}`;
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    // 7 offres collectées : la borne est max(5, 0,35) = 5.
    await ingest(key, [...ids.map(id => ({ id, employer: NORD })), { id: 'q', employer: SUD }]);
    const before = await employerOf(key, 'p1');
    const sud = (await employerOf(key, 'q')).companyId;
    const events = vi.spyOn(log, 'info'), warnings = vi.spyOn(log, 'warn');
    const stats = await ingest(key, [...ids.map(id => ({ id, employer: SUD })), { id: 'q', employer: SUD }]);
    expect(stats).toMatchObject({ fetched: 7, errors: 6, updated: 1, writeFailures: { 'EmployerIdentityReviewRequired:EMPLOYER_CHANGE_MASS': 6 } });
    for (const id of ids) expect((await employerOf(key, id)).companyId).toBe(before.companyId);
    expect(followedEvents(events)).toEqual([]);
    expect(emitted(warnings, 'employer.follow_mass_guarded'))
      .toEqual([expect.objectContaining({ sourceKey: key, postings: 6, collected: 7, bound: 5, decision: 'D-506 §3' })]);
    const completion = await db.sourceIngestionCompletion.findUniqueOrThrow({ where: { batchId: stats.captureBatchId! } });
    expect(completion).toMatchObject({ writeFailed: 6, published: 1 });
    const health = await checkSourceHealth(db, [stats]);
    expect(health.incidents).toMatchObject([{ source: key, note: expect.stringContaining('changements d’employeur en masse chez l’éditeur, revue humaine (garde D-506 §3) : 6') }]);
    expect(sud).not.toBe(before.companyId);
  });

  it('à la borne exacte, les cinq offres suivent l’éditeur (prémisse de la garde : chacune remplit la règle)', async () => {
    const key = `suivi-editeur-borne-${randomUUID()}`;
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
    await ingest(key, [...ids.map(id => ({ id, employer: NORD })), { id: 'q', employer: SUD }, { id: 'r', employer: NORD }]);
    const sud = (await employerOf(key, 'q')).companyId;
    const events = vi.spyOn(log, 'info');
    const stats = await ingest(key, [...ids.map(id => ({ id, employer: SUD })), { id: 'q', employer: SUD }, { id: 'r', employer: NORD }]);
    expect(stats).toMatchObject({ fetched: 7, errors: 0, updated: 7 });
    for (const id of ids) expect((await employerOf(key, id)).companyId).toBe(sud);
    expect(followedEvents(events).map(e => e.jobId).sort()).toEqual(ids);
    expect((await employerOf(key, 'r')).company.name).toBe(NORD);
  });

  it('garde la revue quand l’éditeur ne nommait pas l’employeur auparavant (attribution du portail certifié)', async () => {
    // Le cas des 351 refus de masse des 7 derniers jours (b-s-international, funky-buddha) : le précédent vient du
    // registre, pas de l'éditeur ; D-479 et la relation native marque/employeur en décident, pas ce suivi.
    const key = `suivi-editeur-portail-${randomUUID()}`;
    await qualifiedSource(db, key);
    await db.source.update({ where: { key }, data: { portalScope: 'SINGLE_BRAND' } });
    const owner = await resolvedCompany(db, key);
    await ingest(key, [{ id: 'p1' }, { id: 'q', employer: SUD }]);
    // PRÉMISSE : p1 est sous le propriétaire du portail, par le registre ; la source publie déjà Atelier Sud.
    expect((await employerOf(key, 'p1')).companyId).toBe(owner.id);
    expect(await db.employerObservation.findFirst({ where: { sourceKey: key, externalId: 'p1' } })).toMatchObject({ labelOrigin: 'SOURCE_CATALOGUE_LABEL' });
    expect((await employerOf(key, 'q')).company.name).toBe(SUD);
    const stats = await ingest(key, [{ id: 'p1', employer: SUD }, { id: 'q', employer: SUD }]);
    expect(stats).toMatchObject({ errors: 1, writeFailures: { 'EmployerIdentityReviewRequired:EMPLOYER_SPELLING_DIVERGED': 1 } });
    expect((await employerOf(key, 'p1')).companyId).toBe(owner.id);
  });

  it('un employeur apparu dans la même collecte reste « jamais vu », quel que soit l’ordre des offres', async () => {
    // Audit adverse du 01/10 : une offre NEUVE sous B, placée avant dans la liste de l'éditeur, ne prouve pas que la
    // source publiait déjà B. Sans la borne de la collecte, p1 la prendrait pour témoin et suivrait.
    const key = `suivi-editeur-meme-collecte-${randomUUID()}`;
    await ingest(key, [{ id: 'p1', employer: NORD }]);
    const before = await employerOf(key, 'p1');
    const stats = await ingest(key, [{ id: 'n', employer: SUD }, { id: 'p1', employer: SUD }]);
    expect(stats).toMatchObject({ created: 1, errors: 1, writeFailures: { 'EmployerIdentityReviewRequired:EMPLOYER_SPELLING_DIVERGED': 1 } });
    // PRÉMISSE : l'offre neuve est bien publiée sous Atelier Sud, et avant p1 dans la collecte.
    expect((await employerOf(key, 'n')).company.name).toBe(SUD);
    expect((await employerOf(key, 'p1')).companyId).toBe(before.companyId);
    // Au RUN suivant, n témoigne d'une publication antérieure : p1 suit.
    const next = await ingest(key, [{ id: 'n', employer: SUD }, { id: 'p1', employer: SUD }]);
    expect(next).toMatchObject({ errors: 0 });
    expect((await employerOf(key, 'p1')).companyId).toBe((await employerOf(key, 'n')).companyId);
  });

  it('la garde compte aussi les changements vers un employeur jamais vu : 3 suivables + 3 revus > 5, aucune ne suit', async () => {
    const key = `suivi-editeur-masse-mixte-${randomUUID()}`;
    const EST = `Atelier Est ${randomUUID().slice(0, 8)} SAS`;
    const followable = ['p1', 'p2', 'p3'], unseen = ['r1', 'r2', 'r3'];
    // 7 offres collectées : la borne est max(5, 0,35) = 5.
    await ingest(key, [...followable, ...unseen].map(id => ({ id, employer: NORD })).concat({ id: 'q', employer: SUD }));
    const nord = (await employerOf(key, 'p1')).companyId;
    const warnings = vi.spyOn(log, 'warn');
    const stats = await ingest(key, [...followable.map(id => ({ id, employer: SUD })), ...unseen.map(id => ({ id, employer: EST })), { id: 'q', employer: SUD }]);
    expect(stats).toMatchObject({ fetched: 7, errors: 6, updated: 1, writeFailures: {
      'EmployerIdentityReviewRequired:EMPLOYER_CHANGE_MASS': 3, 'EmployerIdentityReviewRequired:EMPLOYER_SPELLING_DIVERGED': 3 } });
    for (const id of followable) expect((await employerOf(key, id)).companyId).toBe(nord);
    expect(emitted(warnings, 'employer.follow_mass_guarded')).toEqual([expect.objectContaining({ postings: 3, employerChanges: 6, bound: 5 })]);
  });

  it('un témoin que l’éditeur renomme dans la même collecte ne prouve plus rien, quel que soit l’ordre', async () => {
    // L'audit du 01/10 a mesuré ce cas sur tapestry : des offres sous « Tapestry, Inc. » avant le RUN, renommées pendant.
    const key = `suivi-editeur-temoin-renomme-${randomUUID()}`;
    const EST = `Atelier Est ${randomUUID().slice(0, 8)} SAS`;
    await ingest(key, [{ id: 'p1', employer: NORD }, { id: 'q', employer: SUD }]);
    const nord = (await employerOf(key, 'p1')).companyId;
    // q, seul témoin d'Atelier Sud avant la collecte, passe à un autre employeur APRÈS p1 dans la liste de l'éditeur.
    const stats = await ingest(key, [{ id: 'p1', employer: SUD }, { id: 'q', employer: EST }]);
    expect(stats).toMatchObject({ errors: 2, writeFailures: { 'EmployerIdentityReviewRequired:EMPLOYER_SPELLING_DIVERGED': 2 } });
    expect((await employerOf(key, 'p1')).companyId).toBe(nord);
  });
});
