import { publicationFixture } from '../test/publication-fixture.js';
import '../test/setup-integration.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { explainOffer, readExposureDistribution, readExposureIds, verifyExposedAgainstSearch } from '../coverage/offerExposureReading.js';

/**
 * D-520 §3 sur une vraie base : l'état EXPOSEE est exactement ce que sert la recherche (`publicJobSql` dans un pays de
 * marché ouvert), toute offre a une cause, et `pourquoi-offre` retrouve une offre par son identifiant, son lien, ou
 * une publication non rattachée. Chaque cas échoue sur la révision d'avant (le module n'existait pas), et le témoin
 * d'équivalence échoue si la fonction de vérité ignore la retenue de disponibilité (prouvé en réintroduisant ce défaut).
 */
const prisma = new PrismaClient();
const now = Date.now();
const h = (hours: number) => new Date(now - hours * 3_600_000);

async function wipe() {
  await prisma.jobEvent.deleteMany({});
  await prisma.jobSource.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.sourceObservation.deleteMany({ where: { sourceKey: { startsWith: 'expo-' } } });
  await prisma.source.deleteMany({ where: { key: { startsWith: 'expo-' } } });
  await prisma.company.deleteMany({ where: { canonicalKey: { startsWith: 'EXPO_' } } });
}

type Rep = { key?: string; ext: string; tier?: string; active?: boolean; expiresAt?: Date | null; hold?: string | null; rule?: string;
  closedBy?: Date | null; seen?: Date };
let companyId = '';
async function offer(id: string, over: { country?: string | null; active?: boolean; closedAt?: Date | null; withdrawnAt?: Date | null;
  reason?: string | null; reps: Rep[] }) {
  const [first] = over.reps;
  return prisma.job.create({ data: {
    id, companyId, externalId: first.ext, source: 'GENERIC_JSONLD', title: `Conseiller ${id}`, url: `https://x/${first.key ?? 'expo-ats'}/${first.ext}`,
    countryCode: over.country === undefined ? 'FR' : over.country, isActive: over.active ?? true, closedAt: over.closedAt ?? null,
    withdrawnAt: over.withdrawnAt ?? null, withdrawalReason: over.reason ?? null,
    sources: { create: over.reps.map(rep => {
      const key = rep.key ?? 'expo-ats', url = `https://x/${key}/${rep.ext}`;
      return { sourceKey: key, sourceTier: rep.tier ?? 'ATS_OFFICIAL', externalId: rep.ext, url,
        ...publicationFixture({ sourceKey: key, externalId: rep.ext, url, title: 'Conseiller' }),
        isActive: rep.active ?? true, expiresAt: rep.expiresAt ?? null, lastSeenAt: rep.seen ?? h(2),
        availabilityHold: rep.hold ?? null, availabilityHoldAt: rep.hold ? h(1) : null,
        availabilityEvidence: rep.hold ? { rule: rep.rule ?? 'MISSED_BY_CREDIBLE_COLLECTION' } : undefined,
        publisherClosedAt: rep.closedBy ?? null };
    }) },
  } });
}

/** Une offre par cause atteignable en base ; `expected` est l'état que chaque fixture doit porter. */
const expected: Record<string, string> = {
  exposee: 'EXPOSEE/CONFIRMEE', pausee: 'EXPOSEE/SOURCE_EN_PAUSE', boardseul: 'EXPOSEE/CONFIRMEE',
  nonrevue: 'MASQUEE/NON_RECONFIRMEE', plafond: 'MASQUEE/PLAFOND_72H', lienmort: 'MASQUEE/LIEN_MORT',
  sanspreuve: 'MASQUEE/RETIREE_SANS_PREUVE', spontanee: 'RETENUE_PAR_REGLE/CANDIDATURE_SPONTANEE', sansannonce: 'RETENUE_PAR_REGLE/POSTE_SANS_ANNONCE',
  absorbee: 'ABSORBEE/DOUBLON', gagnante: 'EXPOSEE/CONFIRMEE', fermee: 'FERMEE/PAR_LA_SOURCE', echue: 'FERMEE/PAR_ECHEANCE',
  autorite: 'FERMEE/PAR_AUTORITE', exclue: 'NON_PUBLIABLE/SOURCE_EXCLUE', sanspays: 'HORS_MARCHE/SANS_PAYS', inde: 'EXPOSEE/PAYS_SEUL', kosovo: 'HORS_MARCHE/PAYS_INCONNU',
  incoherente: 'INEXPLIQUEE/SANS_CAUSE',
};

