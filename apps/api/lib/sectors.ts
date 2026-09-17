import { cache } from "react";
import { prisma } from "@catwalks/db";
export const UNCLASSIFIED_SECTOR = "unclassified";
export type SectorView = { code: string; slug: string; label: string };
export const getSectorPresentation = cache(async () => {
  const rows = await prisma.sectorConcept.findMany({
    orderBy: [{ position: "asc" }, { code: "asc" }],
  });
  const sectors: SectorView[] = rows.map((r) => ({
    code: r.code,
    slug: r.slug,
    label: (r.labels as Record<string, string>).fr,
  }));
  const labels: Record<string, string> = Object.fromEntries(
    sectors.map((r) => [r.code, r.label]),
  );
  labels.unclassified = "Secteur à vérifier";
  return {
    sectors,
    labels,
    label: (value: string | null | undefined) =>
      value
        ?.split("|")
        .map((v) => labels[v] ?? "Secteur à vérifier")
        .join(" · ") ?? "Secteur à vérifier",
  };
});
/** An empty membership enriches nothing; it never excludes a general search. */
export function sectorWhere(code: string) {
  return code === UNCLASSIFIED_SECTOR
    ? { sectorCodes: { isEmpty: true } }
    : { sectorCodes: { has: code } };
}
