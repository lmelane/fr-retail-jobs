import '../test/setup-integration.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { applySectorRecognition, previewSectorRecognition } from '../sectors/recognize.js';

const db = new PrismaClient();
const wipe = async () => { await db.jobSource.deleteMany(); await db.job.deleteMany(); await db.company.deleteMany(); };
beforeEach(wipe);
afterAll(async () => { await wipe(); await db.$disconnect(); });

/** Une Maison sans secteur dont l'ATS publie sa catégorie native d'employeur sur chacune de ses offres servies. */
async function fixture(industry = 'Apparel And Fashion') {
  const key = randomUUID();
  await db.source.create({ data: { key, maison: 'Alpha', kind: 'smartrecruiters-whitelabel', config: {}, tier: 'EMPLOYER_DIRECT', tenantKey: key, status: 'ACTIVE' } });
  const company = await db.company.create({ data: { name: 'Alpha', canonicalKey: 'ALPHA_TEST', fashionjobsUrl: key } });
  for (const id of ['1', '2', '3']) {
    const job = await db.job.create({ data: { companyId: company.id, externalId: id, source: 'GREENHOUSE', title: `Poste ${id}`, url: `https://ats.example/${id}` } });
    await db.jobSource.create({ data: { jobId: job.id, sourceKey: key, externalId: id, sourceTier: 'EMPLOYER_DIRECT', url: `https://ats.example/${id}`,
      raw: { id, industry: { id: 'x', label: industry } } } });
  }
  return { company, key };
}

describe('D-519 — qualify-sectors : aperçu relu, puis application de ce seul fichier', () => {
  it("l'aperçu n'écrit rien ; l'application écrit le secteur relu par la revue de secteur", async () => {
    const { company } = await fixture();
    const preview = await previewSectorRecognition(db);
    expect(preview.proposals).toMatchObject([{ id: company.id, codes: ['FASHION'], servies: 3 }]);
    expect((await db.company.findUniqueOrThrow({ where: { id: company.id } })).sectorCodes).toEqual([]);
    const applied = await applySectorRecognition(db, JSON.parse(JSON.stringify(preview)));
    expect(applied).toMatchObject({ proposals: 1, changed: 1 });
    const after = await db.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(after.sectorCodes).toEqual(['FASHION']);
    expect(after.sectorReviewId).toBeTruthy();
    // Appliqué : la reconnaissance recalculée ne propose plus rien, un second passage refuse sans rien écrire.
    await expect(applySectorRecognition(db, preview)).rejects.toThrow('REVIEWED_PLAN_MISMATCH');
  });
  it('refuse, sans rien écrire, un fichier retouché ou devenu périmé', async () => {
    const { company, key } = await fixture();
    const preview = await previewSectorRecognition(db);
    const tampered = { ...preview, proposals: preview.proposals.map(p => ({ ...p, codes: ['BEAUTY'] })) };
    await expect(applySectorRecognition(db, tampered)).rejects.toThrow('REVIEWED_PLAN_MISMATCH');
    // Le manifeste est ce qui s'écrit : le retoucher sans toucher aux propositions est refusé aussi (audit technique).
    const manifestOnly = { ...preview, manifest: { ...preview.manifest, companies: preview.manifest.companies.map(c => ({ ...c, codes: ['BEAUTY'],
      evidence: c.evidence.map(e => ({ ...e, code: 'BEAUTY' })) })) } };
    await expect(applySectorRecognition(db, manifestOnly)).rejects.toThrow('REVIEWED_PLAN_MISMATCH');
    const otherSource = { ...preview, manifest: { ...preview.manifest, companies: preview.manifest.companies.map(c => ({ ...c,
      evidence: c.evidence.map(e => ({ ...e, source: 'https://evil.example/x' })) })) } };
    await expect(applySectorRecognition(db, otherSource)).rejects.toThrow('REVIEWED_PLAN_MISMATCH');
    // La catégorie native change entre la relecture et l'application : le fichier relu ne vaut plus.
    await db.jobSource.updateMany({ where: { sourceKey: key }, data: { raw: { industry: { label: 'Cosmetics' } } } });
    await expect(applySectorRecognition(db, preview)).rejects.toThrow('REVIEWED_PLAN_MISMATCH');
    expect((await db.company.findUniqueOrThrow({ where: { id: company.id } })).sectorCodes).toEqual([]);
  });
});