beforeAll(async () => {
  await wipe();
  companyId = (await prisma.company.create({ data: { name: 'Expo Maison', canonicalKey: 'EXPO_MAISON', fashionjobsUrl: 'resolved:expo' } })).id;
  for (const [key, status] of [['expo-ats', 'ACTIVE'], ['expo-pause', 'PAUSED'], ['expo-retiree', 'RETIRED']] as const) {
    await prisma.source.create({ data: { key, maison: 'Expo Maison', tenantKey: `ashby:${key}`, kind: 'ashby', config: { board: key },
      tier: 'EMPLOYER_DIRECT', status } });
  }
  await offer('exposee', { reps: [{ ext: 'e1' }] });
  await offer('pausee', { reps: [{ key: 'expo-pause', ext: 'p1', seen: h(200) }] });
  await offer('boardseul', { reps: [{ ext: 'b1', hold: 'NOT_RECONFIRMED' }, { key: 'expo-board', ext: 'b1w', tier: 'SPECIALIST_JOBBOARD' }] });
  await offer('nonrevue', { reps: [{ ext: 'n1', hold: 'NOT_RECONFIRMED', seen: h(30) }] });
  await offer('plafond', { reps: [{ ext: 'c1', hold: 'NOT_RECONFIRMED', rule: 'CEILING_72H', seen: h(80) }] });
  await offer('lienmort', { reps: [{ ext: 'd1', hold: 'APPLY_LINK_DEAD' }] });
  await offer('sanspreuve', { active: false, withdrawnAt: h(4), reason: 'ATTESTATION_MISSING', reps: [{ ext: 'a1', active: false }] });
  await offer('spontanee', { active: false, withdrawnAt: h(4), reason: 'OUT_OF_SCOPE', reps: [{ ext: 's1', active: false }] });
  await offer('sansannonce', { active: false, withdrawnAt: h(4), reason: 'SOURCE_UNLISTED', reps: [{ ext: 't1', active: false }] });
  await offer('gagnante', { reps: [{ ext: 'g1' }] });
  await offer('absorbee', { reps: [{ key: 'expo-board', ext: 'g1w', tier: 'SPECIALIST_JOBBOARD' }] });
  // Une fusion relue : la représentation passe à la gagnante, l'absorbée garde son identifiant et son événement MERGED.
  await prisma.$transaction([
    prisma.jobSource.updateMany({ where: { jobId: 'absorbee' }, data: { jobId: 'gagnante' } }),
    prisma.jobEvent.create({ data: { jobId: 'absorbee', type: 'MERGED', field: 'mergedInto', after: 'gagnante' } }),
    prisma.job.update({ where: { id: 'absorbee' }, data: { mergedIntoId: 'gagnante', isActive: false } }),
  ]);
  await offer('fermee', { active: false, closedAt: h(10), reps: [{ ext: 'f1', active: false, closedBy: h(10) }] });
  await offer('echue', { reps: [{ ext: 'x1', expiresAt: h(1) }] });
  await offer('autorite', { active: false, closedAt: h(10), reps: [{ ext: 'o1', tier: 'EMPLOYER_DIRECT', active: false, closedBy: h(10) },
    { key: 'expo-board', ext: 'o1w', tier: 'SPECIALIST_JOBBOARD' }] });
  await offer('exclue', { active: false, withdrawnAt: h(4), reason: 'SOURCE_RETIRED', reps: [{ key: 'expo-retiree', ext: 'r1', active: false }] });
  await offer('sanspays', { country: null, reps: [{ ext: 'sp1' }] });
  await offer('inde', { country: 'IN', reps: [{ ext: 'in1' }] });
  await offer('kosovo', { country: 'XK', reps: [{ ext: 'xk1' }] });
  await offer('incoherente', { active: false, reps: [{ ext: 'i1', active: false }] });
  await prisma.sourceObservation.createMany({ data: [
    { sourceKey: 'expo-ats', externalId: 's1', contentHash: 'h-s1', annotationHash: 'a-s1', pipelineVersion: 1, publicationHold: 'NATIVE_SPONTANEOUS_APPLICATION', raw: {} },
    { sourceKey: 'expo-ats', externalId: 't1', contentHash: 'h-t1', annotationHash: 'a-t1', pipelineVersion: 1, publicationHold: 'NATIVE_ADVERTISEMENT_WITHDRAWN', raw: {} },
    // Jamais publiées : retenues dès la collecte, l'une par une preuve de la source, l'autre pour un motif à instruire.
    { sourceKey: 'expo-ats', externalId: 'nv1', contentHash: 'h-nv1', annotationHash: 'a-nv1', pipelineVersion: 1, publicationHold: 'NATIVE_DESCRIPTION_EMPTY', raw: {} },
    { sourceKey: 'expo-ats', externalId: 'nv2', contentHash: 'h-nv2', annotationHash: 'a-nv2', pipelineVersion: 1, publicationHold: 'EXPO_DETAIL_FETCH_FAILED', raw: {} },
  ] });
  // Une publication non rattachée, l'employeur en revue d'identité. En production elle naît d'une collecte réelle (sa
  // capture est exigée par les déclencheurs) ; ici seul son état est posé, déclencheurs suspendus pour cette seule ligne.
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.$executeRaw`INSERT INTO "JobSource" (id, "sourceKey", "sourceTier", "externalId", url, "isActive", "quarantinedAt", "quarantineReason")
      VALUES ('q1', 'expo-ats', 'ATS_OFFICIAL', 'q1', 'https://x/expo-ats/q1', true, now(), 'EMPLOYER_UNRESOLVED')`;
  });
});
afterAll(async () => { await wipe(); await prisma.$disconnect(); });

