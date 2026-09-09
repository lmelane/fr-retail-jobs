import { Prisma, type PrismaClient } from "@prisma/client";
/** An investigation queue, not a conclusion that an ATS cannot supply context.
 * Keep the observed inputs, candidate concepts and direct source witnesses. */
export async function occupationReviewQueue(db: PrismaClient, limit = 500) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw new Error("Review queue limit must be between 1 and 10000");
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [result] = await tx.$queryRaw<
        { activeUnresolved: number; totalVariants: number; variants: any[] }[]
      >`
      WITH variants AS MATERIALIZED (
        SELECT "normalizedTitle",department,"occupationStatus" AS status,
          count(*)::int AS offers,min(id) AS "exampleJobId",
          array_agg(DISTINCT "jobFunction") AS "broadFamilies"
        FROM "Job" WHERE "isActive" AND "occupationCode" IS NULL
        GROUP BY "normalizedTitle",department,"occupationStatus"
      ), ranked AS (
        SELECT * FROM variants ORDER BY offers DESC,"normalizedTitle",department,status LIMIT ${limit}
      ) SELECT (SELECT coalesce(sum(offers),0)::int FROM variants) AS "activeUnresolved",
        (SELECT count(*)::int FROM variants) AS "totalVariants",
        coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('observedTitle',j.title,'rawTitle',j."rawTitle",
          'exampleUrl',j.url,'exampleSource',j."canonicalSourceKey",'exampleExternalId',j."canonicalExternalId",'evidence',j."occupationEvidence"))
          FROM ranked r JOIN "Job" j ON j.id=r."exampleJobId"),'[]'::jsonb) AS variants`;
      return {
        ...result,
        returnedVariants: result.variants.length,
        limit,
        investigation:
          "Compare the stored title/department with the native payload and adapter before adding a contextual rule. Ambiguity never authorizes a forced classification.",
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 120_000,
    },
  );
}
