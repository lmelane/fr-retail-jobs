import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', async (orig) => ({ ...(await orig<Record<string, unknown>>()), fetchText: vi.fn(), fetchWithRetry: vi.fn() }));
import { fetchText, fetchWithRetry } from '../../lib/http.js';
import { parseTaleoDescription, parseTaleoListing, fetchTaleoJobs } from './taleo.js';
import { normalizeAdapterResult } from '../index.js';

/** Une ligne de résultats telle que lde.tbe.taleo.net la rend (Brown Thomas Arnotts, 2026-09-06). */
const ROW = `
<div class="oracletaleocwsv2-accordion-head-info">
<h4 class="oracletaleocwsv2-head-title"><a href="https://lde.tbe.taleo.net/lde02/ats/careers/v2/viewRequisition?org=ARNOTTS&cws=79&rid=7770" class="viewJobLink">2026 Christmas Team</a></h4>
<div tabindex="0" >Brown Thomas, Dublin</div>
<div tabindex="0" >7770</div>
</div>`;

const ROW_2 = ROW.replace(/7770/g, '7795').replace('2026 Christmas Team', 'Beauty Advisor &amp; Stylist').replace('Brown Thomas, Dublin', 'Arnotts, Dublin');

/** Une page `viewRequisition` vivante, réduite au bloc utile. */
const DETAIL = `
<div class="well oracletaleocwsv2-job-description"><strong> 2026 Christmas Team </strong>
<span class="small"> Location </span> <strong> Brown Thomas, Dublin </strong></div>
<div name="cwsJobDescription" tabindex="0" class="row"><div style="all: unset;">
<p class="MsoNormal"><span><strong>Unwrap a Magical Opportunity this Christmas</strong></span></p>
<p class="MsoNormal">At Brown Thomas Arnotts, we’re reinventing the very essence of retail through innovation.</p>
<ul><li><p>A passion for customer service</p></li></ul>
</div></div><link rel="stylesheet" href="https://staticlde.tbe.taleo.net/social-plugin.css" type="text/css"/>
<div class="oracletaleocwsv2-button-navigation oracletaleocwsv2-job-description clearfix">
<a href="https://lde.tbe.taleo.net/lde02/ats/careers/v2/searchResults?org=ARNOTTS&cws=79" class="btn back-button">Back</a>
<li title="Share job on LinkedIn" data-href="https://www.linkedin.com/shareArticle?title=Hiring+2026+Christmas+Team">x</li>
<a href="https://lde.tbe.taleo.net/lde02/ats/careers/v2/applyRequisition?org=ARNOTTS&cws=79&rid=7770">Apply Now</a>
</div>`;

const GONE = `<span class='text-danger'>This job has moved or is no longer available. Please search our <a href='#'>current job openings</a>.</span>`;

describe('parseTaleoListing', () => {
  it('lit identifiant, titre, lieu et lien depuis une ligne', () => {
    const [job] = parseTaleoListing(ROW);
    expect(job.externalId).toBe('7770');
    expect(job.title).toBe('2026 Christmas Team');
    expect(job.location).toBe('Brown Thomas, Dublin');
    expect(job.url).toBe('https://lde.tbe.taleo.net/lde02/ats/careers/v2/viewRequisition?org=ARNOTTS&cws=79&rid=7770');
  });

  it('décode les entités du titre et lit plusieurs lignes', () => {
    const jobs = parseTaleoListing(ROW + ROW_2);
    expect(jobs).toHaveLength(2);
    expect(jobs[1].title).toBe('Beauty Advisor & Stylist');
    expect(jobs[1].location).toBe('Arnotts, Dublin');
  });

  it('déduplique deux lignes du même identifiant', () => {
    expect(parseTaleoListing(ROW + ROW)).toHaveLength(1);
  });

  it('rend une liste vide sur la page d’un octet servie hors session', () => {
    expect(parseTaleoListing('\n')).toHaveLength(0);
  });
});

describe('parseTaleoDescription', () => {
  it('extrait le texte de l’offre sans les boutons Retour/Partager/Postuler', () => {
    const text = parseTaleoDescription(DETAIL);
    expect(text).toContain('Unwrap a Magical Opportunity');
    expect(text).toContain('passion for customer service');
    expect(text).not.toContain('Apply Now');
    expect(text).not.toContain('Back');
    expect(text).not.toContain('<');
  });

  it('rend undefined sur une réquisition retirée, pour garder les champs de liste', () => {
    expect(parseTaleoDescription(GONE)).toBeUndefined();
  });
});

// ——— l2 (2026-09-06) : la fiche TBE publie bien une date, en JSON-LD (« 2026-08-20 00:00:00.0 ») ———
import { readFileSync } from 'node:fs';
import { parseTaleoDetail, applyTaleoDetail } from './taleo.js';

