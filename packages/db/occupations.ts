/** Server catalogue entrypoint. Keep Node-only hashing out of the shared Prisma barrel. */
export {
  loadOccupationTaxonomy,
  lockOccupationTaxonomy,
  occupationManifestHash,
} from "./occupation-catalogue.ts";
export {
  compileOccupationManifest,
  normalizeOccupationTitle,
  occupationLabel,
  persistedOccupationDecision,
} from "./occupation-engine.ts";
export {
  manifestVocabulary,
  manifestVocabularyCollisions,
  vocabularyCollisions,
} from "./occupation-vocabulary.ts";
export type { VocabularyCollision, VocabularyConcept } from "./occupation-vocabulary.ts";
export type {
  CompiledOccupationTaxonomy,
  OccupationManifest,
  OccupationDecision,
  PersistedOccupationDecision,
  Definition as OccupationDefinition,
} from "./occupation-engine.ts";
