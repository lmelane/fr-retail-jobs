import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resolveEmployer } from '../identity/resolve.js';
import { EmployerIdentityReviewRequired } from '../identity/errors.js';
import { CERTIFIED_SCOPE_PATH, GROUP_BRAND_PATH, GROUP_BRAND_RULE, GROUP_SCOPE_RULE, employerFromCertifiedScope } from '../identity/portalEmployer.js';
import { groupPortalBrands } from '../identity/groupBrands.js';
import { toCandidate } from './ingest.js';
import type { CandidateJob } from '../dedup/match.js';

/**
 * D-522 §6 — LA CHAÎNE JUSQU'À LA PUBLICATION, R-142 §3 sur un portail relu MULTI_BRAND : la marque que l'offre nomme
 * (liste fermée du groupe, `identity/groupBrands.ts`), sinon le groupe. Le résolveur ne croit pas la marque portée par
 * la candidate : il la relit sur l'offre même, contre la liste du portail relu, et refuse tout écart.
 * Les intitulés et lieux sont ceux des sorties réelles du RUN du 02/10/2026 (`identity/__fixtures__/group-brands-20261002.json`).
 */
const db = new PrismaClient();
// Les observations d'employeur sont immuables (déclencheur) : chaque offre porte un identifiant propre au passage.
beforeEach(async () => { await db.jobSource.deleteMany(); await db.job.deleteMany(); await db.company.deleteMany(); });
afterAll(() => db.$disconnect());

const RUN = randomUUID().slice(0, 8);
const BRAND = `${GROUP_BRAND_PATH}:${GROUP_BRAND_RULE}`;
const GROUP = `${CERTIFIED_SCOPE_PATH}:${GROUP_SCOPE_RULE}`;

async function portail(key: string, maison: string, scope: 'MULTI_BRAND' | 'SINGLE_BRAND' | null) {
  await db.source.upsert({ where: { key }, update: { maison, portalScope: scope },
    create: { key, maison, kind: 'workday', status: 'ACTIVE', config: {}, tier: 'GROUP_OFFICIAL', tenantKey: `test:${key}`, portalScope: scope } });
}

function offre(sourceKey: string, id: string, label: string, origin: string, title: string, location: string): CandidateJob & { companyId: string } {
  const externalId = `${id}-${RUN}`;
  return {
    sourceKey, externalId, companyId: 'registry-hint', title, rawTitle: title, location,
    url: `https://exemple.test/${sourceKey}/${externalId}`, company: label, rawEmployerName: label, employerLabelOrigin: origin,
    raw: { title, bulletFields: [location, externalId] },
    atsType: 'WORKDAY', sourceTier: 'GROUP_OFFICIAL', country: 'US',
  } as unknown as CandidateJob & { companyId: string };
}

const resoudre = (candidate: CandidateJob & { companyId: string }) => db.$transaction(tx => resolveEmployer(tx, candidate));
const motif = async (candidate: CandidateJob & { companyId: string }) => {
  try { await resoudre(candidate); return 'RESOLVED'; } catch (e) { return e instanceof EmployerIdentityReviewRequired ? e.motif : String(e); }
};
const employeurPublie = async (sourceKey: string, id: string) => (await db.jobSource.findUniqueOrThrow({
  where: { sourceKey_externalId: { sourceKey, externalId: `${id}-${RUN}` } }, select: { job: { select: { company: { select: { name: true, fashionjobsUrl: true } } } } } })).job!.company;

describe('portail relu MULTI_BRAND : la marque prouvée publie sous sa Maison, le reste sous le groupe', () => {
  it('Beyond Yoga nommée dans l’intitulé : publiée sous Beyond Yoga (créée sous la clé du registre)', async () => {
    await portail('levis', "Levi's", 'MULTI_BRAND');
    const c = offre('levis', 'by-1', 'Beyond Yoga', BRAND, 'Seasonal Sales Stylist, Beyond Yoga', 'Irvine, CA, USA');
    const r = await resoudre(c);
    expect(r.rule).toBe('MULTI_BRAND_PORTAL_GROUP_BRAND');
    expect(r).toMatchObject({ newKey: 'BEYOND_YOGA', newName: 'Beyond Yoga' });
    await upsertDeduplicated(db, c);
    expect(await employeurPublie('levis', 'by-1')).toEqual({ name: 'Beyond Yoga', fashionjobsUrl: 'resolved:BEYOND_YOGA' });
    const obs = await db.employerObservation.findFirstOrThrow({ where: { sourceKey: 'levis', externalId: `by-1-${RUN}` } });
    // Provenance à part : jamais un libellé natif.
    expect(obs).toMatchObject({ labelOrigin: BRAND, rule: 'MULTI_BRAND_PORTAL_GROUP_BRAND' });
  });

  it('aucune marque nommée : publiée sous le groupe propriétaire (le nom de la Maison au registre)', async () => {
    await portail('levis', "Levi's", 'MULTI_BRAND');
    const c = offre('levis', 'ls-1', "Levi's", GROUP, 'Sales Stylist', 'LS MUENSTER ARKADEN, Münster, Germany');
    expect((await resoudre(c)).rule).toBe('MULTI_BRAND_PORTAL_GROUP_OWNER');
    await upsertDeduplicated(db, c);
    expect((await employeurPublie('levis', 'ls-1')).fashionjobsUrl).toBe('resolved:LEVI_S');
  });

  it('marque portée par la candidate mais absente de l’offre : refusée, jamais crue sur parole', async () => {
    await portail('levis', "Levi's", 'MULTI_BRAND');
    expect(await motif(offre('levis', 'x-1', 'Beyond Yoga', BRAND, 'Sales Stylist', 'LS MUENSTER ARKADEN, Münster, Germany'))).toBe('PORTAL_OWNER_NOT_CERTIFIED');
  });

  it('marque hors liste (Dockers, cédée) : refusée, jamais publiée sous une autre Maison', async () => {
    await portail('levis', "Levi's", 'MULTI_BRAND');
    expect(await motif(offre('levis', 'x-2', 'Dockers', BRAND, 'Dockers Outlet Stylist', 'Commerce, CA, USA'))).toBe('PORTAL_OWNER_NOT_CERTIFIED');
  });

  it('deux marques dans l’offre : la marque est refusée (l’offre va au groupe)', async () => {
    await portail('vf-corporation', 'VF Corporation', 'MULTI_BRAND');
    expect(await motif(offre('vf-corporation', 'x-3', 'JanSport', BRAND, 'Jansport/Eastpak - Associate Planner, eCommerce', 'USCA > USA > New Jersey > Jersey City - KIP')))
      .toBe('PORTAL_OWNER_NOT_CERTIFIED');
  });

  it('portail non relu (périmètre NULL) ou relu SINGLE_BRAND : aucune marque de groupe', async () => {
    await portail('levis', "Levi's", null);
    expect(await motif(offre('levis', 'x-4', 'Beyond Yoga', BRAND, 'Seasonal Sales Stylist, Beyond Yoga', 'Irvine, CA, USA'))).toBe('PORTAL_OWNER_NOT_CERTIFIED');
    await portail('levis', "Levi's", 'SINGLE_BRAND');
    expect(await motif(offre('levis', 'x-5', 'Beyond Yoga', BRAND, 'Seasonal Sales Stylist, Beyond Yoga', 'Irvine, CA, USA'))).toBe('PORTAL_OWNER_NOT_CERTIFIED');
  });
});

