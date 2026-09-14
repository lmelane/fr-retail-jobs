import { cached } from '../cache';
import { activeSourcesByKind, headline, type Count } from '../facts';

/** Couverture des sources (compte par famille d'adaptateur, sans URL) + couverture de la classification. */
export type MethodologyData = {
  sourcesByKind: Count[];
  sourcesTotal: number;
  active: number;
  unclassifiedFunction: number;
  unclassifiedSeniority: number;
};

export const getMethodology = cached('methodology', async (): Promise<MethodologyData> => {
  const [kinds, h] = await Promise.all([activeSourcesByKind(), headline()]);
  return {
    sourcesByKind: kinds,
    sourcesTotal: kinds.reduce((s, k) => s + k.count, 0),
    active: h.active,
    unclassifiedFunction: h.unclassifiedFunction,
    unclassifiedSeniority: h.unclassifiedSeniority,
  };
});
