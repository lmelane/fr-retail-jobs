import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js',()=>({fetchText:vi.fn()}));
import {fetchText} from '../../lib/http.js';
import {fetchEasycruitJobs} from './easycruit.js';
import {normalizeAdapterResult} from '../index.js';
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

/**
 * LE CONTRAT DES IDENTIFIANTS CANONIQUES — témoin.
 *
 * Il ÉCHOUE si `canonicalIds` est retiré de la preuve (contrat absent, plus aucune absence démontrable) et il
 * échoue si un rejet perd son `canonicalId` : `normalizeAdapterResult` voit alors un identifiant observé sans
 * disposition et réfute la preuve.
 */
describe('EasyCruit — contrat des identifiants canoniques',()=>{
 it('déclare exactement les @id natifs observés, et ils sont ceux des offres produites',async()=>{
  vi.mocked(fetchText).mockImplementation(async url=>String(url).endsWith('list.xml')?feed(vacancy('101')+vacancy('202')):String(url).endsWith('.xml')?vacancy(String(url).includes('/202.')?'202':'101'):'<html/>');
  const r=await fetchEasycruitJobs({host});
  const page=r.enumeration?.pageEvidence?.[0];
  expect(page).toBeDefined();
  // La propriété DOIT être déclarée : sans elle, aucune absence n'est démontrable sur cette source.
  expect(Object.hasOwn(page!,'canonicalIds')).toBe(true);
  expect([...page!.canonicalIds!].sort()).toEqual(['101','202']);
  // Même vocabulaire des deux côtés : la preuve et les offres produites.
  expect([...page!.canonicalIds!].sort()).toEqual(r.jobs.map(j=>j.externalId).sort());
  expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(true);
 });

 it('un @id vu puis rejeté reste dans la preuve, nommé comme disposition',async()=>{
  // 303 : `@id` exploitable mais URL native hors tenant — vu, rejeté, jamais un trou.
  const foreign=vacancy('303').replaceAll(`${origin}/vacancy/303/5`,'https://another.easycruit.com/vacancy/303/5');
  vi.mocked(fetchText).mockImplementation(async url=>String(url).endsWith('list.xml')?feed(vacancy('101')+foreign):String(url).endsWith('.xml')?vacancy('101'):'<html/>');
  const r=await fetchEasycruitJobs({host});
  expect(r.jobs.map(j=>j.externalId)).toEqual(['101']);
  expect([...r.enumeration!.pageEvidence![0].canonicalIds!].sort()).toEqual(['101','303']);
  // Sans ce `canonicalId`, « 303 » serait un identifiant observé sans disposition : contrat ROMPU.
  expect(r.rejectedRows?.map(row=>row.canonicalId)).toContain('303');
 });

 it('un doublon natif est déclaré une seule fois et disposé sur le même identifiant',async()=>{
  vi.mocked(fetchText).mockImplementation(async url=>String(url).endsWith('list.xml')?feed(vacancy()+vacancy()):String(url).endsWith('.xml')?vacancy():'<html/>');
  const r=await fetchEasycruitJobs({host});
  expect(r.enumeration?.pageEvidence?.[0].canonicalIds).toEqual(['101']);
  expect(r.rejectedRows?.[0]).toMatchObject({reason:'DUPLICATE_NATIVE_ID',canonicalId:'101'});
 });

 it('une ligne sans @id exploitable est comptée, jamais inventée, et retire le droit d\'attester',async()=>{
  vi.mocked(fetchText).mockImplementation(async url=>String(url).endsWith('list.xml')?feed(vacancy('101')+'<Vacancy><Versions/></Vacancy>'):String(url).endsWith('.xml')?vacancy('101'):'<html/>');
  const r=await fetchEasycruitJobs({host});
  expect(r.enumeration?.pageEvidence?.[0].canonicalIds).toEqual(['101']);
  expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(false);
  expect(r.enumeration?.pageEvidence?.[0].componentCounters).toContain('anonymousRows=1');
 });

 /** Le contrat tel que la chaîne le juge réellement : la preuve doit survivre à `normalizeAdapterResult`. */
 it('le contrat passe la vérification centrale : aucune violation, preuve conservée',async()=>{
  const foreign=vacancy('303').replaceAll(`${origin}/vacancy/303/5`,'https://another.easycruit.com/vacancy/303/5');
  vi.mocked(fetchText).mockImplementation(async url=>String(url).endsWith('list.xml')?feed(vacancy('101')+foreign):String(url).endsWith('.xml')?vacancy('101'):'<html/>');
  const r=normalizeAdapterResult(await fetchEasycruitJobs({host}));
  expect(r.enumeration?.canonicalIdViolations).toBeUndefined();
  expect(r.enumeration?.issues ?? []).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
 });
});
