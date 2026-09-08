import { expect, it } from 'vitest';
import { parseSmartRecruitersPosting, smartRecruitersEmployer } from './smartrecruiters.js';

// Reduced real SMCP posting 744000146966545, captured 2026-09-08.
const posting = { id: '744000146966545', name: 'Mécanicien -Tailleur - CDD H/F', customField: [
  { fieldLabel: 'Brands', valueLabel: 'Maje' },
  { fieldLabel: 'Type of contract', valueLabel: 'CDD' },
] };
it('uses the declared Maje brand, never the Sandro catalogue label or SMCP tenant slug', () => {
  expect(parseSmartRecruitersPosting(posting, 'SMCP', 'Brands').company).toBe('Maje');
  expect(parseSmartRecruitersPosting(posting, 'SMCP').company).toBeUndefined();
});
it('does not guess a brand for absent or contradictory evidence', () => {
  expect(smartRecruitersEmployer({ ...posting, customField: [] }, 'Brands')).toBeUndefined();
  expect(smartRecruitersEmployer({ ...posting, customField: [...posting.customField, { fieldLabel: 'Brands', valueLabel: 'Sandro' }] }, 'Brands')).toBeUndefined();
});