describe('une offre déjà publiée', () => {
  it('VF : publiée sous le groupe, elle rejoint la marque que son magasin nomme (précision, pas contradiction)', async () => {
    await portail('vf-corporation', 'VF Corporation', 'MULTI_BRAND');
    await db.company.create({ data: { name: 'VF Corporation', canonicalKey: 'VF', fashionjobsUrl: 'resolved:VF', kind: 'BRAND' } });
    const groupe = offre('vf-corporation', 'tnf-1', 'VF Corporation', GROUP, 'Store Supervisor', 'USCA > USA > Massachusetts > Peabody 039 - TNF');
    await upsertDeduplicated(db, groupe);
    expect((await employeurPublie('vf-corporation', 'tnf-1')).name).toBe('VF Corporation');
    const marque = offre('vf-corporation', 'tnf-1', 'The North Face', BRAND, 'The North Face: Supervisor - Peabody', 'USCA > USA > Massachusetts > Peabody 039 - TNF');
    await upsertDeduplicated(db, marque);
    expect(await employeurPublie('vf-corporation', 'tnf-1')).toEqual({ name: 'The North Face', fashionjobsUrl: 'resolved:THE_NORTH_FACE' });
  });

  it('publiée sous une AUTRE Maison que le groupe : la marque déduite ne la déplace jamais seule', async () => {
    await portail('nike-nke2', 'Nike', 'MULTI_BRAND');
    const autre = await db.company.create({ data: { name: 'Converse Inc.', canonicalKey: 'X', fashionjobsUrl: 'resolved:X-converse-inc' } });
    await upsertDeduplicated(db, offre('nike-nke2', 'c-1', 'NIKE', GROUP, 'Retail Associate', 'Tinton Falls, New Jersey'));
    const entree = await db.jobSource.findUniqueOrThrow({ where: { sourceKey_externalId: { sourceKey: 'nike-nke2', externalId: `c-1-${RUN}` } }, select: { jobId: true } });
    await db.job.update({ where: { id: entree.jobId! }, data: { companyId: autre.id } });
    expect(await motif(offre('nike-nke2', 'c-1', 'Converse', BRAND, 'Retail Associate, SEAS - Converse Jersey Shore', 'Tinton Falls, New Jersey')))
      .toBe('PORTAL_OWNER_REPLACES_EMPLOYER');
  });
});

describe('le domaine (logo) de la Maison créée suit la marque, jamais le groupe', () => {
  it('L’Oréal : « Kiehl’s » ne reçoit pas loreal.com ; l’offre sans marque, publiée sous le groupe, le reçoit', () => {
    const source = { key: 'l-oreal-professionnel', company: "L'Oréal", tier: 'EMPLOYER_DIRECT' as const, careersDomain: 'careers.loreal.com' };
    const brands = groupPortalBrands('l-oreal-professionnel', "L'Oréal (toutes Maisons)");
    const base = { url: 'https://careers.loreal.com/en_US/jobs/JobDetail/1', description: 'x' };
    const kiehls = employerFromCertifiedScope({ ...base, externalId: 'k-1', title: "Kiehl's Skin Pro (Beauty Advisor Douglas) – Groningen, 32 uur", raw: {} },
      "L'Oréal", 'MULTI_BRAND', brands);
    const groupe = employerFromCertifiedScope({ ...base, externalId: 'g-1', title: "[L'OREAL Taiwan] Commercial Controller", raw: {} }, "L'Oréal", 'MULTI_BRAND', brands);
    // Prémisse : le propriétaire du portail a bien un domaine déductible, celui qu'une marque hériterait à tort.
    expect(toCandidate(groupe, source, groupe.company || source.company, 'AVATURE').companyDomain).toBe('loreal.com');
    const candidate = toCandidate(kiehls, source, kiehls.company || source.company, 'AVATURE');
    expect(candidate).toMatchObject({ rawEmployerName: "Kiehl's", employerLabelOrigin: BRAND });
    expect(candidate.companyDomain).toBeUndefined();
  });
});
