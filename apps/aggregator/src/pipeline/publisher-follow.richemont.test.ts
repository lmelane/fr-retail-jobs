import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import '../test/setup-integration.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { postingEmployerLabel, toCandidate } from './ingest.js';
import { normalizedEmployerName } from '../normalize/employerName.js';
import { resolveCompany } from '../normalize/company.js';
import { EmployerIdentityReviewRequired } from '../identity/errors.js';
import { collectionEmployerLabels, PublisherFollowDeferred, type PublisherFollowMode } from '../identity/publisherFollow.js';
import type { NormalizedJob } from '../types.js';
import type { SourceTier } from '@catwalks/db/publications';

/**
 * D-506 §3 REJOUÉ SUR LES DONNÉES RÉELLES DU RUN DU 01/10/2026 (diagnostic `audits/2026-10-01/run-0110/`).
 *
 * L'offre Richemont JR132200 « Security Specialist » (Turin) était publiée sous Richemont du 20/09 au 29/09 ; le 01/10
 * à 16:40 UTC, le portail Workday de Richemont la déclare sous Cartier (`logoImage.alt`) et le RUN la refuse
 * (`EMPLOYER_SPELLING_DIVERGED`, employeur courant « Richemont »). La même capture publiait déjà 38 autres offres sous
 * Cartier, dont JR134214. Les deux sorties scellées viennent de la base de production, lues en transaction `READ ONLY`
 * (`audits/2026-10-01/d506-suivi-editeur/extraire-sortie.mts`) ; l'état antérieur est reconstruit depuis l'historique
 * d'observations relu de la même façon. Seuls changent les identifiants de lignes.
 */
type Extract = { source: string; externalId: string; captureBatchId: string; job: Record<string, unknown>;
  employerHistory: { observedAt: string; rawEmployerName: string; labelOrigin: string; rule: string;
    employer: { id: string; name: string; canonicalKey: string; parentGroup: string | null } | null }[] };
const extract = (name: string): Extract =>
  JSON.parse(readFileSync(new URL(`../test/fixtures/d506-richemont/${name}`, import.meta.url), 'utf8')) as Extract;
const refused = extract('richemont-JR132200-0110.json');
const witness = extract('richemont-JR134214-0110.json');

/** The sealed output as the ingestion reads it: JSON dates revived, as `readRawBlob` + the loop would hand them. */
function job(data: Extract, overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  const raw = data.job as NormalizedJob & { postedAt?: string; validThrough?: string };
  return { ...raw, postedAt: raw.postedAt ? new Date(raw.postedAt) : undefined,
    validThrough: raw.validThrough ? new Date(raw.validThrough) : undefined, ...overrides } as NormalizedJob;
}
// The registry row of `richemont` in production (01/10/2026): Workday, ATS_OFFICIAL, « Richemont (toutes Maisons) ».
const richemont = { key: 'richemont', company: 'Richemont', tier: 'ATS_OFFICIAL' as SourceTier };
const candidate = (posting: NormalizedJob, source = richemont) =>
  toCandidate(posting, source, posting.company || source.company, 'WORKDAY');

/** The collection index the ingestion builds: each posting under the native label the publisher gives it today. */
const collection = (...postings: NormalizedJob[]) => collectionEmployerLabels(postings.map(posting =>
  ({ externalId: posting.externalId, label: normalizedEmployerName(postingEmployerLabel(posting, posting.company ?? richemont.company)) })));
/** As the ingestion passes it, the collection starting now: by default the capture of 01/10 (JR134214 and JR132200 under Cartier). */
const follow = (mode: PublisherFollowMode, publishedUnder = collection(job(witness), job(refused))) =>
  ({ publisherFollow: { mode, witnessesBefore: new Date(), publishedUnder } });

