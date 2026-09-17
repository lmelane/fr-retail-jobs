export function icimsPublication(sourceKey: string, origin = 'https://stores-brand.icims.com', query = '') {
  const url = `${origin}/jobs/42/client-advisor/job${query}`;
  return { sourceKey, externalId: '42', url, raw: { source: 'icims', reference: '2026-42', postingEvidence: {
    pageUrl: url, htmlSha256: 'a'.repeat(64), jobPostingCount: 1, geographyConflict: false,
    jobPosting: { '@type': 'JobPosting', title: 'Client Advisor', description: '<p>Own published description</p>',
      url: `${origin}/jobs/42/client-advisor/job`, hiringOrganization: { name: 'Tiffany & Co.' } },
  } } };
}
