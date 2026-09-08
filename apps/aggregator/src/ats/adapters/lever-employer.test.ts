import { expect, it } from 'vitest';
import { leverEmployer } from './lever.js';

it('reads the real Farfetch posting 054a48bf employer department only with a reviewed mapping', () => {
  const job = { id: '054a48bf-03d9-4a8e-9c54-d3895efeb4e4', text: 'Associate Account Manager', hostedUrl: 'https://jobs.lever.co/farfetch/054a48bf-03d9-4a8e-9c54-d3895efeb4e4', categories: { department: 'Stadium Goods - Commercial' } };
  expect(leverEmployer(job, { 'Stadium Goods - Commercial': 'Stadium Goods' })).toBe('Stadium Goods');
  expect(leverEmployer(job, undefined)).toBeUndefined();
  expect(leverEmployer(job, { 'Stadium Goods': 'Stadium Goods' })).toBeUndefined();
});