const p = new PrismaClient();
async function clear() {
  await p.companyAlias.deleteMany(); await p.jobEvent.deleteMany(); await p.jobSource.deleteMany(); await p.job.deleteMany();
  await p.company.updateMany({ data: { mergedIntoId: null, parentGroupId: null } });
  await p.company.deleteMany(); await p.$executeRaw`TRUNCATE "EmployerObservation", "EmployerIdentityReview" CASCADE`;
}
beforeEach(clear);
afterAll(async () => { await clear(); await p.$disconnect(); });

/** Production companies, as the history names them (global keys, Richemont group). */
async function companies() {
  const named = (employer: NonNullable<Extract['employerHistory'][number]['employer']>) => p.company.create({ data: {
    name: employer.name, canonicalKey: employer.canonicalKey, fashionjobsUrl: `resolved:${employer.canonicalKey}`, parentGroup: employer.parentGroup } });
  const before = refused.employerHistory.filter(h => h.employer).at(-1)!.employer!;
  const after = witness.employerHistory.filter(h => h.employer).at(-1)!.employer!;
  return { richemontCo: await named(before), cartier: await named(after) };
}

/** The state of 01/10 16:40 UTC: Cartier already published by the source (JR134214), JR132200 still under Richemont. */
async function stateBeforeTheRun() {
  const { richemontCo, cartier } = await companies();
  const published = await upsertDeduplicated(p, candidate(job(witness)));
  const previousLabel = refused.employerHistory.filter(h => h.employer).at(-1)!.rawEmployerName;
  const before = await upsertDeduplicated(p, candidate(job(refused, { company: previousLabel,
    employerEvidence: { ...(refused.job.employerEvidence as NonNullable<NormalizedJob['employerEvidence']>), rawName: previousLabel } })));
  return { richemontCo, cartier, published, before };
}

