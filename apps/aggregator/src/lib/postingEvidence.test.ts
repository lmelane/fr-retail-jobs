import { describe, expect, it } from 'vitest';
import { readPostingEvidence, enrichPostingEvidence } from './postingEvidence.js';
import { normalizeMagnetOffer } from '../ats/adapters/magnet.js';
import { parseMicrodataDetail, parseSuccessFactorsVisibleDate } from '../ats/adapters/successfactors.js';
import { parseAltamiraDetail } from '../ats/adapters/altamira.js';
const url='https://careers.example.com/jobs/123/job';
const posting={ '@type':'JobPosting',title:'Vendeur',datePosted:'2026-08-26T04:00:00.000Z',description:'<p>Full mission</p><p>Full profile</p>' };
const html=(value:unknown)=>`<script type="application/ld+json">${JSON.stringify(value)}</script>`;
describe('source publication evidence',()=>{
 it('reads a single JobPosting inside a graph, never a WebPage modification date',()=>{
  const result=readPostingEvidence(html({'@graph':[{'@type':'WebPage',dateModified:'2026-09-08'},posting]}),url);
  expect(result.postedAt?.toISOString()).toBe('2026-08-26T04:00:00.000Z');
  expect(result.evidence.jobPosting).toEqual(posting);
  expect(readPostingEvidence(html({'@type':'WebPage',datePosted:'2026-09-08'}),url).postedAt).toBeUndefined();
 });
 it('does not select one posting arbitrarily from a list or turn malformed JSON into a date',()=>{
  expect(readPostingEvidence(html([posting,{...posting,title:'Other'}]),url).postedAt).toBeUndefined();
  expect(readPostingEvidence('<script type="application/ld+json">bad</script>',url).postedAt).toBeUndefined();
 });
 it('enriches the full detail and retains the original listing evidence',()=>{
  const job=enrichPostingEvidence({externalId:'123',title:'Vendeur',url,description:'Excerpt',raw:{reference:'2026-123'}},html(posting));
  expect(job.postedAt?.toISOString()).toBe(posting.datePosted);
  expect(job.description).toContain('Full profile');
  expect(job.raw).toMatchObject({reference:'2026-123',postingEvidence:{jobPosting:posting}});
 });
 it('decodes the actual Magnet publication_date, not its processing timestamp',()=>{
  const raw={id:'1',title:'Vendeur',link:url,publication_date:'2026-04-16T00:00:00.000Z',lastProcessedDate:'2026-09-02T02:24:22.000Z'};
  expect(normalizeMagnetOffer(raw,'https://example.com')?.postedAt?.toISOString()).toBe(raw.publication_date);
  expect(normalizeMagnetOffer({...raw,publication_date:undefined},'https://example.com')?.postedAt).toBeUndefined();
 });
 it('reads the explicit Adidas/RMK visible date token, not a random date or ambiguous numeric date',()=>{
  const token='<span data-careersite-propertyid="date" lang="en-US">Aug 17, 2026</span>';
  expect(parseMicrodataDetail(token).postedAt?.toISOString()).toBe('2026-08-17T00:00:00.000Z');
  expect(parseSuccessFactorsVisibleDate('<footer>Aug 17, 2026</footer>')).toBeUndefined();
  expect(parseSuccessFactorsVisibleDate(token.replace('Aug 17, 2026','09/08/2026'))).toBeUndefined();
  expect(parseSuccessFactorsVisibleDate(token.replace('Aug 17, 2026','Feb 31, 2026'))).toBeUndefined();
 });
 it('adds the Altamira detail date without replacing its established posting identity',()=>{
  const job=parseAltamiraDetail({externalId:'123',team:'456',title:'Vendeur'},html(posting),url);
  expect(job.externalId).toBe('123');expect(job.postedAt?.toISOString()).toBe(posting.datePosted);
 });
});
