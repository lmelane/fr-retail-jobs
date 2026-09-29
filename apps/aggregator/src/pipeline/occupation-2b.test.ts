import "../test/setup-integration.js";
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { compileOccupationManifest, occupationManifestHash } from "@catwalks/db/occupations";
import seed from "../../../../packages/db/data/occupations-v1.json" with { type: "json" };
import { classifyJobs } from "./classifyJobs.js";
import { activateOccupationRelease, previewOccupationRelease } from "../occupation/release.js";

/**
 * Lot 2B de D-475 (plan docs/architecture/classification-metiers.md §3.1, §3.3) : les colonnes additives et leurs
 * gardes en base. Chaque témoin écrit d'abord une valeur VALIDE (la prémisse : la garde ne refuse pas tout), puis ce que
 * la garde doit refuser ou recalculer.
 */
const db = new PrismaClient();
const release = compileOccupationManifest(seed).manifest;
const autreTaxonomie = { ...release, id: `${release.id}-autre-temoin` };
let suffixe = 0;
const unique = (p: string) => `${p}-${Date.now()}-${++suffixe}`;

async function publier(manifest: typeof release) {
  if (!(await db.occupationRelease.findUnique({ where: { id: manifest.id } })))
    await db.occupationRelease.create({
      data: { id: manifest.id, contentHash: occupationManifestHash(manifest), manifest: manifest as unknown as Prisma.InputJsonValue },
    });
}
async function preparer() {
  await publier(release);
  await db.occupationState.update({ where: { id: "active" }, data: { releaseId: release.id, backfilledAt: null } });
  await db.occupationLearnedState.update({ where: { id: "active" }, data: { releaseId: null } });
  await db.jobSource.deleteMany();
  await db.job.deleteMany();
  await db.$executeRaw`DELETE FROM "DirectOffer" WHERE id LIKE 'lot-2b-%'`;
  await db.company.deleteMany();
  const company = await db.company.create({ data: { name: "Lot 2B", canonicalKey: "lot-2b", fashionjobsUrl: "resolved:lot-2b" } });
  await db.job.create({
    data: { id: "lot-2b-vendeur", companyId: company.id, externalId: "lot-2b-vendeur", source: "GENERIC_JSONLD", title: "Sales Advisor", url: "https://careers.example/lot-2b" },
  });
  await classifyJobs(db, { batchSize: 10 });
}
beforeEach(preparer);
afterAll(async () => {
  await db.job.deleteMany();
  await db.$executeRaw`DELETE FROM "DirectOffer" WHERE id LIKE 'lot-2b-%'`;
  await db.company.deleteMany();
  await db.$disconnect();
});
const groupeDe = (famille: string) => release.families.find((f) => f.key === famille)!.group!;
const familleDe = (metier: string) => release.occupations.find((o) => o.key === metier)!.family!;
const offreCatwalks = (id: string, metier: string | null) => db.$executeRaw`INSERT INTO "DirectOffer"
  (id, version, "appliedSeq", eligible, "payloadHash", payload, "correspondanceVersion", slug, title, company, location, description, "applyUrl", "postedAt", "modifiedAt", "updatedAt", "occupationCode", "occupationReleaseId")
  VALUES (${id}, 1, 1, true, 'h', '{}'::jsonb, 1, ${id}, 'Sales Advisor', 'Maison', 'Paris', 'd', 'https://catwalks.example', now(), now(), now(), ${metier}, ${metier ? release.id : null})`;

