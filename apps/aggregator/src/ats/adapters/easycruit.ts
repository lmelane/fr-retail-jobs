import {enumerationComplete,enumerationBlockers} from '../enumerationIssues.js';
import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import pLimit from 'p-limit';
import { fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import { enrichPostingEvidence } from '../../lib/postingEvidence.js';
import { assertSourceRunning } from '../../lib/sourceBudget.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

const DOCUMENTATION = 'https://community.visma.com/t5/Kennisbank-Youforce-Werving/Opbouw-XML-datafeed/tac-p/660657/highlight/true';
type Xml = Record<string, any>;
const array = <T>(v: T | T[] | undefined): T[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
const text = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v.trim() : undefined;
function parse(xml: string, root: string): Xml {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw Error('EASYCRUIT_INVALID_XML');
  const doc = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false }).parse(xml);
  if (!Object.hasOwn(doc, root) || !doc[root] || typeof doc[root] !== 'object') throw Error('EASYCRUIT_INVALID_ROOT');
  return doc[root];
}
function publicVacancy(v: Xml): Xml {
  return { ...v, Departments: { Department: array<Xml>(v.Departments?.Department).map(d =>
    Object.fromEntries(['@_id','Name','Address','HomepageURL','LogoURL','ImageURL','VacancyURL','ApplicationURL'].filter(k=>d[k]!==undefined).map(k=>[k,d[k]]))) } };
}
function versionOf(v: Xml, language?: string): Xml | undefined {
  const versions = array<Xml>(v.Versions?.Version);
  return versions.find(v=>language && v['@_language']===language) ?? versions[0];
}
function vacancyUrl(v: Xml, origin: string, id: string): string | undefined {
  for (const department of array<Xml>(v.Departments?.Department)) {
    const value=text(department.VacancyURL);if (!value) continue;
    try { const u=new URL(value);if (u.origin===origin && !u.username && !u.password &&
      new RegExp(`^/vacancy/${id}/[0-9]+/?$`).test(u.pathname)) return u.toString(); } catch { /* Invalid values are reported by the caller. */ }
  }
  return undefined;
}

/** Public, complete tenant XML feed. Department/country/language parameters are
 * deliberately absent. A language preference chooses display, never membership. */
export async function fetchEasycruitJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const host=String(config.host??'').toLowerCase(),language=config.language===undefined?undefined:String(config.language);
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.easycruit\.com$/.test(host) || host==='www.easycruit.com' ||
      (language!==undefined&&!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language))) throw Error('EASYCRUIT_INVALID_TENANT_OR_LANGUAGE');
  const origin=`https://${host}`,endpoint=`${origin}/export/xml/vacancy/list.xml`;
  const xml=await fetchText(endpoint),list=parse(xml,'VacancyList'),vacancies=array<Xml>(list.Vacancy);
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']>=[],issues:string[]=[],seen=new Set<string>();
  const entries:Array<{raw:Xml;id:string;url:string;version:Xml}>=[];
  for (const row of vacancies) {
    const id=text(row?.['@_id']),version=row&&versionOf(row,language),url=id&&vacancyUrl(row,origin,id);
    if (!id || !/^[1-9][0-9]*$/.test(id) || !version || !text(version.Title) || !url) {
      rejectedRows.push({reason:'INVALID_ID_TITLE_OR_NATIVE_VACANCY_URL',raw:row});continue;
    }
    if (seen.has(id)) {rejectedRows.push({reason:'DUPLICATE_NATIVE_ID',raw:publicVacancy(row)});continue;}
    seen.add(id);entries.push({raw:publicVacancy(row),id,url,version});
  }
  const limit=pLimit(2);
  const jobs=await Promise.all(entries.map(entry=>limit(async():Promise<NormalizedJob>=>{
    assertSourceRunning();
    let detail:Xml|undefined,detailError:string|undefined,publicPageError:string|undefined,detailBody:string|undefined,detailFailurePayload:string|undefined;
    try {
      detailBody=await fetchText(`${origin}/export/xml/vacancy/${entry.id}.xml`);
      detail=publicVacancy(parse(detailBody,'Vacancy'));
      if (detail['@_id']!==entry.id || !versionOf(detail,entry.version['@_language']) || !text(versionOf(detail,entry.version['@_language'])?.Title)) throw Error('EASYCRUIT_DETAIL_ID_OR_TITLE_MISMATCH');
    } catch(error) {assertSourceRunning();detail=undefined;detailFailurePayload=detailBody;detailError=String(error).slice(0,500);issues.push(`DETAIL_READ_FAILED:${entry.id}`);}
    const v=(detail&&versionOf(detail,entry.version['@_language']))??entry.version;
    const countries=[...new Set(array<Xml>(v.Region?.Country).map(c=>text(c['@_name'])).filter((x):x is string=>!!x))];
    const items=array<Xml>(v.Categories?.Item),category=(type:string)=>items.filter(i=>i['@_type']===type).map(i=>text(i['#text'])).filter(Boolean).join(' / ')||undefined;
    const employer=text(v.AlternativeCompanyName);
    const job:NormalizedJob={externalId:entry.id,title:v.Title,url:entry.url,language:text(v['@_language']),
      location:text(v.Location),country:countries.length===1?countries[0]:undefined,
      ...(employer?{company:employer,employerEvidence:{rawName:employer,path:'Versions.Version.AlternativeCompanyName',rule:'NATIVE_POSTING_EMPLOYER'}}:{}),
      description:htmlToPlainText(v.Description)||undefined,contract:category('duration'),workingTime:category('extent'),department:category('position-type'),
      // date_start/date_end are vacancy dates, not established publication
      // timestamps. date_modified is never used as datePosted either.
      raw:{listing:entry.raw,detail,detailError,detailFailurePayload,fieldEvidence:{country:{path:'Versions.Version.Region.Country',values:countries},
        dates:{status:'NATIVE_VACANCY_DATES_RETAINED_SEPARATELY',publicationDateSource:'SINGLE_PUBLIC_JOBPOSTING_ONLY'},
        versions:array<Xml>((detail??entry.raw).Versions?.Version).map(v=>v['@_language'])}},
    };
    try { return enrichPostingEvidence(job,await fetchText(entry.url)); }
    catch(error) {assertSourceRunning();publicPageError=String(error).slice(0,500);issues.push(`PUBLIC_PAGE_READ_FAILED:${entry.id}`);}
    return {...job,raw:{...(job.raw as object),publicPageError}};
  })));
  return {jobs,rejectedRows,complete:enumerationComplete(true,issues,rejectedRows),
    enumeration:{method:'DOCUMENTED_COMPLETE_XML_FEED_AND_DETAILS',endpoint,documentation:DOCUMENTATION,pages:1,rawCount:vacancies.length,
      termination:'FULL_XML_DOCUMENT',blockers:enumerationBlockers(issues),issues,pageEvidence:[{url:endpoint,checkedAt:new Date().toISOString(),sha256:createHash('sha256').update(xml).digest('hex'),offset:0,
        ids:[...seen],pagination:null,publisherCounter:'NOT_PUBLISHED',componentCounters:[`xmlVacancies=${vacancies.length}`,`uniqueIds=${seen.size}`]}]}};
}
