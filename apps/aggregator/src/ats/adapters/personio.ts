import { XMLParser } from 'fast-xml-parser';
import { fetchText } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

/**
 * A single description section arrives as an object, several as an array
 * (fast-xml-parser collapses single children), and a section's text may sit
 * under `#text` when attributes are present. Both shapes must yield text.
 */
function descriptionOf(job: any): string | undefined {
  const raw = job.jobDescriptions?.jobDescription;
  if (!raw) return undefined;
  const sections = Array.isArray(raw) ? raw : [raw];
  const text = sections
    .map((x: any) => {
      const name = typeof x?.name === 'object' ? x.name?.['#text'] : x?.name;
      const value = typeof x?.value === 'object' ? x.value?.['#text'] : x?.value;
      return [name, value].filter(Boolean).join('\n');
    })
    .filter(Boolean)
    .join('\n');
  return text || undefined;
}

function parsePositions(xml: string): any[] {
  const parser = new XMLParser({ ignoreAttributes: false, textNodeName: '#text' });
  // The Personio feed root is literally `<workzag-jobs>`; the hyphen forces bracket access.
  const positions = parser.parse(xml)?.['workzag-jobs']?.position ?? [];
  return (Array.isArray(positions) ? positions : [positions]).filter(Boolean);
}

export async function fetchPersonioJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const host = String(config.host ?? '');
  if (!host) throw new Error('Personio host missing');

  /**
   * `?language=fr` returns the feed with EMPTY <jobDescriptions> when the board
   * carries no French translation (verified on pepco.jobs.personio.de: fr/en
   * empty, default full). Prefer French when it exists, but an offer without its
   * text breaks the product promise — so fall back to the board's own language.
   */
  let list = parsePositions(await fetchText(`https://${host}/xml?language=fr`));
  if (!list.some((job) => descriptionOf(job))) {
    list = parsePositions(await fetchText(`https://${host}/xml`));
  }

  return list.map((job: any) => ({
    externalId: String(job.id ?? job.name),
    title: String(job.name ?? ''),
    location: [job.office, job.department].filter(Boolean).map(String).join(', ') || undefined,
    contract: job.employmentType ? String(job.employmentType) : undefined,
    description: descriptionOf(job),
    url: `https://${host}/job/${job.id ?? ''}`,
    postedAt: job.createdAt ? new Date(String(job.createdAt)) : undefined,
    raw: job,
  }));
}