describe("lot 2B : clés par version, rôles lus dans le titre, domaine calculé", () => {
  it("les clés d'une version sont indexées à sa publication", async () => {
    const n = await db.occupationReleaseConcept.count({ where: { releaseId: release.id, kind: "occupation" } });
    expect(n).toBe(release.occupations.length);
    await publier(autreTaxonomie);
    expect(await db.occupationReleaseConcept.count({ where: { releaseId: autreTaxonomie.id, kind: "family" } })).toBe(release.families.length);
    // Une clé forgée hors publication ferait accepter un métier inconnu ; la table ne se vide pas.
    await expect(db.$executeRaw`INSERT INTO "OccupationReleaseConcept" ("releaseId","kind","key","family") VALUES (${release.id},'occupation','metier-forge','retail-client-advisor')`)
      .rejects.toThrow(/only by publishing/);
    await expect(db.$executeRaw`TRUNCATE "OccupationReleaseConcept"`).rejects.toThrow(/immutable/);
  });

  it("un rôle lu porte la version qui l'a lu, et appartient à ses métiers (Job et offre Catwalks)", async () => {
    await db.$executeRaw`UPDATE "Job" SET "titleRoles"='{sales-advisor}', "titleRolesReleaseId"=${release.id} WHERE id='lot-2b-vendeur'`;
    expect((await db.job.findUniqueOrThrow({ where: { id: "lot-2b-vendeur" } })).titleRoles).toEqual(["sales-advisor"]);
    await expect(db.$executeRaw`UPDATE "Job" SET "titleRolesReleaseId"=NULL WHERE id='lot-2b-vendeur'`).rejects.toThrow(/job_title_roles_versioned/);
    await expect(db.$executeRaw`UPDATE "Job" SET "titleRoles"='{metier-inexistant}' WHERE id='lot-2b-vendeur'`).rejects.toThrow(/unknown to release/);
    const id = unique("lot-2b-direct");
    await offreCatwalks(id, "sales-advisor");
    await db.$executeRaw`UPDATE "DirectOffer" SET "titleRoles"='{sales-advisor}', "titleRolesReleaseId"=${release.id} WHERE id=${id}`;
    await expect(db.$executeRaw`UPDATE "DirectOffer" SET "titleRoles"='{metier-inexistant}' WHERE id=${id}`).rejects.toThrow(/unknown to release/);
  });

  it("le domaine est calculé : un reclassement d'une famille à une autre passe, une valeur écrite à la main est remplacée", async () => {
    const avant = await db.job.findUniqueOrThrow({ where: { id: "lot-2b-vendeur" } });
    expect(avant.occupationDomain).toBe(groupeDe(avant.jobFunction!));
    const autre = release.occupations.find((o) => groupeDe(o.family!) !== avant.occupationDomain)!;
    expect(groupeDe(autre.family!)).not.toBe(avant.occupationDomain);
    // Un écrivain comme batch.ts : il reclasse sans écrire le domaine.
    await db.$executeRaw`UPDATE "Job" SET "occupationCode"=${autre.key}, "jobFunction"=${autre.family} WHERE id='lot-2b-vendeur'`;
    expect((await db.job.findUniqueOrThrow({ where: { id: "lot-2b-vendeur" } })).occupationDomain).toBe(groupeDe(autre.family!));
    await db.$executeRaw`UPDATE "Job" SET "occupationDomain"='domaine-faux' WHERE id='lot-2b-vendeur'`;
    expect((await db.job.findUniqueOrThrow({ where: { id: "lot-2b-vendeur" } })).occupationDomain).toBe(groupeDe(autre.family!));
    await db.$executeRaw`UPDATE "Job" SET "occupationCode"=NULL, "jobFunction"=NULL, "occupationStatus"='PENDING', "occupationReleaseId"=NULL WHERE id='lot-2b-vendeur'`;
    expect((await db.job.findUniqueOrThrow({ where: { id: "lot-2b-vendeur" } })).occupationDomain).toBeNull();
    const id = unique("lot-2b-direct");
    await offreCatwalks(id, "sales-advisor");
    const [offre] = await db.$queryRaw<{ occupationDomain: string | null }[]>`SELECT "occupationDomain" FROM "DirectOffer" WHERE id=${id}`;
    expect(offre.occupationDomain).toBe(groupeDe(familleDe("sales-advisor")));
    await expect(offreCatwalks(unique("lot-2b-direct"), "metier-inexistant")).rejects.toThrow(/unknown to release/);
  });
});

