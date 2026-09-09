import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
export type SectorEvidence = {
  code: string;
  source: string;
  statement: string;
  confidence: "HIGH" | "MEDIUM";
  basis: "OFFICIAL_SOURCE" | "REFERENCE_LIST";
  checkedAt: string;
};
export type SectorDefinition = {
  code: string;
  slug: string;
  labels: { fr: string; en: string };
  definition: string;
  position: number;
};
export type SectorManifest = {
  reviewer: string;
  concepts?: SectorDefinition[];
  companies: {
    id: string;
    canonicalKey: string;
    codes: string[];
    evidence: SectorEvidence[];
  }[];
};
const stable = (v: any): any =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable(v[k])]),
        )
      : v;
export const sectorHash = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(stable(v)))
    .digest("hex");
export function validateSectorManifest(raw: unknown): SectorManifest {
  const m = raw as SectorManifest;
  if (
    !m ||
    typeof m.reviewer !== "string" ||
    !m.reviewer.trim() ||
    !Array.isArray(m.companies) ||
    m.companies.length > 10000
  )
    throw Error("Invalid sector manifest");
  if (m.concepts) {
    if (
      !Array.isArray(m.concepts) ||
      new Set(m.concepts.map((c) => c.code)).size !== m.concepts.length
    )
      throw Error("Duplicate sector definitions");
    for (const c of m.concepts)
      if (
        !/^[A-Z][A-Z0-9_]{0,79}$/.test(c.code) ||
        !/^[-a-z0-9]+$/.test(c.slug) ||
        !c.labels?.fr?.trim() ||
        !c.labels?.en?.trim() ||
        !c.definition?.trim() ||
        !Number.isSafeInteger(c.position)
      )
        throw Error("Invalid localized sector definition");
  }
  const ids = new Set<string>();
  for (const c of m.companies) {
    if (
      !c.id ||
      !c.canonicalKey ||
      ids.has(c.id) ||
      !Array.isArray(c.codes) ||
      new Set(c.codes).size !== c.codes.length ||
      !Array.isArray(c.evidence)
    )
      throw Error("Invalid or duplicate employer membership");
    ids.add(c.id);
    if (c.codes.some((code) => !/^[A-Z][A-Z0-9_]{0,79}$/.test(code)))
      throw Error("Invalid sector code");
    if (
      c.evidence.some(
        (e) =>
          !c.codes.includes(e.code) ||
          !["HIGH", "MEDIUM"].includes(e.confidence) ||
          !["OFFICIAL_SOURCE", "REFERENCE_LIST"].includes(e.basis) ||
          !/^https?:\/\//.test(e.source) ||
          !e.statement?.trim() ||
          Number.isNaN(Date.parse(e.checkedAt)),
      )
    )
      throw Error("Invalid sector evidence");
    if (c.codes.some((code) => !c.evidence.some((e) => e.code === code)))
      throw Error("Every sector needs evidence");
  }
  return m;
}
async function inspect(tx: Prisma.TransactionClient, m: SectorManifest) {
  const concepts = await tx.sectorConcept.findMany({
    orderBy: { code: "asc" },
  });
  const conceptChanges = (m.concepts ?? []).filter((c) => {
    const previous = concepts.find((p) => p.code === c.code);
    if (
      previous &&
      (previous.definition !== c.definition || previous.slug !== c.slug)
    )
      throw Error("Sector identity is immutable; publish a new concept");
    return !previous || sectorHash(previous) !== sectorHash(c);
  });
  const codes = new Set(
    [...concepts, ...(m.concepts ?? [])].map((c) => c.code),
  );
  if (m.companies.some((c) => c.codes.some((code) => !codes.has(code))))
    throw Error("Unknown concept: add the reviewed definition first");
  const before = await tx.company.findMany({
    where: { id: { in: m.companies.map((c) => c.id) } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      canonicalKey: true,
      mergedIntoId: true,
      sectorCodes: true,
      sectorEvidence: true,
      sectorReviewId: true,
    },
  });
  for (const c of m.companies) {
    const prev = before.find((p) => p.id === c.id);
    if (!prev || prev.mergedIntoId || prev.canonicalKey !== c.canonicalKey)
      throw Error(`Employer identity changed or unresolved: ${c.id}`);
  }
  const changed = m.companies.filter((c) => {
    const old = before.find((p) => p.id === c.id)!;
    return (
      sectorHash([old.sectorCodes, old.sectorEvidence]) !==
      sectorHash([c.codes, c.evidence])
    );
  });
  const active = await tx.job.count({
    where: { isActive: true, companyId: { in: changed.map((c) => c.id) } },
  });
  return {
    manifest: m,
    before,
    concepts,
    conceptChanges,
    changed: changed.length,
    activeAffected: active,
    reviewHash: sectorHash({ manifest: m, before, concepts }),
  };
}
export async function previewSectors(db: PrismaClient, raw: unknown) {
  const m = validateSectorManifest(raw);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return inspect(tx, m);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 60000,
    },
  );
}
export async function applySectors(
  db: PrismaClient,
  raw: unknown,
  expectedHash: string,
) {
  const m = validateSectorManifest(raw);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('sector-catalogue',0))`;
      if (m.companies.length)
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Company" WHERE id IN (${Prisma.join(m.companies.map((c) => c.id))}) ORDER BY id FOR UPDATE`,
        );
      const plan = await inspect(tx, m);
      if (!plan.changed && !plan.conceptChanges.length)
        return { changed: 0, reviewId: null };
      if (plan.reviewHash !== expectedHash)
        throw Error("Sector preview stale: review the new diff");
      const id = plan.reviewHash;
      await tx.sectorReview.create({
        data: {
          id,
          manifest: m as unknown as Prisma.InputJsonValue,
          before: plan.before as unknown as Prisma.InputJsonValue,
          reviewer: m.reviewer,
        },
      });
      for (const concept of plan.conceptChanges)
        await tx.sectorConcept.upsert({
          where: { code: concept.code },
          create: concept,
          update: { labels: concept.labels, position: concept.position },
        });
      const changed = await tx.$executeRaw`
      UPDATE "Company" c SET "sectorCodes"=r.codes,"sectorEvidence"=r.evidence,"sectorReviewId"=${id},"updatedAt"=now()
      FROM jsonb_to_recordset(${JSON.stringify(m.companies)}::jsonb) AS r(id text,codes text[],evidence jsonb)
      WHERE c.id=r.id AND (c."sectorCodes" IS DISTINCT FROM r.codes OR c."sectorEvidence" IS DISTINCT FROM r.evidence)`;
      return {
        changed,
        conceptsChanged: plan.conceptChanges.length,
        reviewId: id,
        activeAffected: plan.activeAffected,
      };
    },
    { timeout: 60000 },
  );
}
