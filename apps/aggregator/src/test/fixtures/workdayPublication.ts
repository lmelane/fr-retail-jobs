import type { NativePublication } from '../../dedup/match.js';

export function workdayPublication(sourceKey: string, site = 'Careers', requisition = 'JR123', posting = `Advisor_${requisition}`): NativePublication {
  const externalPath = `/job/PARIS/${posting}`, origin = 'https://employer.wd3.myworkdayjobs.com';
  return { sourceKey, externalId: posting, url: `${origin}/${site}${externalPath}`,
    raw: { title: 'Client Advisor', externalPath, detail: { jobPostingInfo: {
      externalUrl: `${origin}/${site}${externalPath}`, jobReqId: requisition, jobPostingId: posting, jobPostingSiteId: site,
      title: 'Client Advisor', jobDescription: `<p>Own duties for ${site}</p>`, location: 'Paris',
      country: { descriptor: 'France' }, logoImage: { alt: 'Tiffany & Co.' },
    } } } };
}
