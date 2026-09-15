import { Prisma } from '@prisma/client';
import type { SourceFacts } from '@catwalks/db/source-facts';
import type { CandidateJob } from '../dedup/match.js';
import { readSourceFacts, projectSourceFacts } from '../facts/index.js';
import { BOOTSTRAP_TAXONOMY } from '../normalize/taxonomy.js';
import { publicationJobContent } from '../publication/content.js';
import { publicationPresentation } from '../publication/presentation.js';

/** Explicit native-publication input for database tests; never read the shared Job. */
export function publicationFixture(input: Pick<CandidateJob, 'sourceKey' | 'externalId' | 'url' | 'title'> & Partial<CandidateJob>, facts?: SourceFacts | null) {
  const sourceFacts = facts ?? readSourceFacts(input.atsType ?? 'GENERIC_JSONLD', input.raw);
  const candidate: CandidateJob = { company: 'Fixture', sourceTier: 'EMPLOYER_DIRECT', ...input,
    ...projectSourceFacts(sourceFacts), sourceFacts };
  return { presentation: publicationPresentation(candidate, publicationJobContent(candidate, BOOTSTRAP_TAXONOMY)),
    sourceFacts: facts === null ? Prisma.DbNull : JSON.parse(JSON.stringify(sourceFacts)) as Prisma.InputJsonValue };
}
