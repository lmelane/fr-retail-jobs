import { describe, expect, it } from 'vitest';
import { applySuccessFactorsDetail, parseMicrodataDetail, retainedSuccessFactorsDetail } from './successfactors.js';
import { publicationDisposition } from '../../pipeline/publicationDisposition.js';

const observedAt = new Date('2026-09-24T06:59:00Z');
// Native RMK block shared by Rocher 1434408933 and Puig 1418803133, RAW audit.
const closed = '<div class="content"><div class="jobTitle"></div><div class="job"><p><strong>Désolé, ce poste est déjà pourvu.</strong></p></div></div>';
const job = { externalId: '1434408933', title: 'Responsable Secteur', url: 'https://careers.groupe-rocher.com/job/Rennes/1434408933/', raw: {} };

describe('native SAP closure, including HTTP 200', () => {
  it('uses the existing closure path, with the original observation time on replay', () => {
    const detail = parseMicrodataDetail(closed, observedAt);
    const live = applySuccessFactorsDetail(job, detail);
    const replay = applySuccessFactorsDetail(job, JSON.parse(JSON.stringify(retainedSuccessFactorsDetail(detail))));
    expect(live).toEqual(replay);
    expect(live).toMatchObject({ publicationHold: 'APPLICATION_EXPLICITLY_CLOSED', publicationWithdrawnAt: observedAt });
    expect(publicationDisposition(live.publicationHold!)).toEqual({ kind: 'CLOSED' });
    expect(live.company).toBeUndefined();
  });
  it('never closes on a menu, quoted text, an unreadable page or conflicting live job content', () => {
    for (const html of ['<nav>Désolé, ce poste est déjà pourvu.</nav>', '<p>Unavailable</p>', '',
      '<div class="content"><div class="job"><p>Que signifie « Désolé, ce poste est déjà pourvu. » ?</p></div></div>',
      closed + '<div itemprop="description">We are hiring.</div>']) {
      expect(applySuccessFactorsDetail(job, parseMicrodataDetail(html, observedAt)).publicationHold).toBeUndefined();
    }
  });
  it('rejects invalid retained closure evidence', () => {
    expect(() => applySuccessFactorsDetail(job, { closure: { message: 'Unknown', observedAt: observedAt.toISOString() } })).toThrow();
    expect(() => applySuccessFactorsDetail(job, { closure: { message: 'Désolé, ce poste est déjà pourvu.', observedAt: 'invalid' } })).toThrow();
  });
});
