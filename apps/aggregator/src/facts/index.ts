import { evidenceHash } from '../lib/evidenceHash.js';
import { FACT_READER_VERSION, scalarSourceFacts, type SourceFacts } from '@catwalks/db/source-facts';
import { readSalary } from './salary.js';
import { readEducation } from './education.js';
import { readWorkplace } from './workplace.js';
import { readLocations } from './locations.js';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';

export function readSourceFacts(type: string, raw: unknown): SourceFacts {
  return { version: FACT_READER_VERSION, sourceType: KIND_TO_ATS[type] ?? type,
    inputHash: evidenceHash(raw ?? null),
    salary: readSalary(type, raw), education: readEducation(type, raw), workplace: readWorkplace(type, raw), locations: readLocations(type, raw) };
}

/** Scalar columns can express only a single tuple/place/mode. The complete facts retain all alternatives. */
export function projectSourceFacts(facts: SourceFacts) {
  const values = scalarSourceFacts(facts);
  return {
    salaryMin: values.salaryMin ?? undefined, salaryMax: values.salaryMax ?? undefined,
    salaryCurrency: values.salaryCurrency ?? undefined, salaryPeriod: values.salaryPeriod ?? undefined,
    educationLevel: values.educationLevel ?? undefined, workplaceType: values.workplaceType ?? undefined,
    latitude: values.latitude ?? undefined, longitude: values.longitude ?? undefined, postalCode: values.postalCode ?? undefined,
  };
}
