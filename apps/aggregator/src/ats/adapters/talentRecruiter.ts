import {enumerationComplete,enumerationBlockers} from '../enumerationIssues.js';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { fetchJson, fetchText, DEFAULT_DETAIL_CONCURRENCY } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import { assertSourceRunning } from '../../lib/sourceBudget.js';
import { normalizeCountry } from '../../normalize/country.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

const API = 'https://recruiter-api.hr-manager.net/jobportal.svc';
const DOCUMENTATION = 'https://gradegroup.atlassian.net/wiki/spaces/DOCS/pages/2062844104/TR+Job+Portal+API+public';
type Node = { Name?: string; Country?: string; City?: string; Address?: string; Zip?: string };
type Position = {
  Id: number; Name: string; CustomerAlias: string; CustomerName: string;
  ProjectType: string; Published?: string; Created?: string; LastUpdated?: string; ApplicationDue?: string;
  AdvertisementUrlSecure?: string; AdvertisementUrl?: string;
  Advertisements?: Array<{ Id: number; Content?: string; Introduction?: string; Description?: string; Created?: string; LastUpdated?: string }>;
  Department?: Node; PositionLocation?: Node; PositionLocationMultiSelection?: Node[];
  PositionCategory?: Node; WorkPlace?: string; WorkPlaceCoordinates?: string; PositionType?: string;
};
type Response = { Items: Position[]; CustomerAlias: string; CustomerName: string; TransactionStatus?: { StatusCode?: number };
  PositionCountCustomer: number; PositionCountSearch: number; PositionCountList: number; PositionCountSkipped: number };

/** .NET milliseconds are UTC; the optional suffix describes the source offset,
 * not another offset to add. Created / RSS pubDate are not publication fallbacks. */
export function talentRecruiterDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  if (!match) return undefined;
  const at = new Date(Number(match[1])); return Number.isFinite(at.getTime()) ? at : undefined;
}
function publicPosition(p: Position): Position {
  // Public job data only. The API also exposes workflow participants/contacts;
  // these are not needed to substantiate the vacancy.
  const keys: Array<keyof Position> = ['Id','Name','CustomerAlias','CustomerName','ProjectType','Published','Created','LastUpdated','ApplicationDue',
    'AdvertisementUrlSecure','AdvertisementUrl','Advertisements','Department','PositionLocation','PositionLocationMultiSelection','PositionCategory','WorkPlace','WorkPlaceCoordinates','PositionType'];
  const result = Object.fromEntries(keys.filter(k => p[k] !== undefined).map(k => [k,p[k]])) as Position;
  if (Array.isArray(p.Advertisements)) result.Advertisements = p.Advertisements.map(a => ({ Id:a.Id, Content:a.Content, Introduction:a.Introduction, Description:a.Description, Created:a.Created, LastUpdated:a.LastUpdated }));
  return result;
}

