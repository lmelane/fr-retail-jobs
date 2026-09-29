import "../test/setup-integration.js";
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { compileOccupationManifest, occupationManifestHash } from "@catwalks/db/occupations";
import seed from "../../../../packages/db/data/occupations-v1.json" with { type: "json" };
import { classifyJobs } from "./classifyJobs.js";

/**
 * Lot 2B de D-475 (plan docs/architecture/classification-metiers.md §3.1, §3.3) : les colonnes additives et leurs
 * gardes en base. Chaque témoin écrit d'abord une valeur VALIDE (la prémisse : la garde ne refuse pas tout), puis la
 * valeur que la garde doit refuser.
 */
const db = new PrismaClient();
const release = compileOccupationManifest(seed).manifest;

async function preparer() {
  if (!(await db.occupationRelease.findUnique({ where: { id: release.id } })))
    await db.occupationRelease.create({
      data: { id: release.id, contentHash: occupationManifestHash(release), manifest: release as unknown as Prisma.InputJsonValue },
    });
  await db.occupationState.update({ where: { id: "active" }, data: { releaseId: release.id, backfilledAt: null } });
  await db.jobSource.deleteMany();
  await db.job.deleteMany();
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
  await db.company.deleteMany();
  await db.$disconnect();
});

describe("lot 2B : rôles lus dans le titre, domaine, table apprise", () => {
  it("un rôle lu porte la version qui l'a lu, et appartient à ses métiers", async () => {
    await db.$executeRaw`UPDATE "Job" SET "titleRoles"='{sales-advisor}', "titleRolesReleaseId"=${release.id} WHERE id='lot-2b-vendeur'`;
    expect((await db.job.findUniqueOrThrow({ where: { id: "lot-2b-vendeur" } })).titleRoles).toEqual(["sales-advisor"]);
    await expect(db.$executeRaw`UPDATE "Job" SET "titleRolesReleaseId"=NULL WHERE id='lot-2b-vendeur'`).rejects.toThrow(/job_title_roles_versioned/);
    await expect(db.$executeRaw`UPDATE "Job" SET "titleRoles"='{metier-inexistant}' WHERE id='lot-2b-vendeur'`).rejects.toThrow(/unknown to release/);
  });

  it("le domaine est celui de la famille dans la version citée", async () => {
    const job = await db.job.findUniqueOrThrow({ where: { id: "lot-2b-vendeur" } });
    expect(job.occupationCode).toBe("sales-advisor");
    const groupe = release.families.find((f) => f.key === job.jobFunction)!.group!;
    await db.$executeRaw`UPDATE "Job" SET "occupationDomain"=${groupe} WHERE id='lot-2b-vendeur'`;
    const autre = release.groups.find((g) => g.key !== groupe)!.key;
    await expect(db.$executeRaw`UPDATE "Job" SET "occupationDomain"=${autre} WHERE id='lot-2b-vendeur'`).rejects.toThrow(/domain\/family mismatch/);
    await expect(db.$executeRaw`UPDATE "Job" SET "occupationDomain"='domaine-inexistant', "jobFunction"=NULL, "occupationCode"=NULL, "occupationStatus"='NO_RULE' WHERE id='lot-2b-vendeur'`).rejects.toThrow(/domain unknown/);
  });

  it("la table apprise est immuable et ne désigne que des métiers de sa taxonomie", async () => {
    const id = `appris-${Date.now()}`;
    await db.occupationLearnedRelease.create({
      data: { id, taxonomyReleaseId: release.id, contentHash: id, receipt: { temoin: true } },
    });
    await db.occupationLearnedEntry.create({ data: { releaseId: id, titleKey: "VENDEUR", occupationCode: "sales-advisor", evidence: {} } });
    await expect(db.occupationLearnedEntry.create({ data: { releaseId: id, titleKey: "INCONNU", occupationCode: "metier-inexistant", evidence: {} } }))
      .rejects.toThrow(/unknown to the taxonomy/);
    await expect(db.$executeRaw`UPDATE "OccupationLearnedEntry" SET "occupationCode"='cashier' WHERE "releaseId"=${id}`).rejects.toThrow(/immutable/);
    await expect(db.$executeRaw`DELETE FROM "OccupationLearnedRelease" WHERE id=${id}`).rejects.toThrow(/immutable/);
    // La version active vit à part : l'avancer n'écrit pas dans OccupationState (qui remet tout l'index en file).
    await db.occupationLearnedState.update({ where: { id: "active" }, data: { releaseId: id } });
    await db.occupationLearnedState.update({ where: { id: "active" }, data: { releaseId: null } });
    await expect(db.$executeRaw`INSERT INTO "OccupationLearnedState" (id) VALUES ('second')`).rejects.toThrow(/occupation_learned_state_single/);
  });
});
