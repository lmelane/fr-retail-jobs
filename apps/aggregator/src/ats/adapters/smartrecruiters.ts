import { isKnownPosting } from '../../lib/incrementalReading.js';
import { normalizeLanguage } from '../../normalize/language.js';
import pLimit from 'p-limit';
import { fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { createHash } from 'node:crypto';
import { captureObservedAt } from '../../capture/context.js';
import { listProof, type ListPage } from './listProof.js';

export type SmartRecruitersPosting = {
  id: string;
  name: string;
  ref?: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string };
  /**
   * `id` is the contract, `label` the working time — measured 2026-09-06 on
   * H&M (1 622) and Primark (824): ids permanent / part-time / contract, labels
   * Full-time / Part-time / Contract. Only the label was read, and it filed as a
   * working time: 3 553 contracts lost (audit a4 §4.10).
   */
  typeOfEmployment?: { id?: string; label?: string };
  /** Declared language ("hu", "en-GB") — ignored before l2, so a Hungarian H&M posting was detected as `pt`. */
  language?: { code?: string };
  department?: { label?: string };
  company?: { identifier?: string; name?: string };
  customField?: { fieldLabel?: string; valueLabel?: string }[];
};
/** L'enveloppe documentée de l'API publique : `offset` et `limit` servis en écho, `totalFound` à chaque page. */
type Page = { content: SmartRecruitersPosting[]; totalFound?: number; offset?: number; limit?: number };

const PAGE_SIZE = 100;

/** SmartRecruiters' contract ids, in words the contract normalizer knows. */
const CONTRACT_BY_ID: Record<string, string> = {
  permanent: 'Permanent',
  contract: 'Fixed-term contract',
  temporary: 'Temporary',
  intern: 'Internship',
  internship: 'Internship',
  apprenticeship: 'Apprenticeship',
  freelance: 'Freelance',
};

/** One listing entry → one posting (no description: /postings/{id} carries it). Exported for tests. */
export function smartRecruitersEmployer(job: SmartRecruitersPosting, field?: string): string | undefined {
  // This is the employer declared by the publication, including a group when
  // the publisher provides no brand. The tenant slug is never an employer.
  if (!field) return job.company?.name?.trim() || undefined;
  const names = [...new Set((job.customField ?? []).filter(f => f.fieldLabel === field).map(f => f.valueLabel?.trim()).filter((s): s is string => !!s))];
  return names.length === 1 ? names[0] : undefined;
}

export function parseSmartRecruitersPosting(job: SmartRecruitersPosting, company: string, employerField?: string): NormalizedJob {
  const location = [job.location?.city, job.location?.region, job.location?.country].filter(Boolean).join(', ');
  const type = job.typeOfEmployment;
  const id = type?.id?.trim().toLowerCase();
  return {
    externalId: job.id,
    title: job.name,
    // Opt-in field whose employer meaning was verified for this tenant.
    // Otherwise retain the publication's own company name, without guessing a brand.
    company: smartRecruitersEmployer(job, employerField),
    location,
    country: job.location?.country,
    // An unmapped id ("part-time") falls back to the label, which the boundary
    // then files as a working time rather than a contract.
    contract: (id && CONTRACT_BY_ID[id]) || type?.label || undefined,
    workingTime: type?.label || type?.id || undefined,
    language: normalizeLanguage(job.language?.code),
    url: `https://jobs.smartrecruiters.com/${company}/${job.id}`,
    postedAt: job.releasedDate ? new Date(job.releasedDate) : undefined,
    raw: job,
  };
}

export type PostingDetail = {
  jobAd?: {
    sections?: Record<string, { title?: string; text?: string }>;
  };
};


/**
 * The listing endpoint carries no description; /postings/{id} does, split across
 * named sections. They are concatenated in the order a candidate reads them.
 * Shared internally by the collector/replay merge below.
 */
function descriptionFromJobAd(jobAd: PostingDetail['jobAd'] | undefined): string | undefined {
  const sections = jobAd?.sections ?? {};
  const text = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
    .map((key) => htmlToPlainText(sections[key]?.text))
    .filter(Boolean)
    .join('\n\n');
  return text || undefined;
}

/** One merge for the collector and RAW replay, including explicit native
 * open applications. Missing or ambiguous content does not change the type. */
export function applySmartRecruitersJobAd(job: NormalizedJob, jobAd: PostingDetail['jobAd'] | undefined): NormalizedJob {
  const description = descriptionFromJobAd(jobAd);
  const spontaneous = job.title.normalize('NFC').trim() === 'Εκδήλωση Ενδιαφέροντος' &&
    description?.normalize('NFC').replace(/\s+/g, ' ').includes('τη δεδομένη στιγμή δεν υπάρχει αντίστοιχη θέση');
  return { ...job, description,
    ...(spontaneous ? { opportunityType: 'OPEN_APPLICATION' as const } : {}),
    raw: jobAd ? { ...(job.raw as object), jobAd } : job.raw };
}

