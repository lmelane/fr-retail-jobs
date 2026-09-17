import { createHash } from 'node:crypto';
import { captureObservedAt } from '../../capture/context.js';
import { fetchJson } from '../../lib/http.js';
import { educationLevel } from '../../normalize/experience.js';
import { htmlToPlainText } from '../../lib/html.js';
import { publisherInstant } from '../../lib/publisherInstant.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { recruiteeSubdomain } from '../portalConfig.js';

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
  const subdomain = recruiteeSubdomain(config);
  const endpoint = `https://${subdomain}.recruitee.com/api/offers/`;
  const data = await fetchJson<Response>(endpoint);
  if (!Array.isArray(data.offers)) throw new Error('RECRUITEE_INVALID_FEED: offers array missing');
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  /**
   * LE CONTRAT DES IDENTIFIANTS CANONIQUES.
   *
   * `offer.id` est l'identifiant NATIF de Recruitee, et `String(offer.id)` est exactement le chemin d'identité
   * de `externalId` (voir `parseRecruiteeJob`) : les deux ensembles sont donc comparables à la base, seule
   * condition pour qu'une absence puisse être prouvée. Une ligne dont l'`id` n'est pas exploitable est ANONYME —
   * comptée et signalée, jamais nommée (modèle Ashby).
   */
  const canonicalIds: string[] = [];
  let anonymousRows = 0;
  const valid = data.offers.filter(job => {
    const canonicalId = job && Number.isSafeInteger(job.id) && job.id > 0 ? String(job.id) : null;
    if (canonicalId) canonicalIds.push(canonicalId); else anonymousRows++;
    if (!canonicalId || typeof job.title !== 'string' || !job.title.trim()) {
      // Un rejet dont l'identifiant natif est connu reste une DISPOSITION nommée, pas un trou dans la preuve.
      rejectedRows.push({ reason: 'MISSING_OR_INVALID_ID_OR_TITLE', raw: job, ...(canonicalId ? { canonicalId } : {}) }); return false;
    }
    return true;
  });
  const jobs = valid.map(job => parseRecruiteeJob(job, subdomain));
  return {
    jobs, rejectedRows,
    complete: rejectedRows.length === 0 && new Set(jobs.map(job=>job.externalId)).size === jobs.length,
    enumeration: { method: 'DOCUMENTED_COMPLETE_PUBLIC_FEED', endpoint, pages: 1,
      rawCount: data.offers.length, termination: 'FULL_RESPONSE',
      documentation: 'https://docs.recruitee.com/reference/offers',
      // Une ligne sans `id` exploitable ne peut pas être nommée : aucun identifiant historique ne peut alors être déclaré absent.
      canonicalAbsenceProofUsable: anonymousRows === 0,
      /**
       * L'endpoint unique est servi EN ENTIER (`FULL_RESPONSE`) : une seule page de preuve, qui porte donc la
       * totalité des identifiants observés. Toutes les pages déclarent — le contrat ne peut pas être partiel ici.
       */
      pageEvidence: [{ url: endpoint, checkedAt: captureObservedAt().toISOString(),
        sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
        offset: 0, pagination: null, ids: canonicalIds, canonicalIds,
        publisherCounter: String(data.offers.length), componentCounters: [`anonymous=${anonymousRows}`] }] },
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
