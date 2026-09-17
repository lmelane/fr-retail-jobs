import type { EducationValue, Fact } from '@catwalks/db/source-facts';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { at, object } from './types.js';

const PATHS: Record<string, string> = { RECRUITEE: '/education_code', WTTJ: '/education_level',
  WORKABLE: '/education', FLATCHR: '/vacancy/education_level', TALENTVIEW: '/detail/education_level' };
const UNSPECIFIED = new Set(['', 'unspecified', 'not specified', 'n/a']);

/** Preserve the publisher's educational system. Application-form requirements are not diplomas. */
export function readEducation(type: string, raw: unknown): Fact<EducationValue> {
  if (!object(raw)) return { status: 'INPUT_MISSING', value: null, evidence: [], issues: [] };
  const referential = KIND_TO_ATS[type] ?? type, path = PATHS[referential];
  if (!path) return { status: 'UNINTERPRETED', value: null, evidence: [], issues: ['EDUCATION_READER_NOT_QUALIFIED'] };
  const value = at(raw, path), evidence = value === undefined ? [] : [{ path, value }];
  if (value == null || (typeof value === 'string' && UNSPECIFIED.has(value.trim().toLowerCase())))
    return { status: 'NOT_OBSERVED', value: null, evidence, issues: [] };
  if (typeof value !== 'string') return { status: 'UNINTERPRETED', value: null, evidence, issues: ['UNINTERPRETED_EDUCATION_CODE'] };
  const requirement = value.trim();
  // This is an explicit requirement, never the same thing as an absent field.
  const noDiplomaRequired = referential === 'WTTJ' && requirement === 'no_diploma';
  return { status: 'DECLARED', value: { referential, requirements: [requirement], noDiplomaRequired }, evidence, issues: [] };
}