describe('parseTaleoDetail — l2 : date de publication et texte', () => {
  const BROWN_THOMAS = readFileSync(new URL('./__fixtures__/l2-taleo-brownthomas-detail.html', import.meta.url), 'utf8');

  it('lit le datePosted du JSON-LD malgré son format « date heure.0 »', () => {
    const detail = parseTaleoDetail(BROWN_THOMAS);
    expect(detail.postedAt?.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(detail.description).toContain('Unwrap a Magical Opportunity');
  });

  it('rend une date absente sur une réquisition retirée', () => {
    expect(parseTaleoDetail(GONE).postedAt).toBeUndefined();
    expect(parseTaleoDetail(GONE).description).toBeUndefined();
  });

  it('reads the employer from the matching native requisition in live and retained readers', async () => {
    const { recoverRetainedPublication } = await import('../../publication/recovery.js');
    const job = parseTaleoListing(ROW)[0];
    const live = applyTaleoDetail(job, BROWN_THOMAS);
    expect(live).toMatchObject({ company: 'Brown Thomas Arnotts', employerEvidence: {
      rawName: 'Brown Thomas Arnotts', path: 'hiringOrganization.name', rule: 'HIRING_ORGANIZATION_LABEL' } });
    const raw = { ...job.raw as object, detailHtml: BROWN_THOMAS, detailUrl: job.url };
    const retained = recoverRetainedPublication('taleo', raw, {
      externalId: job.externalId, url: job.url, observedAt: new Date('2026-09-23T10:00:00Z'), config: {} });
    expect(retained).toMatchObject({ status: 'RECOVERABLE', job: { company: live.company, employerEvidence: live.employerEvidence } });
  });

  it('does not borrow an employer from another requisition or infer one from the description', () => {
    const job = parseTaleoListing(ROW)[0];
    expect(applyTaleoDetail(job, BROWN_THOMAS.replace(/7770/g, '8888')).company).toBeUndefined();
    expect(applyTaleoDetail(job, BROWN_THOMAS.replace('"value" : "7770"', '"value" : "8888"')).company).toBeUndefined();
    expect(applyTaleoDetail(job, BROWN_THOMAS + BROWN_THOMAS).company).toBeUndefined();
    expect(applyTaleoDetail(job, DETAIL).company).toBeUndefined();
    expect(applyTaleoDetail(job, GONE).company).toBeUndefined();
  });
});

/**
 * LE CONTRAT DES IDENTIFIANTS CANONIQUES.
 *
 * `rid` est l'identifiant natif de la réquisition TBE, et le même chemin d'identité que `externalId`. La preuve
 * d'énumération le déclare sur CHAQUE page servie — un contrat partiel n'est pas un contrat — sans quoi la
 * source ne peut démontrer aucune absence. Le témoin passe au rouge si `canonicalIds` est retiré.
 */
describe('Taleo TBE — contrat des identifiants canoniques', () => {
  beforeEach(() => vi.resetAllMocks());

  const page = (html: string) => ({ text: async () => html, headers: { get: () => 'JSESSIONID=abc; Path=/' } }) as unknown as Response;

  it('déclare canonicalIds sur chaque page, exactement les rid observés', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(page(ROW + ROW_2));
    // Page 2 : le portail re-sert la première page passé la dernière, donc aucune ligne neuve.
    vi.mocked(fetchText).mockResolvedValue(ROW);
    const r = await fetchTaleoJobs({ origin: 'https://lde.tbe.taleo.net/lde02', org: 'ARNOTTS', cws: 79, withDescriptions: false });

    const pages = r.enumeration!.pageEvidence!;
    expect(pages).toHaveLength(2);
    for (const pe of pages) expect(Object.hasOwn(pe, 'canonicalIds')).toBe(true);
    expect(pages.map(pe => pe.canonicalIds)).toEqual([['7770', '7795'], ['7770']]);
    expect(r.jobs.map(j => j.externalId)).toEqual(['7770', '7795']);

    const n = normalizeAdapterResult(r);
    expect(n.enumeration?.canonicalIdViolations).toBeUndefined();
    expect(n.enumeration?.issues ?? []).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
  });

  it('couvre les DEUX sections : aucune page muette quand plusieurs cws sont lues', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(page(ROW)).mockResolvedValueOnce(page(ROW_2));
    vi.mocked(fetchText).mockResolvedValue('\n');  // page d'un octet : fin de section
    const r = await fetchTaleoJobs({ origin: 'https://lde.tbe.taleo.net/lde02', org: 'ARNOTTS', cws: [79, 70], withDescriptions: false });

    const pages = r.enumeration!.pageEvidence!;
    expect(pages.every(pe => Object.hasOwn(pe, 'canonicalIds'))).toBe(true);
    expect(pages.flatMap(pe => pe.canonicalIds ?? [])).toEqual(['7770', '7795']);
    expect(normalizeAdapterResult(r).enumeration?.canonicalIdViolations).toBeUndefined();
  });
});

it('retains native HTML fragments that reproduce the publication and reject another detail URL', async () => {
  const { recoverRetainedPublication } = await import('../../publication/recovery.js');
  vi.mocked(fetchWithRetry).mockResolvedValue(new Response(ROW));
  vi.mocked(fetchText).mockImplementation(async url => String(url).includes('viewRequisition') ? DETAIL : ROW);
  const config={origin:'https://lde.tbe.taleo.net/lde02', org:'ARNOTTS',cws:79};
  const {jobs}=await fetchTaleoJobs(config);const job=jobs[0];
  const context={externalId:job.externalId,url:job.url,observedAt:new Date('2026-09-23T10:00:00Z'),config};
  expect(recoverRetainedPublication('taleo',JSON.parse(JSON.stringify(job.raw)),context).status).toBe('RECOVERABLE');
  expect(recoverRetainedPublication('taleo',{...job.raw as object,detailUrl:'https://wrong.example/job'},context))
    .toMatchObject({status:'RECOLLECT_OR_REVIEW',reason:'DETAIL_IDENTITY_MISMATCH'});
});
