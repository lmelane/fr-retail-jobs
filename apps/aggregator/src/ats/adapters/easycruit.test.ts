import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js',()=>({fetchText:vi.fn()}));
import {fetchText} from '../../lib/http.js';
import {fetchEasycruitJobs} from './easycruit.js';
const host='example.easycruit.com',origin=`https://${host}`;
const version=(language='en',title='Sales advisor',countries=['France'])=>`<Version language="${language}"><Title>${title}</Title><AlternativeCompanyName>Example</AlternativeCompanyName><Location>Paris</Location><Description><![CDATA[<p>A real position.</p>]]></Description><Region>${countries.map(name=>`<Country name="${name}"/>`).join('')}</Region><Categories><Item type="duration">Permanent</Item><Item type="extent">Full-time</Item></Categories></Version>`;
const vacancy=(id='101',versions=version())=>`<Vacancy id="${id}" date_start="2026-08-01" date_end="2026-10-31" date_modified="2026-09-01"><Versions>${versions}</Versions><Departments><Department id="5"><Name>Corporate Sweden</Name><VacancyURL>${origin}/vacancy/${id}/5</VacancyURL><ContactPersons>Unneeded contact</ContactPersons></Department></Departments></Vacancy>`;
const feed=(rows=vacancy())=>`<VacancyList xmlns="urn:EasyCruit" generated="2026-09-09T12:00:00">${rows}</VacancyList>`;
beforeEach(()=>{vi.resetAllMocks();vi.mocked(fetchText).mockImplementation(async url=>String(url).endsWith('list.xml')?feed():String(url).endsWith('.xml')?vacancy():'<html><title>Sales advisor</title></html>')});
describe('EasyCruit public XML protocol',()=>{
 it('reads the unfiltered list, native detail and publication evidence without inventing dates',async()=>{
  const r=await fetchEasycruitJobs({host});expect(r.complete).toBe(true);expect(r.declaredTotal).toBeUndefined();expect(r.jobs).toHaveLength(1);
  expect(r.jobs[0]).toMatchObject({externalId:'101',company:'Example',country:'France',contract:'Permanent',workingTime:'Full-time',description:'A real position.'});
  expect(r.jobs[0].postedAt).toBeUndefined();expect(r.jobs[0].validThrough).toBeUndefined();expect(JSON.stringify(r.jobs[0].raw)).not.toContain('Unneeded contact');
  expect(fetchText).toHaveBeenCalledWith(`${origin}/export/xml/vacancy/list.xml`);expect(fetchText).toHaveBeenCalledWith(`${origin}/export/xml/vacancy/101.xml`);
 });
 it('takes publication dates only from a single actual JobPosting',async()=>{
  vi.mocked(fetchText).mockImplementation(async url=>String(url).endsWith('list.xml')?feed():String(url).endsWith('.xml')?vacancy():`<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:'Sales advisor',description:'Published full description',datePosted:'2026-09-03',url:`${origin}/vacancy/101/5`})}</script>`);
  expect((await fetchEasycruitJobs({host})).jobs[0].postedAt?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
 });
 it('retains all language versions and countries without choosing an arbitrary country',async()=>{
  const row=vacancy('101',version()+version('fr','Conseiller de vente',['France','Belgique']));vi.mocked(fetchText).mockImplementation(async url=>String(url).endsWith('list.xml')?feed(row):String(url).endsWith('.xml')?row:'<html/>');
  const r=await fetchEasycruitJobs({host,language:'fr'});expect(r.jobs).toHaveLength(1);expect(r.jobs[0].title).toBe('Conseiller de vente');expect(r.jobs[0].country).toBeUndefined();
  expect((r.jobs[0].raw as any).detail.Versions.Version).toHaveLength(2);
 });
 it('fails completion on duplicate native IDs and preserves rejected evidence',async()=>{
  vi.mocked(fetchText).mockImplementation(async url=>String(url).endsWith('list.xml')?feed(vacancy()+vacancy()):String(url).endsWith('.xml')?vacancy():'<html/>');
  const r=await fetchEasycruitJobs({host});expect(r.complete).toBe(false);expect(r.jobs).toHaveLength(1);expect(r.rejectedRows?.[0].reason).toBe('DUPLICATE_NATIVE_ID');
 });
 it('rejects malformed XML, non-feed HTML and entity declarations',async()=>{
  for(const body of ['<VacancyList><Vacancy></VacancyList>','<html/>','<!DOCTYPE foo><VacancyList/>']){vi.mocked(fetchText).mockResolvedValue(body);await expect(fetchEasycruitJobs({host})).rejects.toThrow(/EASYCRUIT_INVALID/);}
 });
 it('keeps a listed opening visible while reporting a failed or mismatched detail',async()=>{
  vi.mocked(fetchText).mockImplementation(async url=>String(url).endsWith('list.xml')?feed():String(url).endsWith('.xml')?vacancy('999'):'<html/>');
  const r=await fetchEasycruitJobs({host});expect(r.complete).toBe(false);expect(r.jobs[0].externalId).toBe('101');expect((r.jobs[0].raw as any).detailFailurePayload).toContain('999');
 });
 it('accepts a documented empty XML list without inventing a publisher counter',async()=>{
  vi.mocked(fetchText).mockResolvedValue(feed(''));const r=await fetchEasycruitJobs({host});expect(r.complete).toBe(true);expect(r.jobs).toEqual([]);expect(r.declaredTotal).toBeUndefined();
 });
 it('reports native posting URLs outside the tenant as rejected rows',async()=>{
  vi.mocked(fetchText).mockResolvedValue(feed().replaceAll(origin,'https://another.easycruit.com'));const r=await fetchEasycruitJobs({host});expect(r.complete).toBe(false);expect(r.jobs).toEqual([]);expect(r.rejectedRows).toHaveLength(1);
 });
 it('refuses invalid tenant settings before any network access',async()=>{
  for(const bad of ['localhost','www.easycruit.com','example.easycruit.com.evil.test','https://example.easycruit.com'])await expect(fetchEasycruitJobs({host:bad})).rejects.toThrow('EASYCRUIT_INVALID');
  expect(fetchText).not.toHaveBeenCalled();
 });
});
