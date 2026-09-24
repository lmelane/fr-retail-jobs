import { describe, expect, it } from 'vitest';
import { parseLvmhHit } from '../ats/adapters/lvmhAlgolia.js';
import { parseWordpressPost } from '../ats/adapters/wordpress.js';
import { applySmartRecruitersJobAd, parseSmartRecruitersPosting } from '../ats/adapters/smartrecruiters.js';
import { recoverRetainedPublication } from './recovery.js';

describe('native opportunity states from the RAW audit', () => {
  it('holds the exact LVMH smoke-test marker, not legitimate testing jobs', () => {
    const raw = { objectID: 'TP01660', name: 'Data Security Manager', description: 'Just a smoke test.', profile: 'Just a smoke test.',
      link: 'https://lvmh-china.tupu360.com/lvmh/apply?spid=1596429&m=1' };
    expect(parseLvmhHit(raw)?.publicationHold).toBe('NATIVE_TEST_PUBLICATION');
    expect(recoverRetainedPublication('lvmh_algolia', raw, { externalId: raw.objectID, url: raw.link, observedAt: new Date(), config: {} }))
      .toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'PUBLICATION_HELD' });
    expect(parseLvmhHit({ ...raw, description: 'Build and run smoke tests for the security team.', profile: 'Testing experience' })?.publicationHold).toBeUndefined();
  });
  it('holds a publisher-labelled recruitment event without mistaking an event-management job for it', () => {
    const raw = { id: 20091, title: { rendered: 'Luxe Talent Job Dating : Discover various career opportunities' },
      link: 'https://www.luxetalent.net/luxe-talent-job-dating-london/',
      content: { rendered: 'Our Job Dating is a recruitment event we organize on behalf of our client, to meet and recruit a variety of talent.' } };
    expect(parseWordpressPost(raw)?.publicationHold).toBe('NATIVE_RECRUITMENT_EVENT');
    expect(recoverRetainedPublication('wordpress', raw, { externalId: '20091', url: raw.link, observedAt: new Date(), config: {} }))
      .toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'PUBLICATION_HELD' });
    expect(parseWordpressPost({ ...raw, title: { rendered: 'Recruitment Event Manager' } })?.publicationHold).toBeUndefined();
    expect(parseWordpressPost({ ...raw, content: { rendered: 'Organize job dating sessions as part of your duties.' } })?.publicationHold).toBeUndefined();
  });
  it('keeps the explicitly unsolicited application distinct on collection and replay', () => {
    const listing = { id: '744000127388160', name: 'Εκδήλωση Ενδιαφέροντος', company: { name: 'ALTEX S.A.' } };
    const jobAd = { sections: { jobDescription: { text: 'Σε περίπτωση που σας ενδιαφέρει να εργαστείτε μαζί μας και τη δεδομένη στιγμή δεν υπάρχει αντίστοιχη θέση, μπορείτε να αποστείλετε το βιογραφικό σας.' } } };
    const live = applySmartRecruitersJobAd(parseSmartRecruitersPosting(listing, 'ALTEXSA'), jobAd);
    expect(live.opportunityType).toBe('OPEN_APPLICATION');
    expect(recoverRetainedPublication('smartrecruiters', live.raw, { externalId: live.externalId, url: live.url, observedAt: new Date(), config: { company: 'ALTEXSA' } }))
      .toMatchObject({ status: 'RECOVERABLE', job: { opportunityType: 'OPEN_APPLICATION', raw: live.raw } });
    expect(applySmartRecruitersJobAd({ ...live, opportunityType: undefined, title: 'Sales Advisor' }, jobAd).opportunityType).toBeUndefined();
    expect(applySmartRecruitersJobAd(parseSmartRecruitersPosting(listing, 'ALTEXSA'), undefined).opportunityType).toBeUndefined();
  });
});
