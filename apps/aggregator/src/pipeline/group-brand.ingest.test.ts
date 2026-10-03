import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resolveEmployer } from '../identity/resolve.js';
import { EmployerIdentityReviewRequired } from '../identity/errors.js';
import { CERTIFIED_SCOPE_PATH, GROUP_BRAND_PATH, GROUP_BRAND_RULE, GROUP_LICENCE_RULE, GROUP_OUT_OF_PERIMETER_HOLD, GROUP_SCOPE_RULE,
  employerFromCertifiedScope } from '../identity/portalEmployer.js';
import { sourceScopedKey } from '../identity/existingMaison.js';
import { sourcePublishesEmployer } from '../identity/publisherFollow.js';
import { isNativeOrigin } from '../identity/ordinaryIdentity.js';
import { archivePublicationHold } from '../test/publicationPersistenceFixture.js';
import { groupPortalBrands } from '../identity/groupBrands.js';
import { postingLabelOrigin, toCandidate } from './ingest.js';
import type { CandidateJob } from '../dedup/match.js';

/**
 * D-522 §6 — LA CHAÎNE JUSQU'À LA PUBLICATION, R-142 §3 sur un portail relu MULTI_BRAND : la marque que l'offre nomme
 * (liste fermée du groupe, `identity/groupBrands.ts`), sinon le groupe. Le résolveur ne croit pas la marque portée par
 * la candidate : il la relit sur l'offre même, contre la liste du portail relu, et refuse tout écart.
 * Les intitulés et lieux sont ceux des sorties réelles du RUN du 02/10/2026 (`identity/__fixtures__/group-brands-20261002.json`).
 */
const db = new PrismaClient();
// Les observations d'employeur sont immuables (déclencheur) : chaque offre porte un identifiant propre au passage.
beforeEach(async () => { await db.companyAlias.deleteMany(); await db.jobEvent.deleteMany(); await db.jobSource.deleteMany(); await db.job.deleteMany(); await db.company.deleteMany(); });
afterAll(() => db.$disconnect());

