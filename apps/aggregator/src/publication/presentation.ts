import type { CompiledOccupationTaxonomy } from '@catwalks/db/occupations';
import { classifyOccupationContent } from '../occupation/persist.js';
import { Prisma } from '@prisma/client';
import { PRESENTATION_FIELDS, PRESENTATION_VERSION, publicationContentOf, type PresentationSource } from '@catwalks/db/publication-presentation';
import { publicSourceFacts, scalarSourceFacts } from '@catwalks/db/source-facts';
import { storedAmount } from '@catwalks/db/money';
import { captureReaderRevision } from '../capture/revision.js';
import type { CandidateJob } from '../dedup/match.js';
import type { publicationJobContent } from './content.js';

export function publicationPresentation(candidate: CandidateJob, content: ReturnType<typeof publicationJobContent>) {
  const values = Object.fromEntries(PRESENTATION_FIELDS.map(key => [key, content[key] ?? null]));
  const cache = JSON.parse(JSON.stringify({ version: PRESENTATION_VERSION, readerVersion: captureReaderRevision(),
    sourceKey: candidate.sourceKey, externalId: candidate.externalId, url: candidate.url,
    captureBatchId: candidate.captureBatchId ?? null, captureOutputId: candidate.captureOutputId ?? null,
    inputHash: candidate.sourceFacts?.inputHash, values,
  }, (_key, value) => value === Prisma.DbNull || value === Prisma.JsonNull ? null : value)) as Prisma.InputJsonValue;
  if (!publicationContentOf({ ...candidate, presentation: cache })) throw new Error('Invalid publication presentation');
  return cache;
}

/** A source change replaces the complete mirrored content, including nulls. */
export function publicationJobPatch(source: PresentationSource & { raw: Prisma.JsonValue; expiresAt: Date | null }, catalogue: CompiledOccupationTaxonomy) {
  const content = publicationContentOf(source);
  if (!content) throw new Error(`PUBLICATION_PRESENTATION_REBUILD_REQUIRED source=${source.sourceKey} id=${source.externalId}`);
  const facts = scalarSourceFacts(publicSourceFacts(source.sourceFacts));
  const classification = classifyOccupationContent({ ...content, sourceKey: source.sourceKey }, catalogue);
  return { ...content, ...classification, programType: content.programType, ...facts, salaryMin: storedAmount(facts.salaryMin), salaryMax: storedAmount(facts.salaryMax), raw: source.raw ?? Prisma.DbNull,
    employmentEvidence: content.employmentEvidence ?? Prisma.DbNull,
    validThrough: source.expiresAt,
  };
}
