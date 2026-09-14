import { cache } from 'react';
import { prisma } from '@catwalks/db';
import {
  loadOccupationTaxonomy,
  occupationLabel,
} from '@catwalks/db/occupations';

/** Request-local consistency, immutable release cache shared with the pipeline. */
export const getOccupationPresentation = cache(async () => {
  const taxonomy = await loadOccupationTaxonomy(prisma);
  const JOB_FUNCTIONS = [...taxonomy.families.values()].map((d) => ({
    key: d.key,
    label: occupationLabel(d)!,
    family: d.group!,
  }));
  const FUNCTION_BY_KEY = new Map(JOB_FUNCTIONS.map((d) => [d.key, d]));
  const FAMILY_LABELS = Object.fromEntries(
    [...taxonomy.groups.values()].map((d) => [d.key, occupationLabel(d)!]),
  );
  return {
    available: true as const,
    taxonomy,
    JOB_FUNCTIONS,
    FUNCTION_BY_KEY,
    FAMILY_LABELS,
    seniorityLabel: (key: string | null | undefined) =>
      key
        ? (occupationLabel(taxonomy.seniorities.get(key)) ?? 'Non renseigné')
        : 'Non renseigné',
    functionLabel: (key: string | null | undefined) =>
      key ? (FUNCTION_BY_KEY.get(key)?.label ?? 'Non classé') : 'Non classé',
    occupationLabel: (key: string | null | undefined) =>
      key ? occupationLabel(taxonomy.occupations.get(key)) : null,
    familyOf: (key: string | null | undefined) =>
      key ? (FUNCTION_BY_KEY.get(key)?.family ?? null) : null,
  };
});
export type OccupationPresentation = Awaited<
  ReturnType<typeof getOccupationPresentation>
>;

let lastFailureReport = 0,
  repeatedFailures = 0;
/** Optional enrichment must not remove otherwise readable offers. Expose the
 * degradation to the response/UI and log a bounded diagnostic, never fake keys. */
export const getOptionalOccupationPresentation = cache(async () => {
  try {
    return await getOccupationPresentation();
  } catch (error) {
    repeatedFailures++;
    if (Date.now() - lastFailureReport > 60_000) {
      console.error(
        JSON.stringify({
          event: 'occupation.presentation_unavailable',
          occurrences: repeatedFailures,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      lastFailureReport = Date.now();
      repeatedFailures = 0;
    }
    return {
      available: false as const,
      taxonomy: null,
      JOB_FUNCTIONS: [],
      FUNCTION_BY_KEY: new Map(),
      FAMILY_LABELS: {},
      seniorityLabel: (_key: string | null | undefined) => 'Non renseigné',
      functionLabel: (_key: string | null | undefined) => 'Non classé',
      occupationLabel: (_key: string | null | undefined) => null,
      familyOf: (_key: string | null | undefined) => null,
    };
  }
});
export type OptionalOccupationPresentation = Awaited<
  ReturnType<typeof getOptionalOccupationPresentation>
>;

export const getOccupationMetrics = cache(async () => {
  const state = await prisma.occupationState.findUniqueOrThrow({
    where: { id: 'active' },
  });
  const rows = await prisma.job.groupBy({
    by: ['occupationCode', 'occupationStatus'],
    where: { isActive: true },
    _count: true,
  });
  const counts = new Map<string, number>(),
    statuses: Record<string, number> = {};
  let total = 0,
    classified = 0;
  for (const r of rows) {
    total += r._count;
    statuses[r.occupationStatus] =
      (statuses[r.occupationStatus] ?? 0) + r._count;
    if (r.occupationCode) {
      counts.set(
        r.occupationCode,
        (counts.get(r.occupationCode) ?? 0) + r._count,
      );
      classified += r._count;
    }
  }
  return {
    ready: !!state.backfilledAt,
    total,
    classified,
    unclassified: total - classified,
    counts,
    statuses,
  };
});
