import { describe, expect, it } from 'vitest';
import { publicJobUrl } from './phenom.js';

/** Audit A5 (2026-09-06) : 2 842/2 842 liens Foot Locker menaient à une page de login iCIMS. */
describe('publicJobUrl', () => {
  it('remplace l’étape de connexion iCIMS par la fiche publique', () => {
    expect(publicJobUrl('https://us-retail-footlocker.icims.com/jobs/71906/login')).toBe('https://us-retail-footlocker.icims.com/jobs/71906/login'.replace('/login', '/job'));
    expect(publicJobUrl('https://x.icims.com/jobs/71906/login?in_iframe=1')).toBe('https://x.icims.com/jobs/71906/job?in_iframe=1');
  });
  it('laisse une URL de fiche intacte', () => {
    expect(publicJobUrl('https://careers.footlocker.com/job/123')).toBe('https://careers.footlocker.com/job/123');
  });
});
