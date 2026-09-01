import { XMLParser } from 'fast-xml-parser';
import { fetchText } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

export async function fetchPersonioJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const host = String(config.host ?? '');
  if (!host) throw new Error('Personio host missing');
  const xml = await fetchText(`https://${host}/xml?language=fr`);
  const parser = new XMLParser({ ignoreAttributes: false, textNodeName: '#text' });
  const data = parser.parse(xml);
  // The Personio feed root is literally `<workzag-jobs>`; the hyphen forces bracket access.
  const positions = data?.['workzag-jobs']?.position ?? [];
  const list = Array.isArray(positions) ? positions : [positions];
  return list.filter(Boolean).map((job: any) => ({
    externalId: String(job.id ?? job.name),
    title: String(job.name ?? ''),
    location: [job.office, job.department].filter(Boolean).map(String).join(', ') || undefined,
    contract: job.employmentType ? String(job.employmentType) : undefined,
    description: Array.isArray(job.jobDescriptions?.jobDescription)
      ? job.jobDescriptions.jobDescription.map((x: any) => `${x.name ?? ''}\n${x.value ?? ''}`).join('\n')
      : undefined,
    url: `https://${host}/job/${job.id ?? ''}`,
    postedAt: job.createdAt ? new Date(String(job.createdAt)) : undefined,
    raw: job,
  }));
}
