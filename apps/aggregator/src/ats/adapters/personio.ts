import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import { captureObservedAt } from '../../capture/context.js';
import {personioDetail} from './personioDetail.js';
import { enrichPostingEvidence } from '../../lib/postingEvidence.js';
import { assertSourceRunning } from '../../lib/sourceBudget.js';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { fetchText } from '../../lib/http.js';
import { personioExperienceYears } from '../../normalize/experience.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

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

export function parsePositions(xml: string): any[] {
  if (XMLValidator.validate(xml) !== true) throw new Error('PERSONIO_INVALID_XML');
  const parser = new XMLParser({ ignoreAttributes: false, textNodeName: '#text' });
  const document = parser.parse(xml);
  if (!Object.hasOwn(document, 'workzag-jobs')) throw new Error('PERSONIO_INVALID_FEED_ROOT');
  const positions = document['workzag-jobs']?.position ?? [];
  return (Array.isArray(positions) ? positions : [positions]).filter(Boolean);
}

export async function fetchPersonioJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const host = String(config.host ?? '');
  if (!host) throw new Error('Personio host missing');
  const endpoint = `https://${host}/xml`;
  const document = await fetchText(endpoint);
  const observedAt = captureObservedAt();
  const list = parsePositions(document);
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const jobs: NormalizedJob[] = [];
  /**
   * LE CONTRAT DES IDENTIFIANTS CANONIQUES.
   *
   * `String(raw.id)` EST l'identifiant canonique de Personio : c'est exactement ce que
   * `parsePersonioPosition` écrit en `externalId` et ce que la base stocke. On le collecte AVANT la
   * validation du titre — une position dotée d'un `id` numérique a été OBSERVÉE, quoi qu'il advienne
   * ensuite, et une JobSource historique portant ce même identifiant paraîtrait sinon ABSENTE au refresh.
   */
  const canonicalIds: string[] = [];
  let anonymousRows = 0;
  for (const raw of list) {
    const identifiable = /^[0-9]+$/.test(String(raw?.id ?? ''));
    if (identifiable) canonicalIds.push(String(raw.id)); else anonymousRows++;
    const job = parsePersonioPosition(raw, host);
    if (!job) {
      // Un identifiant exploitable fait du rejet une DISPOSITION nommée, jamais un trou dans la preuve.
      rejectedRows.push({ reason: 'MISSING_OR_INVALID_ID_OR_TITLE', raw, ...(identifiable ? { canonicalId: String(raw.id) } : {}) }); continue;
    }
    jobs.push(job);
  }
  const limit = pLimit(2);
  const enriched = await Promise.all(jobs.map(job=>limit(async()=>{
    try {
      const html = await fetchText(job.url);
      const enriched = enrichPostingEvidence(job, html);
      const detail = personioDetail(html, job.externalId);
      const employer = job.company ? undefined : detail.job?.employer;
      return { ...enriched, ...(employer ? { company: employer, employerEvidence: { rawName: employer,
          path: 'raw.personioDetail.careerSiteSettings.company_name', rule: 'EXPLICIT_PERSONIO_PORTAL_EMPLOYER' } } : {}), postedAt: detail.job?.postedAt ?? enriched.postedAt,
        description: detail.job?.description ?? enriched.description,
        country: enriched.country ?? detail.job?.country,
        city: enriched.city ?? detail.job?.city,
        raw: { ...(enriched.raw as object), personioDetail: detail.evidence },
      };
    }
    catch (error) {
      assertSourceRunning();
      return { ...job, raw: { ...(job.raw as object), detailReadError: String(error).slice(0,1000) } };
    }
  })));
  return {
    jobs: enriched, rejectedRows,
    complete: rejectedRows.length === 0 && new Set(jobs.map(job=>job.externalId)).size === list.length,
    enumeration: { method: 'DOCUMENTED_COMPLETE_XML_FEED', endpoint, pages: 1, rawCount: list.length,
      termination: 'FULL_RESPONSE', documentation: 'https://developer.personio.de/v1.0/reference/get_xml',
      // Une position sans `id` numérique a été vue mais ne peut être nommée : aucun identifiant historique
      // ne peut alors être déclaré absent, puisqu'il pourrait être celle-là.
      canonicalAbsenceProofUsable: anonymousRows === 0,
      pageEvidence: [{ url: endpoint, checkedAt: observedAt.toISOString(),
        sha256: createHash('sha256').update(document).digest('hex'), offset: 0, pagination: null,
        ids: canonicalIds, canonicalIds, publisherCounter: String(list.length), componentCounters: [] }] },
  };
}

/** Native XML position, before optional page enrichment. */
export function parsePersonioPosition(raw: any, host: string): NormalizedJob | null {
  if (!/^[0-9]+$/.test(String(raw?.id ?? '')) || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  return {
    externalId: String(raw.id), title: raw.name,
    // Department is a business unit, not a geographic component.
    location: raw.office ? String(raw.office) : undefined,
    contract: raw.employmentType ? String(raw.employmentType) : undefined,
    // `yearsOfExperience` est un INTERVALLE D'ANNÉES explicite (`2-5`, `gt-15`) :
    // on en prend la borne basse, l'exigence minimale. À ne pas confondre avec
    // `raw.seniority` (`experienced`, `entry-level`…), qui est un rang sans durée
    // et n'est pas lu.
    experienceYears: personioExperienceYears(raw.yearsOfExperience),
    ...(typeof raw.subcompany === 'string' && raw.subcompany.trim() ? { company: raw.subcompany.trim(),
      employerEvidence: { rawName: raw.subcompany, path: 'raw.subcompany', rule: 'EXPLICIT_PERSONIO_LEGAL_ENTITY' } } : {}),
    description: descriptionOf(raw), url: `https://${host}/job/${raw.id}`,
    // XML createdAt is creation, not an asserted publication. Read datePosted
    // from the actual single JobPosting instead; preserve createdAt in RAW.
    raw,
  };
}
