import {describe,expect,it} from 'vitest';import {personioDetail} from './personioDetail.js';
const make=(data:unknown)=>'<script>self.__next_f.push('+JSON.stringify([1,'5:'+JSON.stringify(data)+'\n'])+')</script>';
const job={id:42,name:'Advisor',created_at:'2020-01-01',published_at:'2026-09-02T12:00:00Z',fields:[{label:'Mission',value:'<p>Advise clients</p>'}],office_addresses:[{city:'Paris',country:'FR'}]};
describe('Personio Next model evidence',()=>{
 it('reads the matching position publication and employer instead of creation time',()=>{
  const r=personioDetail(make(['$',null,{job,careerSiteSettings:{company_name:'Maison'}}]),'42');
  expect(r.job).toMatchObject({description:'Mission\nAdvise clients',country:'FR',city:'Paris',employer:'Maison'});
  expect(r.job?.postedAt?.toISOString()).toBe('2026-09-02T12:00:00.000Z');expect(r.evidence).toMatchObject({position:job});
 });
 it('never uses another position or conflicting model',()=>{
  expect(personioDetail(make({job}),'999').job).toBeNull();
  expect(personioDetail(make([{job},{job:{...job,published_at:'2026-08-01'}}]),'42').job).toBeNull();
 });
 it('preserves multiple addresses without arbitrarily selecting a country',()=>{
  const r=personioDetail(make({job:{...job,office_addresses:[{country:'FR'},{country:'DE'}]}}),'42');
  expect(r.job?.country).toBeUndefined();expect(r.job?.city).toBeUndefined();
 });
 it('does not let a preceding Flight text record hide a complete model chunk',()=>{
  const text='<script>self.__next_f.push('+JSON.stringify([1,'4:T9,raw text!'])+')</script>';
  expect(personioDetail(text+make({job}),'42').job?.country).toBe('FR');
 });
 it('joins split flight chunks without executing scripts',()=>{
  const model='5:'+JSON.stringify({job})+'\n';const midpoint=Math.floor(model.length/2);
  const html=[model.slice(0,midpoint),model.slice(midpoint)].map(part=>'<script>self.__next_f.push('+JSON.stringify([1,part])+')</script>').join('');
  expect(personioDetail(html,'42').job?.country).toBe('FR');
 });
 it('resolves UTF-8 length-prefixed text, hint rows and delimiters inside text',()=>{
  const text='<p>Créativité 👜 et conseil ]) clientèle</p>';
  const stream=':HL["/style.css","style"]\n17:T'+Buffer.byteLength(text).toString(16)+','+text+'5:'+JSON.stringify({job:{...job,fields:[{label:'Mission',value:'$17'}]}})+'\n';
  const html=[stream.slice(0,45),stream.slice(45)].map(part=>'<script>self.__next_f.push('+JSON.stringify([1,part])+')</script>').join('');
  const result=personioDetail(html,'42');
  expect(result.job?.description).toBe('Mission\nCréativité 👜 et conseil ]) clientèle');
  expect(result.evidence).toMatchObject({resolvedText:{'$17':text}});
 });
 it('reports unresolved text and does not emit a partial description',()=>{
  const r=personioDetail(make({job:{...job,fields:[{label:'Mission',value:'$17'},{label:'Other',value:'known'}]}}),'42');
  expect(r.job?.description).toBeUndefined();
  expect(r.evidence).toMatchObject({descriptionReadError:'UNRESOLVED_FLIGHT_TEXT',unresolvedTextReferences:['$17']});
 });
 it('refuses to consume truncated length-prefixed records as job content',()=>{
  const stream='17:Tffff,not complete';
  const r=personioDetail('<script>self.__next_f.push('+JSON.stringify([1,stream])+')</script>','42');
  expect(r.job).toBeNull();expect(r.evidence).toMatchObject({streamReadError:'TRUNCATED_FLIGHT_ROW'});
 });
});