export async function fetchTalentRecruiterJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const customer = String(config.customer ?? ''), locale = String(config.locale ?? 'en');
  if (!/^[a-z0-9_-]+$/i.test(customer) || !/^[a-z]{2}(?:-[a-z]{2})?$/i.test(locale)) throw new Error('TALENT_RECRUITER_INVALID_CUSTOMER_OR_LOCALE');
  if (config.portalUrl !== undefined) {
    const portal = new URL(String(config.portalUrl));
    if (portal.protocol !== 'https:' || portal.hostname !== 'candidate.hr-manager.net' || portal.username || portal.password ||
      portal.pathname.toLowerCase() !== '/vacancies/list.aspx' || portal.searchParams.get('customer')?.toLowerCase() !== customer.toLowerCase()) throw new Error('TALENT_RECRUITER_PORTAL_CUSTOMER_CONFLICT');
  }
  const maxPages = Number(config.maxPages ?? 10000);
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100000) throw new Error('TALENT_RECRUITER_INVALID_PAGE_BUDGET');
  const positions = new Map<number, Position>(), issues: string[] = [];
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  let total: number | undefined, rawCount = 0, skip = 0, terminated = false;
  for (let page=0; page<maxPages; page++) {
    assertSourceRunning();
    const url = `${API}/${encodeURIComponent(customer)}/positionlist/json/?take=100&skip=${skip}&incads=true&uiculture=${encodeURIComponent(locale)}`;
    const data = await fetchJson<Response>(url);
    if (!data || data.TransactionStatus?.StatusCode !== 0 || data.CustomerAlias?.toLowerCase() !== customer.toLowerCase() || !data.CustomerName || !Array.isArray(data.Items) ||
      ![data.PositionCountCustomer,data.PositionCountSearch,data.PositionCountList,data.PositionCountSkipped].every(n=>Number.isSafeInteger(n)&&n>=0)) throw new Error('TALENT_RECRUITER_INVALID_FEED');
    if (data.PositionCountList !== data.Items.length || data.PositionCountSkipped !== skip) issues.push('PAGINATION_COUNTER_MISMATCH');
    if (data.PositionCountCustomer !== data.PositionCountSearch) issues.push('UNFILTERED_CUSTOMER_SCOPE_MISMATCH');
    if (total !== undefined && total !== data.PositionCountSearch) issues.push('DECLARED_TOTAL_CHANGED');
    total ??= data.PositionCountSearch; rawCount += data.Items.length;
    const ids: string[] = [];
    for (const p of data.Items) {
      if (!p || !Number.isSafeInteger(p.Id) || p.Id <= 0 || typeof p.Name !== 'string' || !p.Name.trim() || p.CustomerAlias?.toLowerCase() !== customer.toLowerCase() || !p.CustomerName || !(p.AdvertisementUrlSecure || p.AdvertisementUrl)) {
        // Un identifiant exploitable fait du rejet une DISPOSITION nommée, jamais un trou dans la preuve.
        rejectedRows.push({reason:'INVALID_POSTING_ID_TITLE_EMPLOYER_OR_URL',raw:p ? publicPosition(p) : p,
          ...(p && Number.isSafeInteger(p.Id) && p.Id > 0 ? {canonicalId:String(p.Id)} : {})}); continue;
      }
      try {
        const parsed = new URL(p.AdvertisementUrlSecure || p.AdvertisementUrl!);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hostname !== 'candidate.hr-manager.net' || parsed.searchParams.get('ProjectId') !== String(p.Id)) throw new Error('URL_IDENTITY_MISMATCH');
      } catch { rejectedRows.push({reason:'POSTING_URL_IDENTITY_MISMATCH',raw:publicPosition(p),canonicalId:String(p.Id)}); continue; }
      ids.push(String(p.Id));
      if (positions.has(p.Id)) issues.push(`REPEATED_POSTING_ID:${p.Id}`);
      else positions.set(p.Id, publicPosition(p));
    }
    /**
     * `ids` EST l'identifiant canonique chez TalentRecruiter : `String(p.Id)` alimente à la fois cette preuve
     * et `NormalizedJob.externalId`. On le déclare explicitement — sans la propriété, aucune absence n'est
     * démontrable sur cette source. Les deux offres sans description restent dedans : elles ont été VUES, et
     * un défaut de contenu n'est pas une disparition.
     */
    pageEvidence.push({url,checkedAt:new Date().toISOString(),sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex'),offset:skip,ids,canonicalIds:ids,
      pagination:{start:skip+1,end:skip+data.Items.length,total:data.PositionCountSearch},publisherCounter:String(data.PositionCountCustomer),
      componentCounters:[`customer=${data.PositionCountCustomer}`,`search=${data.PositionCountSearch}`,`list=${data.PositionCountList}`,`skipped=${data.PositionCountSkipped}`]});
    if (issues.length || rejectedRows.length) break;
    if (positions.size === total) {terminated=true;break;}
    if (!data.Items.length || positions.size > total!) {issues.push('COUNT_OR_TERMINATION_MISMATCH');break;}
    skip += data.Items.length;
  }
  if (!terminated && !issues.length && !rejectedRows.length) issues.push('PAGE_BUDGET_EXHAUSTED');
  const limit=pLimit(DEFAULT_DETAIL_CONCURRENCY);
  const jobs=await Promise.all([...positions.values()].map(p=>limit(async():Promise<NormalizedJob>=>{
    const url=p.AdvertisementUrlSecure || p.AdvertisementUrl!;
    let mapAddress: string | undefined, detailError: string | undefined, country: string | undefined;
    // DepartmentTree is the CORPORATE hierarchy, never a fallback job location.
    const coordinates=p.WorkPlaceCoordinates?.split(',').map(s=>Number(s.trim()));
    const validCoordinates=coordinates?.length===2&&Number.isFinite(coordinates[0])&&Math.abs(coordinates[0])<=90&&Number.isFinite(coordinates[1])&&Math.abs(coordinates[1])<=180;
    try {
      const html=await fetchText(url), $=cheerio.load(html);
      for (const el of $('iframe[src]').toArray()) {
        const src=$(el).attr('src');if(!src)continue;
        const map=new URL(src,url);
        if (map.hostname==='www.google.com'&&map.pathname==='/maps/embed/v1/place') {
          const address=map.searchParams.get('q')?.trim();
          if (address) {mapAddress=address;const last=address.split(',').at(-1)?.trim();if(normalizeCountry(last))country=last;break;}
        }
      }
    } catch(error) {assertSourceRunning();detailError=String(error).slice(0,500);issues.push(`DETAIL_READ_FAILED:${p.Id}`);}
    // A country is emitted only when the address explicitly names it. Coordinates
    // and native location labels survive even when an address is not published.
    const opportunityType=p.ProjectType==='RecruitmentProject'?'JOB_OPENING':p.ProjectType==='OpenApplication'?'OPEN_APPLICATION':undefined;
    if (!opportunityType) issues.push(`UNRECOGNISED_PROJECT_TYPE:${p.Id}`);
    const ads=p.Advertisements??[];
    const description=ads.map(a=>htmlToPlainText(a.Content)).filter(Boolean).join('\n\n');
    if (!description && opportunityType !== 'OPEN_APPLICATION') issues.push(`DESCRIPTION_MISSING:${p.Id}`);
    return {externalId:String(p.Id),title:p.Name,company:p.CustomerName,
      employerEvidence:{rawName:p.CustomerName,path:'position.CustomerName',rule:'NATIVE_CUSTOMER_OWNER'},opportunityType,
      location:(mapAddress && !mapAddress.startsWith('place_id:') ? mapAddress : undefined) || p.WorkPlace || p.PositionLocation?.Name || undefined,
      country,
      ...(validCoordinates?{latitude:coordinates![0],longitude:coordinates![1]}:{}),
      description:description||undefined,contract:p.PositionType||undefined,department:p.PositionCategory?.Name,
      postedAt:talentRecruiterDate(p.Published),validThrough:talentRecruiterDate(p.ApplicationDue),url,
      ...(!opportunityType?{publicationHold:'UNRECOGNISED_OPPORTUNITY_TYPE'}:{}),
      raw:{position:p,mapAddress,detailError,publicationPath:'position.Published',
        fieldEvidence:{country:country ? {status:'EXPLICIT_NATIVE_MAP_ADDRESS',path:'detail.iframe.q'} : {status:'NOT_EXPLICIT_IN_PUBLIC_ADDRESS',hasSourceCoordinates:!!validCoordinates},
          description:description ? 'NATIVE_ADVERTISEMENT_CONTENT' : 'NO_CONTENT_PUBLISHED'}},
    };
  })));
  return {jobs,rejectedRows,declaredTotal:total,complete:enumerationComplete(terminated,issues,rejectedRows),
    enumeration:{method:'DOCUMENTED_SKIP_TAKE_AND_NATIVE_COUNTERS',endpoint:`${API}/${customer}/positionlist/json/`,documentation:DOCUMENTATION,
      pages:pageEvidence.length,rawCount,termination:terminated?'DECLARED_TOTAL_REACHED':'INCOMPLETE',blockers:enumerationBlockers(issues),issues,pageEvidence}};
}