/** The advert is retained in RAW (`jobAd`) so the publication can be rebuilt offline from its native input. */
async function fetchJobAd(company: string, id: string): Promise<PostingDetail['jobAd'] | undefined> {
  try {
    const detail = await fetchJson<PostingDetail>(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(id)}`,
    );
    return detail.jobAd && typeof detail.jobAd === 'object' ? detail.jobAd : undefined;
  } catch {
    // A failed detail fetch must not lose the listing entry.
    return undefined;
  }
}

export async function fetchSmartRecruitersJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const company = String(config.company ?? '');
  if (!company) throw new Error('SmartRecruiters company missing');
  const out: NormalizedJob[] = [];
  let declaredTotal: number | undefined;
  const endpoint = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings`;
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const listPages: ListPage[] = [];
  const distinct = new Set<string>();
  let rawCount = 0, rowsWithoutId = 0, offsetMismatch = false, termination = 'PAGE_BUDGET_EXHAUSTED';
  // Pas de plafond à 1 000 : l'API sert les offsets au-delà (vérifié : H&M
  // offset=1600 → 200, totalFound 1 622) ; le plafond laissait 622 offres H&M
  // jamais lues (lot 2, 2026-09-06). 20 000 = garde-fou contre une boucle.
  for (let offset = 0; offset < 20_000; offset += PAGE_SIZE) {
    const page = await fetchJson<Page>(`${endpoint}?limit=${PAGE_SIZE}&offset=${offset}`);
    const content = page.content ?? [];
    rawCount += content.length;
    const ids: string[] = [];
    for (const job of content) {
      // L'identifiant de l'annonce est l'`externalId` écrit : la preuve et la sortie suivent le même chemin.
      const id = typeof job.id === 'string' && job.id.trim() ? job.id : undefined;
      if (!id) { rowsWithoutId += 1; rejectedRows.push({ reason: 'POSTING_WITHOUT_ID', raw: job }); continue; }
      ids.push(id); distinct.add(id);
      out.push(parseSmartRecruitersPosting(job, company, typeof config.employerField === 'string' ? config.employerField : undefined));
    }
    // Une API qui ignorerait `offset` ressert la première page : l'écho le dit avant même le compte des identifiants.
    if (page.offset !== undefined && page.offset !== offset) offsetMismatch = true;
    listPages.push({ index: offset / PAGE_SIZE, total: page.totalFound, rows: content.length });
    pageEvidence.push({ url: `${endpoint}?limit=${PAGE_SIZE}&offset=${offset}`, checkedAt: captureObservedAt().toISOString(),
      sha256: createHash('sha256').update(JSON.stringify(page)).digest('hex'), offset,
      pagination: page.totalFound === undefined ? null : { start: offset, end: offset + content.length, total: page.totalFound },
      ids, canonicalIds: ids, publisherCounter: page.totalFound === undefined ? '' : `totalFound=${page.totalFound}`,
      componentCounters: [`rows=${content.length}`, `offset=${page.offset ?? '?'}`] });
    if (page.totalFound !== undefined) declaredTotal = page.totalFound;
    if (!content.length) { termination = 'EMPTY_PAGE'; break; }
    if (rawCount >= (page.totalFound ?? 0)) { termination = 'DECLARED_TOTAL_REACHED'; break; }
  }
  /**
   * D-522 §6 : la fin de la liste se prouve sur ce que l'API publie à chaque page (`listProof`) — même `totalFound`
   * partout, pages contiguës jusqu'à la dernière, chaque annonce une fois. hm-group (1 930 sur 1 930), marella,
   * b-s-international et funky-buddha lisaient tout, douze collectes sur douze, et restaient « énumération inconnue ».
   * Une preuve qui manque laisse l'énumération INCONNUE, comme avant : ce lot ne rend bloquante aucune collecte.
   */
  const proof = termination === 'PAGE_BUDGET_EXHAUSTED' ? { complete: false, failures: ['LIST_PAGE_BUDGET_EXHAUSTED'] }
    : listProof({ pages: listPages, pageSize: PAGE_SIZE, distinctIds: distinct.size, rowsWithoutId });
  const failures = [...proof.failures, ...(offsetMismatch ? ['LIST_OFFSET_IGNORED'] : [])];
  const complete = failures.length === 0;
  const listing = { declaredTotal, rejectedRows, ...(complete ? { complete: true } : {}),
    enumeration: { method: 'PUBLIC_POSTING_API_OFFSET_PAGINATION', endpoint, pages: pageEvidence.length, rawCount, termination,
      enumerationTraversalComplete: complete, issues: failures, canonicalAbsenceProofUsable: rowsWithoutId === 0, pageEvidence } };

  if (config.withDescriptions === false) return { jobs: out, ...listing };

  const limit = pLimit(Number(config.detailConcurrency ?? 4));
  const jobs = await Promise.all(
    // D-517 : en lecture incrémentale, l'annonce n'est lue que pour une publication jamais vue.
    out.filter(job => !isKnownPosting(job.externalId)).map((job) =>
      limit(async () => {
        const jobAd = await fetchJobAd(company, job.externalId);
        return applySmartRecruitersJobAd(job, jobAd);
      }),
    ),
  );
  return { jobs, ...listing };
}