const RUN = randomUUID().slice(0, 8);
const BRAND = `${GROUP_BRAND_PATH}:${GROUP_BRAND_RULE}`;
const GROUP = `${CERTIFIED_SCOPE_PATH}:${GROUP_SCOPE_RULE}`;
const LICENCE = `${CERTIFIED_SCOPE_PATH}:${GROUP_LICENCE_RULE}`;

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

  it('aucune marque nommée : publiée sous le NOM DU GROUPE (« Levi Strauss & Co. », créée sous sa clé), jamais sous « Levi’s »', async () => {
    await portail('levis', "Levi's", 'MULTI_BRAND');
    await db.company.create({ data: { name: "Levi's", canonicalKey: 'LEVI_S', fashionjobsUrl: 'resolved:LEVI_S' } });
    const c = offre('levis', 'ls-1', 'Levi Strauss & Co.', GROUP, 'Sales Stylist', 'LS MUENSTER ARKADEN, Münster, Germany');
    expect(await resoudre(c)).toMatchObject({ rule: 'MULTI_BRAND_PORTAL_GROUP_OWNER', newKey: 'LEVI_STRAUSS', newName: 'Levi Strauss & Co.' });
    await upsertDeduplicated(db, c);
    expect(await employeurPublie('levis', 'ls-1')).toEqual({ name: 'Levi Strauss & Co.', fashionjobsUrl: 'resolved:LEVI_STRAUSS' });
  });

  it('groupe existant au registre : Movado → « Movado Group » ; Nike → NIKE (alias relu « nike, inc. ») ; L’Oréal → « L’Oréal Groupe »', async () => {
    await portail('movado', 'Movado', 'MULTI_BRAND');
    await db.company.create({ data: { name: 'Movado', canonicalKey: 'MOVADO', fashionjobsUrl: 'resolved:MOVADO' } });
    const movadoGroup = await db.company.create({ data: { name: 'Movado Group', canonicalKey: 'MOVADO_GROUP', fashionjobsUrl: 'resolved:MOVADO_GROUP' } });
    expect((await resoudre(offre('movado', 'm-1', 'Movado Group', GROUP, 'Temporary Distribution Clerk', 'Moonachie, NJ'))).company?.id).toBe(movadoGroup.id);

    await portail('nike', 'Nike', 'MULTI_BRAND');
    const nike = await db.company.create({ data: { name: 'NIKE', canonicalKey: 'NIKE', fashionjobsUrl: 'resolved:NIKE' } });
    await db.company.create({ data: { name: 'NIKE, Inc.', canonicalKey: 'NIKE_INC', fashionjobsUrl: 'resolved:NIKE_INC' } });
    const review = await db.employerIdentityReview.create({ data: { id: `rev-${RUN}`, statement: 'test', evidence: {}, planHash: 'x', reviewedBy: 't', reviewedAt: new Date() } });
    await db.companyAlias.create({ data: { aliasKey: `nike-inc-${RUN}`, displayName: 'NIKE, Inc.', companyId: nike.id, sourceKey: 'nike', normalizedName: 'nike, inc.', reviewId: review.id } });
    expect((await resoudre(offre('nike', 'n-1', 'Nike, Inc.', GROUP, 'Lead Business Planner', 'Beaverton, Oregon'))).company?.id).toBe(nike.id);

    await portail('l-oreal-professionnel', "L'Oréal (toutes Maisons)", 'MULTI_BRAND');
    await db.company.create({ data: { name: "L'Oréal", canonicalKey: 'LOREAL', fashionjobsUrl: 'resolved:LOREAL', kind: 'GROUP' } });
    const groupe = await db.company.create({ data: { name: "L'Oréal Groupe", canonicalKey: 'L_OREAL_GROUPE', fashionjobsUrl: 'resolved:L_OREAL_GROUPE' } });
    const c = offre('l-oreal-professionnel', 'g-1', "L'Oréal Groupe", GROUP, "[L'OREAL Taiwan] Commercial Controller", 'Taipei');
    expect((await resoudre(c)).company?.id).toBe(groupe.id);
    await upsertDeduplicated(db, c);
    expect((await employeurPublie('l-oreal-professionnel', 'g-1')).name).toBe("L'Oréal Groupe");
  });

  it('Aesop : la marque prouvée publie sous la Maison que la source porte déjà (clé de libellé), jamais une seconde « Aesop »', async () => {
    await portail('l-oreal-professionnel', "L'Oréal (toutes Maisons)", 'MULTI_BRAND');
    const aesop = await db.company.create({ data: { name: 'Aesop', canonicalKey: sourceScopedKey('l-oreal-professionnel', 'aesop'),
      fashionjobsUrl: `resolved:${sourceScopedKey('l-oreal-professionnel', 'aesop')}` } });
    const c = offre('l-oreal-professionnel', 'a-1', 'Aesop', BRAND, 'Aesop Store Manager | Leeds | Full Time', 'Leeds');
    expect((await resoudre(c)).company?.id).toBe(aesop.id);
    await upsertDeduplicated(db, c);
    expect(await db.company.count({ where: { name: 'Aesop' } })).toBe(1);
    expect((await employeurPublie('l-oreal-professionnel', 'a-1')).fashionjobsUrl).toBe(aesop.fashionjobsUrl);
  });

  it('licence : une offre L’Oréal publiée sous PRADA rejoint L’Oréal Groupe ; une offre publiée sous une autre Maison, jamais', async () => {
    await portail('l-oreal-professionnel', "L'Oréal (toutes Maisons)", 'MULTI_BRAND');
    const prada = await db.company.create({ data: { name: 'PRADA', canonicalKey: 'PRADA', fashionjobsUrl: 'resolved:PRADA' } });
    const groupe = await db.company.create({ data: { name: "L'Oréal Groupe", canonicalKey: 'L_OREAL_GROUPE', fashionjobsUrl: 'resolved:L_OREAL_GROUPE' } });
    // Comme à l'ingestion : la clé d'indice est celle du registre pour « Prada » (`resolveCompany`), d'où PRADA aujourd'hui.
    const natif = { ...offre('l-oreal-professionnel', 'p-1', 'Prada', 'dataLayer.jobBrand:EXPLICIT_JOB_BRAND', 'Prada Beauty Advisor, Harrods London (37.5 Hours)', 'London'), companyId: 'PRADA' };
    await upsertDeduplicated(db, natif);
    expect((await employeurPublie('l-oreal-professionnel', 'p-1')).name).toBe('PRADA');
    const licence = offre('l-oreal-professionnel', 'p-1', "L'Oréal Groupe", LICENCE, 'Prada Beauty Advisor, Harrods London (37.5 Hours)', 'London');
    await upsertDeduplicated(db, licence);
    expect((await employeurPublie('l-oreal-professionnel', 'p-1')).name).toBe("L'Oréal Groupe");
    expect(prada.id).not.toBe(groupe.id);
    // Une offre déjà sous une autre Maison (qui n'est pas une licence de la liste) n'est pas déplacée par cette règle.
    const autre = await db.company.create({ data: { name: 'Saloncentric', canonicalKey: 'SALONCENTRIC', fashionjobsUrl: 'resolved:SALONCENTRIC' } });
    await upsertDeduplicated(db, { ...offre('l-oreal-professionnel', 's-1', 'Saloncentric', 'dataLayer.jobBrand:EXPLICIT_JOB_BRAND', 'Sales Consultant', 'Dallas'), companyId: 'SALONCENTRIC' });
    expect((await employeurPublie('l-oreal-professionnel', 's-1')).name).toBe(autre.name);
    expect(await motif(offre('l-oreal-professionnel', 's-1', "L'Oréal Groupe", LICENCE, 'Sales Consultant', 'Dallas'))).toBe('PORTAL_OWNER_REPLACES_EMPLOYER');
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

describe('D-506 §3 : une marque déduite ne témoigne jamais pour le suivi de l’éditeur', () => {
  it('la carte de la collecte ne garde que les libellés natifs', () => {
    const brand = employerFromCertifiedScope({ externalId: 'x', title: 'Vans: Supervisor - Peabody', url: 'https://x', raw: { title: 'Vans: Supervisor - Peabody' },
      publicationHold: 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL' }, 'VF Corporation', 'MULTI_BRAND', groupPortalBrands('vf-corporation', 'VF Corporation'));
    expect(brand.employerEvidence?.path).toBe(GROUP_BRAND_PATH);
    expect(isNativeOrigin(postingLabelOrigin(brand))).toBe(false);
    expect(isNativeOrigin(postingLabelOrigin({ employerEvidence: { rawName: 'Vans', path: 'detail.jobPostingInfo.logoImage.alt', rule: 'LOGO_ALT' } }))).toBe(true);
  });
  it('une observation antérieure d’origine « liste du groupe » ne prouve pas que la source publie l’employeur', async () => {
    const vans = await db.company.create({ data: { name: 'Vans', canonicalKey: 'VANS', fashionjobsUrl: 'resolved:VANS' } });
    const before = new Date(Date.now() + 60_000);
    const observe = (id: string, labelOrigin: string) => db.employerObservation.create({ data: { sourceKey: 'vf-corporation', externalId: `${id}-${RUN}`,
      observationHash: `${id}-${RUN}-${labelOrigin}`, rawEmployerName: 'Vans', labelOrigin, normalizedEmployerName: 'vans', canonicalEmployerId: vans.id,
      rule: 'MULTI_BRAND_PORTAL_GROUP_BRAND', pipelineVersion: 1 } });
    await observe('w-brand', BRAND);
    expect(await db.$transaction(tx => sourcePublishesEmployer(tx, 'vf-corporation', [`w-brand-${RUN}`], 'vans', vans.id, before))).toBe(false);
    await observe('w-native', 'detail.jobPostingInfo.logoImage.alt:LOGO_ALT');
    expect(await db.$transaction(tx => sourcePublishesEmployer(tx, 'vf-corporation', [`w-native-${RUN}`], 'vans', vans.id, before))).toBe(true);
  });
});

describe('groupe Prada : Marchesi 1824 retenue hors périmètre, aucune Maison créée', () => {
  const marchesi = (id: string, title: string) => ({ externalId: `${id}-${RUN}`, title, url: `https://jobs.pradagroup.com/job/${id}-${RUN}/`, location: 'Milano, IT',
    company: 'Marchesi 1824', employerEvidence: { rawName: 'Marchesi 1824', path: 'listing.facility', rule: 'CONFIGURED_BRAND_PROPERTY' },
    raw: { title, listingBrand: { property: 'facility', value: 'Marchesi 1824' } }, description: 'x' });
  it('la retenue s’archive sous le périmètre courant du portail, la représentation est retirée, aucune Maison n’apparaît', async () => {
    await portail('prada-group', 'Prada Group', 'MULTI_BRAND');
    const at = new Date(Date.now() - 60_000);
    const held = employerFromCertifiedScope(marchesi('mc-1', 'Catering Supervisor'), 'Prada Group', 'MULTI_BRAND', groupPortalBrands('prada-group', 'Prada Group'), at);
    expect(held).toMatchObject({ publicationHold: GROUP_OUT_OF_PERIMETER_HOLD, publicationWithdrawnAt: at });
    await archivePublicationHold(db, 'prada-group', held);
    expect(await db.company.count({ where: { name: { contains: 'Marchesi', mode: 'insensitive' } } })).toBe(0);
    expect(await db.jobSource.count({ where: { sourceKey: 'prada-group', externalId: `mc-1-${RUN}` } })).toBe(0);
  });
  it('si le portail n’est plus relu MULTI_BRAND, la retenue n’est plus courante : refusée', async () => {
    await portail('prada-group', 'Prada Group', null);
    const held = { ...marchesi('mc-2', 'Quality Manager'), publicationHold: GROUP_OUT_OF_PERIMETER_HOLD, publicationWithdrawnAt: new Date(Date.now() - 60_000) };
    await expect(archivePublicationHold(db, 'prada-group', held)).rejects.toThrow('Group perimeter hold is no longer current');
  });
});

describe('groupe Prada : la colonne « Brand » précise une offre publiée sous le groupe', () => {
  const ligne = (id: string, title: string, brand: string) => ({ ...offre('prada-group', id, brand, 'listing.facility:CONFIGURED_BRAND_PROPERTY', title, 'Milano, IT'),
    companyId: brand === 'Prada' ? 'PRADA' : brand === 'Prada Group' ? 'PRADA_GROUP' : 'CHURCH_S', raw: { title, listingBrand: { property: 'facility', value: brand } } });
  it('relu MULTI_BRAND : « Prada » rejoint PRADA, « Church’s » rejoint sa Maison créée, sans revue', async () => {
    await portail('prada-group', 'Prada Group', 'MULTI_BRAND');
    const groupe = await db.company.create({ data: { name: 'Prada Group', canonicalKey: 'PRADA_GROUP', fashionjobsUrl: 'resolved:PRADA_GROUP' } });
    const prada = await db.company.create({ data: { name: 'PRADA', canonicalKey: 'PRADA', fashionjobsUrl: 'resolved:PRADA' } });
    for (const [id, title] of [['h-1', 'Hostess, Milan'], ['c-1', 'In Store Artisan']]) await upsertDeduplicated(db, ligne(id, title, 'Prada Group'));
    expect((await employeurPublie('prada-group', 'h-1')).name).toBe(groupe.name);
    await upsertDeduplicated(db, ligne('h-1', 'Hostess, Milan', 'Prada'));
    expect((await employeurPublie('prada-group', 'h-1')).name).toBe(prada.name);
    await upsertDeduplicated(db, ligne('c-1', 'In Store Artisan', "Church's"));
    expect((await employeurPublie('prada-group', 'c-1')).name).toBe("Church's");
    expect(await db.company.count({ where: { name: { in: ['PRADA', "Church's"] } } })).toBe(2);
  });
  it('portail non relu : la même transition reste une divergence en revue', async () => {
    await portail('prada-group', 'Prada Group', null);
    await db.company.create({ data: { name: 'Prada Group', canonicalKey: 'PRADA_GROUP', fashionjobsUrl: 'resolved:PRADA_GROUP' } });
    await db.company.create({ data: { name: 'PRADA', canonicalKey: 'PRADA', fashionjobsUrl: 'resolved:PRADA' } });
    await upsertDeduplicated(db, ligne('h-2', 'Hostess, Milan', 'Prada Group'));
    expect(await motif(ligne('h-2', 'Hostess, Milan', 'Prada'))).toBe('EMPLOYER_SPELLING_DIVERGED');
  });
});