describe('D-506 §3 sur Richemont JR132200, RUN du 01/10/2026', () => {
  it('reproduit le refus de production, puis suit l’éditeur vers Cartier sans revue, historique conservé', async () => {
    // PRÉMISSE : les données réelles portent bien le changement et le refus du 01/10, et la source publie déjà Cartier.
    expect(refused.employerHistory.at(-1)).toMatchObject({ rawEmployerName: 'Cartier', rule: 'REVIEW_REQUIRED', employer: null });
    expect(refused.employerHistory.filter(h => h.employer).at(-1)).toMatchObject({ rawEmployerName: 'Richemont', employer: { name: 'Richemont' } });
    expect(witness.captureBatchId).toBe(refused.captureBatchId);
    expect(witness.employerHistory.at(-1)).toMatchObject({ rawEmployerName: 'Cartier', employer: { canonicalKey: 'CARTIER' } });
    expect(resolveCompany('Cartier').companyId).toBe('CARTIER');
    const { richemontCo, cartier, published, before } = await stateBeforeTheRun();
    expect((await p.job.findUniqueOrThrow({ where: { id: published.jobId } })).companyId).toBe(cartier.id);
    expect((await p.job.findUniqueOrThrow({ where: { id: before.jobId } })).companyId).toBe(richemontCo.id);

    // Sans la règle (avant D-506) : exactement le refus du RUN, même motif, même employeur courant.
    const today = candidate(job(refused));
    const error = await upsertDeduplicated(p, today).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(EmployerIdentityReviewRequired);
    expect(error).toMatchObject({ motif: 'EMPLOYER_SPELLING_DIVERGED', rawEmployerName: 'Cartier', proposedName: 'Richemont' });

    // Avec la règle : l'offre suit l'éditeur.
    const followed = await upsertDeduplicated(p, today, undefined, follow('FOLLOW'));
    expect(followed.jobId).toBe(before.jobId);
    expect(followed.employerFollowed).toEqual({ fromCompanyId: richemontCo.id, fromName: 'Richemont', toCompanyId: cartier.id,
      toName: 'Cartier', previousLabel: 'richemont', rawEmployerName: 'Cartier', jobCompanyChanged: true });
    expect((await p.job.findUniqueOrThrow({ where: { id: before.jobId } })).companyId).toBe(cartier.id);
    // L'historique de l'employeur précédent est conservé : son observation, et l'événement de l'offre.
    const history = await p.employerObservation.findMany({ where: { sourceKey: 'richemont', externalId: refused.externalId }, orderBy: { observedAt: 'asc' } });
    expect(history.map(h => [h.rawEmployerName, h.rule, h.canonicalEmployerId])).toEqual([
      // Première publication sous la clé globale « Richemont » : `LEGACY_UNREVIEWED`, comme en production le 20/09.
      ['Richemont', 'LEGACY_UNREVIEWED', richemontCo.id], ['Cartier', 'REVIEW_REQUIRED', null], ['Cartier', 'PUBLISHER_FOLLOWED', cartier.id]]);
    expect(await p.jobEvent.findMany({ where: { jobId: before.jobId, type: 'CHANGED' }, select: { field: true, before: true, after: true } }))
      .toEqual([{ field: 'companyId', before: richemontCo.id, after: cartier.id }]);
    // Aucune fusion, aucun alias, aucune autre offre touchée.
    expect(await p.companyAlias.count()).toBe(0);
    expect(await p.company.findMany({ select: { id: true, mergedIntoId: true }, orderBy: { id: 'asc' } }))
      .toEqual([richemontCo, cartier].map(c => ({ id: c.id, mergedIntoId: null })).sort((a, b) => a.id.localeCompare(b.id)));
    expect((await p.job.findUniqueOrThrow({ where: { id: published.jobId } })).companyId).toBe(cartier.id);
    // Rejouée le lendemain sous le même libellé, l'offre reste sous Cartier sans nouvel événement.
    await upsertDeduplicated(p, today, undefined, follow('DEFER'));
    expect(await p.jobEvent.count({ where: { jobId: before.jobId, type: 'CHANGED' } })).toBe(1);
  });

  it('reporte sans rien écrire (DEFER), et la garde de masse renvoie à la revue (MASS_GUARDED)', async () => {
    const { richemontCo, before } = await stateBeforeTheRun();
    const today = candidate(job(refused));
    const observations = await p.employerObservation.count();
    await expect(upsertDeduplicated(p, today, undefined, follow('DEFER'))).rejects.toBeInstanceOf(PublisherFollowDeferred);
    expect(await p.employerObservation.count()).toBe(observations);
    expect((await p.job.findUniqueOrThrow({ where: { id: before.jobId } })).companyId).toBe(richemontCo.id);
    await expect(upsertDeduplicated(p, today, undefined, follow('MASS_GUARDED')))
      .rejects.toMatchObject({ name: 'EmployerIdentityReviewRequired', motif: 'EMPLOYER_CHANGE_MASS', proposedName: 'Richemont' });
    expect((await p.job.findUniqueOrThrow({ where: { id: before.jobId } })).companyId).toBe(richemontCo.id);
  });

  it('ne suit jamais l’éditeur vers une société que la source ne publie pas, même connue ailleurs', async () => {
    // Cartier est publié, mais par une AUTRE source (son propre site) : pour `richemont`, c'est un employeur jamais vu.
    const { richemontCo, cartier } = await companies();
    const elsewhere = await upsertDeduplicated(p, candidate(job(witness), { key: 'cartier-careers', company: 'Cartier', tier: 'EMPLOYER_DIRECT' as SourceTier }));
    expect((await p.job.findUniqueOrThrow({ where: { id: elsewhere.jobId } })).companyId).toBe(cartier.id);
    const previousLabel = refused.employerHistory.filter(h => h.employer).at(-1)!.rawEmployerName;
    const before = await upsertDeduplicated(p, candidate(job(refused, { company: previousLabel,
      employerEvidence: { ...(refused.job.employerEvidence as NonNullable<NormalizedJob['employerEvidence']>), rawName: previousLabel } })));
    await expect(upsertDeduplicated(p, candidate(job(refused)), undefined, follow('FOLLOW')))
      .rejects.toMatchObject({ motif: 'EMPLOYER_SPELLING_DIVERGED', proposedName: 'Richemont' });
    expect((await p.job.findUniqueOrThrow({ where: { id: before.jobId } })).companyId).toBe(richemontCo.id);
  });

  it('une offre qui ne porte plus Cartier ne témoigne plus pour Cartier, ni aujourd’hui ni avant la collecte', async () => {
    // Le seul témoin passe lui-même à un autre libellé (revue) : sa dernière observation avant la collecte ne dit plus
    // Cartier, même si l'on prétendait que l'éditeur le nomme encore Cartier aujourd'hui.
    const { richemontCo } = await stateBeforeTheRun();
    const relabelled = job(witness, { company: 'Van Cleef & Arpels',
      employerEvidence: { ...(witness.job.employerEvidence as NonNullable<NormalizedJob['employerEvidence']>), rawName: 'Van Cleef & Arpels' } });
    await expect(upsertDeduplicated(p, candidate(relabelled))).rejects.toMatchObject({ motif: 'EMPLOYER_SPELLING_DIVERGED' });
    await expect(upsertDeduplicated(p, candidate(job(refused)), undefined, follow('FOLLOW')))
      .rejects.toMatchObject({ motif: 'EMPLOYER_SPELLING_DIVERGED' });
    expect(await p.job.count({ where: { companyId: richemontCo.id } })).toBe(1);
  });

  it('une offre que l’éditeur ne nomme plus Cartier dans cette collecte ne témoigne pas, même attribuée hier à Cartier', async () => {
    const { richemontCo } = await stateBeforeTheRun();
    const relabelled = job(witness, { company: 'Van Cleef & Arpels',
      employerEvidence: { ...(witness.job.employerEvidence as NonNullable<NormalizedJob['employerEvidence']>), rawName: 'Van Cleef & Arpels' } });
    // PRÉMISSE : avec la collecte du 01/10 (le témoin sous Cartier), la même offre suivrait ; voir le premier témoin.
    await expect(upsertDeduplicated(p, candidate(job(refused)), undefined, follow('FOLLOW', collection(relabelled, job(refused)))))
      .rejects.toMatchObject({ motif: 'EMPLOYER_SPELLING_DIVERGED', employerChange: true });
    expect(await p.job.count({ where: { companyId: richemontCo.id } })).toBe(1);
  });

  it('ne suit pas l’éditeur sur un job board : la source publie trop d’employeurs pour lier A et B (R-142 §1)', async () => {
    // Les mêmes données, rejouées comme si la source était un job board (WTTJ) : l'état est identique, seul le rang change.
    const board = { ...richemont, tier: 'SPECIALIST_JOBBOARD' as SourceTier };
    const { richemontCo, cartier } = await companies();
    await upsertDeduplicated(p, candidate(job(witness), board));
    const previousLabel = refused.employerHistory.filter(h => h.employer).at(-1)!.rawEmployerName;
    const before = await upsertDeduplicated(p, candidate(job(refused, { company: previousLabel,
      employerEvidence: { ...(refused.job.employerEvidence as NonNullable<NormalizedJob['employerEvidence']>), rawName: previousLabel } }), board));
    await expect(upsertDeduplicated(p, candidate(job(refused), board), undefined, follow('FOLLOW')))
      .rejects.toMatchObject({ motif: 'EMPLOYER_SPELLING_DIVERGED', employerChange: true });
    expect((await p.job.findUniqueOrThrow({ where: { id: before.jobId } })).companyId).toBe(richemontCo.id);
    // PRÉMISSE : sur le portail du groupe, les mêmes données suivent bien l'éditeur.
    await expect(upsertDeduplicated(p, candidate(job(refused)), undefined, follow('FOLLOW'))).resolves.toMatchObject({ jobId: before.jobId });
    expect((await p.job.findUniqueOrThrow({ where: { id: before.jobId } })).companyId).toBe(cartier.id);
  });
});
