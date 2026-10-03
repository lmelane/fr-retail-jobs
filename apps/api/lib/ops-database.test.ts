import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@catwalks/db';
import { publicationFixture } from '../../aggregator/src/test/publication-fixture';
import { GET as vueEnsemble } from '@/app/api/ops/vue-ensemble/route';
import { GET as sources } from '@/app/api/ops/sources/route';
import { GET as source } from '@/app/api/ops/sources/[cle]/route';
import { GET as couverture } from '@/app/api/ops/couverture/route';
import { GET as fileRevue } from '@/app/api/ops/file-revue/route';
import { GET as pourquoi } from '@/app/api/ops/pourquoi/route';
import { lireEnLectureSeule } from '@/lib/ops/lecture';

/**
 * D-522 §5 — les routes de pilotage sur une vraie base (conteneur de `npm run test:local`), par les vrais lecteurs du
 * worker. Chaque témoin lit une donnée que seule la route expose : sans le code, rien ne la rend (aucune route
 * `/api/ops/*` n'existait avant ce lot).
 *
 * Le jeu exerce chaque branche lue par la console : une source bloquée à réparer (état calculé), une source active SANS
 * état calculé (le cas de la base de production avant le premier RUN r6, 0 ligne `SourceOperationalState` le
 * 03/10/2026), une pause décidée, une pause à trancher, une entrée de file d'identité, une photographie de couverture
 * avec une perte, un RUN complet et sa réconciliation rouge, une offre servie.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const p = `ops-${randomUUID().slice(0, 8)}`;
const K = { bloquee: `${p}-bloquee`, neuve: `${p}-neuve`, pause: `${p}-pause`, trancher: `${p}-trancher` };
const companyId = `${p}-maison`;
const runId = randomUUID();
// Les plus récents de la base de test : la photographie et le RUN « derniers » sont ceux de ce jeu.
const futur = new Date(Date.now() + 2 * 86_400_000);
const reviewId = createHash('sha256').update(p).digest('hex');
let jobId = '';

const req = (chemin: string) => new NextRequest(`http://catalogue.test${chemin}`, { headers: { authorization: 'Bearer cle-ops-test' } });
async function json(r: Response) { expect(r.status, await r.clone().text()).toBe(200); return r.json(); }

describe.skipIf(!enabled)('routes de pilotage /api/ops/* (D-522 §5) sur la base de test', () => {
  beforeAll(async () => {
    const base = { tier: 'EMPLOYER_DIRECT', kind: 'ashby' };
    await prisma.sourceRegistryReview.create({ data: { id: reviewId, reviewer: 'témoin ops', plan: {}, before: [] } });
    await prisma.source.createMany({ data: [
      { ...base, key: K.bloquee, maison: 'Maison Bloquée', tenantKey: `ashby:${K.bloquee}`, config: { board: K.bloquee, listingUrl: 'https://jobs.example.com/bloquee' }, status: 'ACTIVE' },
      { ...base, key: K.neuve, maison: 'Maison Neuve', tenantKey: `ashby:${K.neuve}`, config: { board: K.neuve }, status: 'ACTIVE' },
      { ...base, key: K.pause, maison: 'Maison en Pause', tenantKey: `ashby:${K.pause}`, config: { board: K.pause }, status: 'PAUSED',
        statusReviewId: reviewId, statusExplainedFor: 'PAUSED', statusIntention: 'COLLECTER', statusTrajectory: 'DECISION', statusBasis: 'DECISION',
        statusDecision: 'D-506 §1', statusReason: 'portail en panne chez l’éditeur', statusNextAction: 'relire le portail', statusReviewAt: new Date('2026-10-05') },
      { ...base, key: K.trancher, maison: 'Maison à Trancher', tenantKey: `ashby:${K.trancher}`, config: { board: K.trancher }, status: 'PAUSED',
        statusReviewId: reviewId, statusExplainedFor: 'PAUSED', statusIntention: 'A_TRANCHER', statusTrajectory: 'REVUE_HUMAINE', statusBasis: 'PREUVE',
        statusDecision: 'aucune', statusReason: 'deux portails pour la même Maison', statusNextAction: 'choisir le portail officiel',
        statusQuestion: 'Quel portail fait foi ?', statusReviewAt: new Date('2026-10-10') },
    ] });
    const now = new Date();
    await prisma.sourceOperationalState.create({ data: { sourceKey: K.bloquee, state: 'BLOQUEE', cause: 'LECTEUR', trajectory: 'A_REPARER',
      missing: 'corriger le lecteur', since: new Date(now.getTime() - 3 * 86_400_000), computedAt: now, codes: ['UNKNOWN/HttpStatusError/HTTP_404'],
      lastCollectionAt: now, lastCollectionKind: 'RUN' } });
    await prisma.company.create({ data: { id: companyId, name: 'Maison Témoin Ops', canonicalKey: companyId, fashionjobsUrl: `resolved:${companyId}` } });
    const job = await prisma.job.create({ data: { companyId, source: 'ASHBY', externalId: `${p}-1`, title: 'Conseiller de vente', city: 'Paris',
      countryCode: 'FR', url: `https://jobs.example.com/${p}-1`,
      sources: { create: [{ sourceKey: K.bloquee, sourceTier: 'EMPLOYER_DIRECT', externalId: `${p}-1`, url: `https://jobs.example.com/${p}-1`,
        ...publicationFixture({ sourceKey: K.bloquee, externalId: `${p}-1`, url: `https://jobs.example.com/${p}-1`, title: 'Conseiller de vente' }) }] } } });
    jobId = job.id;
    await prisma.employerIdentityQueue.create({ data: { sourceKey: K.bloquee, motif: 'NEW_SPELLING', normalizedLabel: 'maison bloquee sas',
      rawLabel: 'Maison Bloquée SAS', proposedName: 'Maison Bloquée', offers: 4, sampleExternalIds: ['a1', 'a2'], missingProof: 'la graphie n’est rattachée à aucune Maison',
      question: 'Rattacher « Maison Bloquée SAS » à Maison Bloquée ?', escalateAt: new Date(now.getTime() - 60_000) } });
    await prisma.coverageSnapshot.createMany({ data: [
      { runId, takenAt: futur, scope: 'MAISON', key: companyId, label: 'Maison Témoin Ops', served: 2, reference: 40, cause: 'COLLECTE', gravity: 'A_REPARER' },
      { runId, takenAt: futur, scope: 'MARCHE', key: 'FR', label: 'France', served: 900, reference: 905, cause: null, gravity: null },
      { runId, takenAt: futur, scope: 'SOURCE', key: K.neuve, label: K.neuve, served: 0, reference: 12, cause: 'INEXPLIQUEE', gravity: 'A_VERIFIER' },
    ] });
    await prisma.pipelineRun.create({ data: { id: runId, command: 'ingest-all', status: 'FAILED', startedAt: futur, finishedAt: new Date(futur.getTime() + 3_600_000) } });
    await prisma.pipelineEvent.create({ data: { id: randomUUID(), runId, level: 'info', event: 'run.reconciled', fingerprint: 'ops-temoin', at: futur,
      payload: { green: false, reasons: [{ reason: 'ANCIENNETE_DEPASSEE', detail: 'à réparer depuis plus de 14 jours', sources: [K.bloquee] }], toVerify: [] } } });
  });

  afterAll(async () => {
    await prisma.pipelineEvent.deleteMany({ where: { runId } });
    await prisma.pipelineRun.deleteMany({ where: { id: runId } });
    await prisma.coverageSnapshot.deleteMany({ where: { runId } });
    await prisma.employerIdentityQueue.deleteMany({ where: { sourceKey: { in: Object.values(K) } } });
    await prisma.jobSource.deleteMany({ where: { job: { companyId } } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.sourceOperationalState.deleteMany({ where: { sourceKey: { in: Object.values(K) } } });
    await prisma.source.deleteMany({ where: { key: { in: Object.values(K) } } });
  });

  beforeEach(() => {
    vi.stubEnv('CATALOGUE_OPS_KEY', 'cle-ops-test');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it('sources : état, cause, trajectoire, manque, offres en jeu, registre ; une source active sans état est « non calculée », jamais « bloquée »', async () => {
    const corps = await json(await sources(req('/api/ops/sources')));
    const ligne = (cle: string) => corps.sources.find((s: { cle: string }) => s.cle === cle);
    expect(corps.etatCalcule).toBe(true);
    expect(ligne(K.bloquee)).toMatchObject({ calcule: true, etat: 'BLOQUEE', cause: 'LECTEUR', trajectoire: 'A_REPARER', manque: 'corriger le lecteur',
      ageJours: 3, maison: 'Maison Bloquée', famille: 'ashby', offres: { enJeu: 1, seulementParElle: 1, publicationsActives: 1 } });
    expect(ligne(K.bloquee).causeLibelle).toContain('lecteur');
    expect(ligne(K.neuve)).toMatchObject({ calcule: false, statut: 'ACTIVE' });
    expect(ligne(K.pause)).toMatchObject({ calcule: true, etat: 'EN_PAUSE', cause: 'PAUSE_DECIDEE', trajectoire: 'DECISION',
      registre: { decision: 'D-506 §1', reexamen: '2026-10-05', explique: true } });
    // Aucun état persisté : le début de l'épisode n'est pas connu, la console ne dit pas « depuis aujourd'hui ».
    expect(ligne(K.pause)).toMatchObject({ depuis: null, ageJours: null });
    expect(corps.synthese.comptees).toBe(corps.synthese.total - corps.synthese.nonCalculees);
    expect(corps.synthese.nonCalculees).toBeGreaterThanOrEqual(1);
    // La plus urgente d'abord : une source à réparer passe devant une source sans état et une source normale.
    const rangs = corps.sources.map((s: { cle: string }) => s.cle);
    expect(rangs.indexOf(K.bloquee)).toBeLessThan(rangs.indexOf(K.neuve));
  });

  it('source : le détail porte le portail public seul, les collectes et la question d’identité ouverte', async () => {
    const corps = await json(await source(req(`/api/ops/sources/${K.bloquee}`), { params: Promise.resolve({ cle: K.bloquee }) }));
    expect(corps.source.cle).toBe(K.bloquee);
    expect(corps.portail).toEqual({ domaine: null, perimetre: null, adresse: 'https://jobs.example.com/bloquee' });
    expect(JSON.stringify(corps)).not.toContain('"board"');
    expect(corps.fileIdentite).toEqual([expect.objectContaining({ libelleBrut: 'Maison Bloquée SAS', offres: 4, echue: true })]);
    const inconnue = await source(req(`/api/ops/sources/${p}-absente`), { params: Promise.resolve({ cle: `${p}-absente` }) });
    expect(inconnue.status).toBe(404);
  });

  it('couverture : la dernière photographie, ses pertes et les offres servies maintenant par Maison', async () => {
    const corps = await json(await couverture(req('/api/ops/couverture')));
    expect(corps.photographie).toEqual({ prise: futur.toISOString(), runId });
    expect(corps.pertes[0]).toMatchObject({ portee: 'MAISON', cle: companyId, auRun: 2, reference: 40, gravite: 'A_REPARER', graviteLibelle: 'à réparer' });
    expect(corps.pertes.map((x: { cle: string }) => x.cle)).toContain(K.neuve);
    expect(corps.maisons.find((m: { cle: string }) => m.cle === companyId)).toMatchObject({ servies: 1, auRun: 2, reference: 40 });
    expect(corps.marches.find((m: { cle: string }) => m.cle === 'FR')).toMatchObject({ auRun: 900 });
    expect(corps.offresServies).toBeGreaterThanOrEqual(1);
  });

  it('file de revue : identité, registre à trancher, couverture à vérifier', async () => {
    const corps = await json(await fileRevue(req('/api/ops/file-revue')));
    expect(corps.identite.some((e: { source: string }) => e.source === K.bloquee)).toBe(true);
    expect(corps.registre.aTrancher).toContainEqual(expect.objectContaining({ cle: K.trancher, question: 'Quel portail fait foi ?', reexamen: '2026-10-10' }));
    expect(corps.registre.aTrancher.map((x: { cle: string }) => x.cle)).not.toContain(K.pause);
    expect(corps.couvertureAVerifier).toContainEqual(expect.objectContaining({ cle: K.neuve, reference: 12 }));
  });

  it('vue d’ensemble : le dernier RUN et sa réconciliation, la fraîcheur, les pertes, la file et les actions', async () => {
    const corps = await json(await vueEnsemble(req('/api/ops/vue-ensemble')));
    expect(corps.run.last).toMatchObject({ id: runId, status: 'FAILED', verdict: { kind: 'RECONCILIATION', green: false,
      reasons: [{ reason: 'ANCIENNETE_DEPASSEE', sources: [K.bloquee] }] } });
    expect(corps.couverture.aReparer).toBeGreaterThanOrEqual(1);
    expect(corps.fileIdentite.ouvertes).toBeGreaterThanOrEqual(1);
    expect(corps.fraicheur).toMatchObject({ fenetreHeures: 48 });
    expect(corps.fraicheur.offresActives).toBeGreaterThanOrEqual(1);
    expect(corps.actions.map((a: { cle: string }) => a.cle)).toContain(K.bloquee);
    expect(corps.sources.parEtat.map((e: { etat: string }) => e.etat)).toEqual(['NORMALE', 'DEGRADEE', 'EN_ATTENTE', 'BLOQUEE', 'EN_PAUSE', 'EXCLUE']);
  });

  it('pourquoi : le parcours d’une offre par son identifiant ou son lien ; 404 pour une référence inconnue', async () => {
    const parId = await json(await pourquoi(req(`/api/ops/pourquoi?ref=${jobId}`)));
    expect(parId.offer.id).toBe(jobId);
    expect(parId.exposure.state).toEqual(expect.any(String));
    expect(parId.sources[0]).toMatchObject({ sourceKey: K.bloquee });
    const parLien = await json(await pourquoi(req(`/api/ops/pourquoi?ref=${encodeURIComponent(`https://jobs.example.com/${p}-1`)}`)));
    expect(parLien.offer.id).toBe(jobId);
    expect((await pourquoi(req(`/api/ops/pourquoi?ref=${p}-inconnue`))).status).toBe(404);
  });

  it('la lecture est refusée en écriture par la base elle-même (transaction READ ONLY)', async () => {
    await expect(lireEnLectureSeule(tx => tx.$executeRaw`UPDATE "Source" SET note = 'écrit' WHERE key = ${K.neuve}`)).rejects.toThrow(/read-only|lecture seule/i);
    expect((await prisma.source.findUniqueOrThrow({ where: { key: K.neuve } })).note).toBeNull();
  });
});
