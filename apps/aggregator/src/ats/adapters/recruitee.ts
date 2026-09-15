import { fetchJson } from '../../lib/http.js';
import { educationLevel } from '../../normalize/experience.js';
import { htmlToPlainText } from '../../lib/html.js';
import { publisherInstant } from '../../lib/publisherInstant.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

type Offer = { id: number; title: string; careers_url?: string; location?: string; city?: string; country?: string; employment_type?: string; description?: string; created_at?: string;
  requirements?: string | null; published_at?: string | null;
  /**
   * Le niveau d'études déclaré : `high_school`, `vocational`, `bachelor_degree`,
   * `master_degree`… Conservé dans son libellé natif, préfixé du référentiel —
   * `vocational` n'a pas d'équivalent français simple, et l'aplatir mentirait.
   */
  education_code?: string;
  /**
   * `entry_level`, `mid_level`, `manager`… un RANG de séniorité, PAS une durée.
   * NON lu : rien n'autorise à le convertir en années (voir normalize/experience.ts).
   */
  experience_code?: string };
type Response = { offers?: Offer[] };

export async function fetchRecruiteeJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const subdomain = String(config.subdomain ?? '');
  if (!subdomain) throw new Error('Recruitee subdomain missing');
  const endpoint = `https://${subdomain}.recruitee.com/api/offers/`;
  const data = await fetchJson<Response>(endpoint);
  if (!Array.isArray(data.offers)) throw new Error('RECRUITEE_INVALID_FEED: offers array missing');
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const valid = data.offers.filter(job => {
    if (!job || !Number.isSafeInteger(job.id) || job.id <= 0 || typeof job.title !== 'string' || !job.title.trim()) {
      rejectedRows.push({ reason: 'MISSING_OR_INVALID_ID_OR_TITLE', raw: job }); return false;
    }
    return true;
  });
  const jobs = valid.map(job => parseRecruiteeJob(job, subdomain));
  return {
    jobs, rejectedRows,
    complete: rejectedRows.length === 0 && new Set(jobs.map(job=>job.externalId)).size === jobs.length,
    enumeration: { method: 'DOCUMENTED_COMPLETE_PUBLIC_FEED', endpoint, pages: 1,
      rawCount: data.offers.length, termination: 'FULL_RESPONSE',
      documentation: 'https://docs.recruitee.com/reference/offers' },
  };
}

export function parseRecruiteeJob(job: Offer, subdomain: string): NormalizedJob {
  return {
    externalId: String(job.id),
    title: job.title,
    location: job.location ?? [job.city, job.country].filter(Boolean).join(', '),
    country: job.country,
    contract: job.employment_type,
    educationLevel: educationLevel('RECRUITEE', job.education_code),
    description: [job.description, job.requirements].map(htmlToPlainText).filter(Boolean).join('\n\n') || undefined,
    url: job.careers_url ?? `https://${subdomain}.recruitee.com/o/${job.id}`,
    // The feed also carries created_at and updated_at. Only published_at
    // dates publication; the retained public feed explicitly names UTC.
    postedAt: publisherInstant(typeof job.published_at === 'string'
      ? job.published_at.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/, '$1T$2Z') : undefined),
    raw: job,
  };
}
