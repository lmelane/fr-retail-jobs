import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  compileOccupationManifest,
  type CompiledOccupationTaxonomy,
} from "./occupation-engine.ts";

type Database = PrismaClient | Prisma.TransactionClient;
const compiled = new Map<string, CompiledOccupationTaxonomy>();
export function occupationManifestHash(manifest: unknown): string {
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
  return createHash("sha256")
    .update(JSON.stringify(stable(manifest)))
    .digest("hex");
}
/** Load once per source run/backfill. Cache immutable releases, never cache the active pointer. */
export async function loadOccupationTaxonomy(
  db: Database,
): Promise<CompiledOccupationTaxonomy> {
  const state = await db.occupationState.findUnique({
    where: { id: "active" },
    select: { releaseId: true },
  });
  if (!state) throw new Error("OCCUPATION_CATALOGUE_NOT_ACTIVATED");
  const cached = compiled.get(state.releaseId);
  if (cached) return cached;
  const release = await db.occupationRelease.findUniqueOrThrow({
    where: { id: state.releaseId },
  });
  if (occupationManifestHash(release.manifest) !== release.contentHash)
    throw new Error("OCCUPATION_CATALOGUE_HASH_MISMATCH");
  const result = compileOccupationManifest(release.manifest);
  if (result.manifest.id !== release.id)
    throw new Error("OCCUPATION_CATALOGUE_ID_MISMATCH");
  if (compiled.size >= 8) compiled.delete(compiled.keys().next().value!);
  compiled.set(release.id, result);
  return result;
}

/** Share the active row lock with publication. A run may start on an older
 * release; resolve the current release before writing, never downgrade it. */
export async function lockOccupationTaxonomy(
  tx: Prisma.TransactionClient,
  pinned?: CompiledOccupationTaxonomy,
) {
  const [state] = await tx.$queryRaw<
    { releaseId: string }[]
  >`SELECT "releaseId" FROM "OccupationState" WHERE id='active' FOR SHARE`;
  if (!state) throw new Error("OCCUPATION_CATALOGUE_NOT_ACTIVATED");
  return pinned?.manifest.id === state.releaseId
    ? pinned
    : loadOccupationTaxonomy(tx);
}