describe("lot 2B : table apprise scellée, rattachée à sa taxonomie", () => {
  const versionApprise = async (taxonomie: string, entrees: [string, string][]) => {
    const id = unique("appris");
    await db.$transaction([
      db.occupationLearnedRelease.create({ data: { id, taxonomyReleaseId: taxonomie, contentHash: id, entryCount: entrees.length, receipt: { temoin: true } } }),
      ...entrees.map(([titleKey, occupationCode]) => db.occupationLearnedEntry.create({ data: { releaseId: id, titleKey, occupationCode, evidence: {} } })),
    ]);
    return id;
  };

  it("une version est scellée : rien ne s'y ajoute, ne s'y modifie, ne s'efface ni ne se vide", async () => {
    const id = await versionApprise(release.id, [["VENDEUR", "sales-advisor"]]);
    await expect(db.occupationLearnedEntry.create({ data: { releaseId: id, titleKey: "CAISSIER", occupationCode: "cashier", evidence: {} } })).rejects.toThrow(/sealed/);
    await expect(versionApprise(release.id, [["INCONNU", "metier-inexistant"]])).rejects.toThrow(/unknown to the taxonomy/);
    await expect(db.$executeRaw`UPDATE "OccupationLearnedEntry" SET "occupationCode"='cashier' WHERE "releaseId"=${id}`).rejects.toThrow(/immutable/);
    await expect(db.$executeRaw`DELETE FROM "OccupationLearnedRelease" WHERE id=${id}`).rejects.toThrow(/immutable/);
    await expect(db.$executeRaw`TRUNCATE "OccupationLearnedEntry"`).rejects.toThrow(/immutable/);
    expect(await db.occupationLearnedEntry.count({ where: { releaseId: id } })).toBe(1);
  });

  it("l'état actif n'active qu'une table de la taxonomie active, sans remettre l'index de recherche en file", async () => {
    const id = await versionApprise(release.id, [["VENDEUR", "sales-advisor"]]);
    const revision = async () => (await db.$queryRaw<{ revision: bigint }[]>`SELECT revision FROM "SearchMetadata" WHERE id='active'`)[0]?.revision ?? 0n;
    const r0 = await revision();
    await db.occupationLearnedState.update({ where: { id: "active" }, data: { releaseId: id } });
    expect(await revision()).toBe(r0);
    // Témoin positif : une écriture dans OccupationState, elle, fait avancer la révision de l'index.
    await db.occupationState.update({ where: { id: "active" }, data: { backfilledAt: null } });
    expect(await revision()).toBeGreaterThan(r0);
    await publier(autreTaxonomie);
    const etrangere = await versionApprise(autreTaxonomie.id, [["VENDEUR", "sales-advisor"]]);
    await expect(db.occupationLearnedState.update({ where: { id: "active" }, data: { releaseId: etrangere } })).rejects.toThrow(/active taxonomy/);
  });

  it("activer une nouvelle taxonomie remet la table apprise active à vide, et le reçu le dit", async () => {
    const id = await versionApprise(release.id, [["VENDEUR", "sales-advisor"]]);
    await db.occupationLearnedState.update({ where: { id: "active" }, data: { releaseId: id } });
    const suivante = { ...structuredClone(seed), id: `${seed.id}-suivante-${Date.now()}` };
    const revue = await previewOccupationRelease(db, suivante);
    await activateOccupationRelease(db, suivante, revue, "a".repeat(40));
    expect((await db.occupationLearnedState.findUniqueOrThrow({ where: { id: "active" } })).releaseId).toBeNull();
    const recu = await db.dataCorrection.findFirstOrThrow({ where: { batchId: `occupation-release:${suivante.id}` } });
    expect(recu.before).toMatchObject({ learnedReleaseId: id });
  });

  it("une décision apprise porte sa table, et cette table vient de la taxonomie de la décision", async () => {
    const id = await versionApprise(release.id, [["VENDEUR", "sales-advisor"]]);
    await db.$executeRaw`UPDATE "Job" SET "occupationLearnedReleaseId"=${id}, "occupationDecisionSource"='learned' WHERE id='lot-2b-vendeur'`;
    await expect(db.$executeRaw`UPDATE "Job" SET "occupationLearnedReleaseId"=NULL WHERE id='lot-2b-vendeur'`).rejects.toThrow(/job_learned_decision_versioned/);
    await publier(autreTaxonomie);
    const etrangere = await versionApprise(autreTaxonomie.id, [["VENDEUR", "sales-advisor"]]);
    await expect(db.$executeRaw`UPDATE "Job" SET "occupationLearnedReleaseId"=${etrangere} WHERE id='lot-2b-vendeur'`).rejects.toThrow(/does not belong to taxonomy/);
    await expect(db.$executeRaw`UPDATE "Job" SET "occupationDecisionSource"='devine' WHERE id='lot-2b-vendeur'`).rejects.toThrow(/job_occupation_source/);
  });
});
