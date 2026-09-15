import type { NativePublication } from '../../dedup/match.js';

export function teamtailorPublication(sourceKey: string, origin = 'https://brand.teamtailor.com', id = '68264a3e-8a35-40a7-9a4a-0830b00e87a8', postingId = 8360799): NativePublication {
  const url = `${origin}/jobs/${postingId}-client-advisor`;
  return { sourceKey, externalId: id, url, raw: { id, url, title: 'Client Advisor', content_html: '<p>Native duties</p>',
    _jobposting: { '@type': 'JobPosting', identifier: { '@type': 'PropertyValue', value: postingId },
      hiringOrganization: { name: 'Tiffany & Co.', sameAs: 'https://careers.brand.example' },
      description: '<p>Native duties</p>', jobLocation: [{ address: { addressCountry: 'FR', addressLocality: 'Paris' } }],
    } } };
}
