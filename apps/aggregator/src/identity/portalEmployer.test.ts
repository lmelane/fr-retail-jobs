import { describe, expect, it } from 'vitest';
import { employerFromCertifiedScope, CERTIFIED_SCOPE_RULE } from './portalEmployer.js';

const held = { externalId: '1', title: 'Store Manager', url: 'https://x.example/1', publicationHold: 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL' } as any;

describe('employer inferred from a certified single-brand portal perimeter', () => {
  it('lifts the hold on a SINGLE_BRAND certified portal with a distinct provenance', () => {
    const j = employerFromCertifiedScope(held, 'Mango', 'SINGLE_BRAND');
    expect(j.publicationHold).toBeUndefined(); expect(j.company).toBeUndefined();
    expect(j.employerEvidence).toEqual({ rawName: 'Mango', path: 'portal.certifiedScope', rule: CERTIFIED_SCOPE_RULE });
  });
  it('never applies to a multi-brand or unreviewed portal, to another hold reason, or to a posting with an employer', () => {
    expect(employerFromCertifiedScope(held, 'Kering', 'MULTI_BRAND')).toBe(held);
    expect(employerFromCertifiedScope(held, 'Mango', null)).toBe(held);
    expect(employerFromCertifiedScope({ ...held, publicationHold: 'WORKDAY_DETAIL_SCHEMA_INVALID' }, 'Mango', 'SINGLE_BRAND').publicationHold).toBe('WORKDAY_DETAIL_SCHEMA_INVALID');
    const named = { ...held, publicationHold: undefined, company: 'Mango' };
    expect(employerFromCertifiedScope(named, 'Mango', 'SINGLE_BRAND')).toBe(named);
  });
});

it.each([
  { company: 'Explicit Native Employer' },
  { employerEvidence: { rawName: 'Explicit Native Employer', path: 'detail.hiringOrganization.name', rule: 'HIRING_ORGANIZATION_LABEL' } },
])('does not overwrite a native employer when a contradictory absence hold remains: %j', patch => {
  const job = { ...held, ...patch, raw: { hiringOrganization: { name: 'Explicit Native Employer' } } };
  expect(employerFromCertifiedScope(job, 'Portal owner', 'SINGLE_BRAND')).toBe(job);
  expect(job.raw.hiringOrganization.name).toBe('Explicit Native Employer');
});
