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

// ——— l2 (2026-09-06) : marque réelle, contrat et temps depuis la charge Phenom (Foot Locker : 1 769 postes US sous « Foot Locker France ») ———
import { parsePhenomJob } from './phenom.js';
import { normalizeContract, normalizeWorkingTime } from '../../normalize/contract.js';

/** Entrée `/api/jobs` de careers.footlocker.com capturée le 2026-09-06 (a4-phenom), champs longs abrégés. */
const FOOT_LOCKER = {
  slug: '71906',
  req_id: '71906',
  title: 'Sales Lead',
  description: '<p>Overview Great brands reflect culture.</p>',
  city: 'Philadelphia',
  state: 'Pennsylvania',
  country: 'United States',
  country_code: 'US',
  postal_code: '19137',
  latitude: 39.99567649999999,
  longitude: -75.0911491,
  tags1: ['9/4/2026'],
  tags2: ['Regular Part-Time'],
  tags4: ['Kids Foot Locker'],
  tags9: ['North America'],
  employment_type: 'PART_TIME',
  hiring_organization: 'Foot Locker',
  posted_date: '2026-09-04T18:16:00+0000',
  apply_url: 'https://us-retail-footlocker.icims.com/jobs/71906/login',
};

describe('parsePhenomJob — l2', () => {
  it('crédite l’offre à l’employeur publié (hiring_organization), pas à la Maison de repli du catalogue', () => {
    const job = parsePhenomJob(FOOT_LOCKER, 'https://careers.footlocker.com', {})!;
    expect(job.company).toBe('Foot Locker');
    expect(job.country).toBe('US');
    expect(job.url).toBe('https://us-retail-footlocker.icims.com/jobs/71906/job');
  });

  it('prend l’enseigne dans le tag désigné par `brandTag` quand la source le configure', () => {
    const job = parsePhenomJob(FOOT_LOCKER, 'https://careers.footlocker.com', { brandTag: 'tags4' })!;
    expect(job.company).toBe('Kids Foot Locker');
  });

  it('lit le contrat dans le tag qui le nomme (Regular → CDI) et le temps dans employment_type (PART_TIME)', () => {
    const job = parsePhenomJob(FOOT_LOCKER, 'https://careers.footlocker.com', {})!;
    expect(normalizeContract(job.contract)).toBe('CDI');
    expect(normalizeWorkingTime(job.workingTime)).toBe('TEMPS_PARTIEL');
  });

  it('sans tag de contrat, employment_type seul reste un temps de travail (pas un faux contrat)', () => {
    const job = parsePhenomJob({ ...FOOT_LOCKER, tags2: undefined }, 'https://x', {})!;
    expect(normalizeContract(job.contract)).toBe('UNKNOWN');
    expect(normalizeWorkingTime(job.workingTime)).toBe('TEMPS_PARTIEL');
  });
});