describe('D-520 §3 — l’état d’exposition sur une vraie base', () => {
  it('chaque offre porte l’état attendu, et une seule n’a pas de cause', async () => {
    const ids = await readExposureIds(prisma);
    const got: Record<string, string> = {};
    for (const [cause, list] of ids) for (const id of list) got[id] = cause;
    expect(got).toEqual(expected);
  });

  it('EXPOSÉE = ce que sert la recherche : `publicJobSql` dans un pays de marché ouvert, à l’identique', async () => {
    const check = await verifyExposedAgainstSearch(prisma);
    // Prémisse : la base contient des offres actives que la recherche NE sert PAS (retenues, échues, hors marché).
    expect(await prisma.job.count({ where: { isActive: true, mergedIntoId: null } })).toBeGreaterThan(check.served);
    expect(check).toMatchObject({ exposed: 5, served: 5, onlyExposedCount: 0, onlyServedCount: 0, publicOutsideMarkets: 2, outsideMarketsMismatch: 0 });
  });

  it('la répartition compte tout, nomme les offres sans cause et les publications en revue', async () => {
    const d = await readExposureDistribution(prisma, { byMarket: true });
    expect(d.counts.total).toBe(Object.keys(expected).length);
    expect(d.counts.byState).toMatchObject({ EXPOSEE: 5, MASQUEE: 4, RETENUE_PAR_REGLE: 2, ABSORBEE: 1, FERMEE: 3, NON_PUBLIABLE: 1, HORS_MARCHE: 2, INEXPLIQUEE: 1 });
    expect(d.retainedAtCollection).toEqual({ 'RETENUE_PAR_REGLE/PREUVE_DE_LA_SOURCE': 1, 'INEXPLIQUEE/SANS_CAUSE': 1 });
    expect(d.unexplained.map(u => u.id)).toEqual(['incoherente']);
    expect(d.identityReview).toBe(1);
    expect(d.byMarket?.find(m => m.market === 'FR')?.counts.byState.EXPOSEE).toBe(4);
    expect(d.byMarket?.find(m => m.market === 'hors marché')?.counts.byCause).toEqual({ 'EXPOSEE/PAYS_SEUL': 1, 'HORS_MARCHE/PAYS_INCONNU': 1 });
    const maison = await readExposureDistribution(prisma, { scope: { kind: 'MAISON', companyId } });
    expect(maison.counts.total).toBe(Object.keys(expected).length);
    const inde = await readExposureDistribution(prisma, { scope: { kind: 'MARCHE', code: 'IN' } });
    expect(inde.counts.byCause).toEqual({ 'EXPOSEE/PAYS_SEUL': 1 });
  });

  it('pourquoi-offre : une offre absorbée nomme sa gagnante et l’état de celle-ci', async () => {
    const e = await explainOffer(prisma, 'absorbee');
    expect(e?.exposure).toMatchObject({ state: 'ABSORBEE', cause: 'DOUBLON' });
    expect(e?.duplicates.winner).toEqual({ id: 'gagnante', state: 'EXPOSEE', cause: 'CONFIRMEE' });
    expect(e?.exposure.comeback).toContain('gagnante');
    expect((await explainOffer(prisma, 'gagnante'))?.duplicates.absorbed.map(a => a.id)).toEqual(['absorbee']);
  });

  it('pourquoi-offre : retrouvée par le lien d’une publication, par une adresse catwalks.io, par source:identifiant', async () => {
    expect((await explainOffer(prisma, 'https://x/expo-ats/n1'))?.offer?.id).toBe('nonrevue');
    expect((await explainOffer(prisma, 'https://catwalks.io/fr/offre/conseiller-de-vente-paris-nonrevue'))?.offer?.id).toBe('nonrevue');
    const q = await explainOffer(prisma, 'expo-ats:q1');
    expect(q?.offer).toBeNull();
    expect(q?.exposure).toMatchObject({ state: 'NON_PUBLIABLE', cause: 'IDENTITE_EN_REVUE', trajectory: 'SUR_DECISION' });
    expect((await explainOffer(prisma, 'expo-ats:nv1'))?.exposure).toMatchObject({ state: 'RETENUE_PAR_REGLE', cause: 'PREUVE_DE_LA_SOURCE' });
    expect(await explainOffer(prisma, 'inconnue')).toBeNull();
  });

  it('pourquoi-offre : la trajectoire dit l’état opérationnel de la source qui porte la cause', async () => {
    const e = await explainOffer(prisma, 'nonrevue');
    expect(e?.exposure).toMatchObject({ cause: 'NON_RECONFIRMEE', trajectory: 'REVIENT_SEULE' });
    expect(e?.exposure.comeback).toContain('expo-ats (ACTIVE, aucune collecte de RUN)');
    expect(e?.sources[0]).toMatchObject({ hold: 'NOT_RECONFIRMED', sourceState: 'ACTIVE, aucune collecte de RUN' });
  });
});
