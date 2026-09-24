import { libelleConcept } from './taxonomy-labels';
import type { LangueLibelles } from '@catwalks/db/presentation';
import { cache } from 'react';
import { prisma } from '@catwalks/db';
import {
  loadOccupationTaxonomy,
  occupationLabel,
} from '@catwalks/db/occupations';

/** Request-local consistency, immutable release cache shared with the pipeline. */
const getOccupationPresentation = cache(async (langue: LangueLibelles = 'fr') => {
  const taxonomy = await loadOccupationTaxonomy(prisma);
  return {
    available: true as const,
    taxonomy,
    seniorityLabel: (key: string | null | undefined) =>
      key
        ? (occupationLabel(taxonomy.seniorities.get(key)) ?? 'Non renseigné')
        : 'Non renseigné',
    functionLabel: (key: string | null | undefined) =>
      key ? (occupationLabel(taxonomy.families.get(key)) ?? 'Non classé') : 'Non classé',
    occupationLabel: (key: string | null | undefined) =>
      key && taxonomy.occupations.has(key) ? libelleConcept('occupations', key, taxonomy.occupations.get(key)!.labels, langue) : null,
  };
});

let lastFailureReport = 0,
  repeatedFailures = 0;
/** Optional enrichment must not remove otherwise readable offers. Expose the
 * degradation to the response/UI and log a bounded diagnostic, never fake keys. */
export const getOptionalOccupationPresentation = cache(async (langue: LangueLibelles = 'fr') => {
  try {
    return await getOccupationPresentation(langue);
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
      seniorityLabel: (_key: string | null | undefined) => 'Non renseigné',
      functionLabel: (_key: string | null | undefined) => 'Non classé',
      occupationLabel: (_key: string | null | undefined) => null,
    };
  }
});
export type OptionalOccupationPresentation = Awaited<
  ReturnType<typeof getOptionalOccupationPresentation>
>;
