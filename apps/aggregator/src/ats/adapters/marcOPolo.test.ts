import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withCaptureContext, type CaptureRecord } from '../../capture/context.js';

vi.mock('../../lib/hostGate.js', () => ({ withHostGate: async (_url: string, run: () => Promise<unknown>) => run(), reportThrottle: () => {}, reportSuccess: () => {} }));
// Les attentes du transport et de la relecture différée sont sautées ; le rejeu, lui, n'attend jamais.
vi.mock('../../lib/sourceBudget.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/sourceBudget.js')>()), sourceDelay: vi.fn(async () => undefined), sourceDeadlineReached: vi.fn(() => false) }));

import { fetchMarcOPoloJobs, marcOPoloSettings, readEmployerFromJobPage, readMarcOPoloRaw, readPublishedList, vacancyExternalId, vacancyPageUrl } from './marcOPolo.js';
import { fetchAtsJobs, normalizeAdapterResult } from '../index.js';
import { recoverRetainedPublication } from '../../publication/recovery.js';
import { readLocations } from '../../facts/locations.js';
import { sourceDeadlineReached } from '../../lib/sourceBudget.js';
import { isMarcOPoloSpontaneousApplication, MARC_O_POLO_SPONTANEOUS_HOLD } from './marcOPolo.js';
import { isNativeEvidenceRetention, publicationDisposition, retentionStatus } from '../../pipeline/publicationDisposition.js';

/**
 * MARC O'POLO (D-485) — le lecteur dédié, sur les réponses RÉELLES du site du 30/09/2026.
 *
 *  - `marc-o-polo-reponses-20260930.json.gz` : la lecture complète en direct du 30/09 (page de la liste, liste de
 *    l'API, 116 fiches), corps tels que reçus (`audits/2026-09-30/marc-o-polo/scripts/lecture-en-direct.mts`) ;
 *  - `marc-o-polo-liste-filtree-20260930.html.gz` : la page `?page=1` servie par CloudFront à 09:12, rendue avec les
 *    filtres d'un autre visiteur (« 15 Positions ») ;
 *  - `marc-o-polo-liste-prod-0645-20260930.html.gz` : la page de la liste archivée en production le 30/09 à 06:45
 *    (lot 63f23d1e, séquence 2, RawBlob 935f27aa…) : 119 offres, dont trois fermées avant 09:12 ;
 *  - `marc-o-polo-sitemap-en-20260930.xml.gz` : le plan du site anglais, qui liste les adresses des offres.
 * Une offre fermée répond HTTP 200 `{}` (mesuré sur 2026-4212, fermée entre 06:45 et 09:12, et sur un identifiant
 * inventé) : c'est le corps servi ici pour les trois fermées.
 */
const fixture = (name: string) => gunzipSync(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url))).toString('utf8');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
type Archived = { url: string; status: number; contentType: string | null; body: string };
const archiveText = fixture('marc-o-polo-reponses-20260930.json.gz');
const archive = JSON.parse(archiveText) as Archived[];
const filteredPage = fixture('marc-o-polo-liste-filtree-20260930.html.gz');
const prodPage = fixture('marc-o-polo-liste-prod-0645-20260930.html.gz');
const sitemap = fixture('marc-o-polo-sitemap-en-20260930.xml.gz');
/**
 * Les pages d'offre lues pour l'employeur (D-489) : 2026-4270 et 2026-4271, les deux premières de la liste du 30/09,
 * lues en direct à 12:20 sous l'identité du collecteur ; et la page 2026-4345 archivée en production à 06:45 par le
 * lecteur générique (lot 63f23d1e, séquence 3), qui rattachait les offres en ligne.
 */
const page4270 = fixture('marc-o-polo-fiche-4270-20260930.html.gz');
const page4271 = fixture('marc-o-polo-fiche-4271-20260930.html.gz');
const prodJobPage = fixture('marc-o-polo-fiche-4345-prod-0645-20260930.html.gz');

const START = 'https://company.marc-o-polo.com/en/career/start-creating-with-us/our-jobs';
const API = 'https://vhfco59ro6.execute-api.eu-central-1.amazonaws.com/production';
const config = { reader: 'marc-o-polo-vacancies', startUrl: START, apiUrl: API, detailRetryDelayMs: 0 };
const LIST_URL = `${API}/vacancies?language=en`;
const CLOSED = ['2026-4212', '2026-4329', '2026-4335'];
const byUrl = new Map(archive.filter((r) => r.status === 200).map((r) => [r.url, r]));
const livePage = byUrl.get(START)!.body;
const apiList = JSON.parse(byUrl.get(LIST_URL)!.body) as Array<{ id: string; title: string }>;
const detailUrl = (id: string) => `${API}/vacancies/${id}?language=en`;

type Plan = { page?: string; list?: unknown; detail?: (id: string, attempt: number) => Response | undefined;
  jobPage?: (id: string) => Response | undefined };
const response = (body: string, status = 200, type = 'application/json') => new Response(body, { status, headers: { 'content-type': type } });
function network(plan: Plan = {}) {
  const attempts = new Map<string, number>();
  const mock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const n = (attempts.get(url) ?? 0) + 1; attempts.set(url, n);
    if (url === START) return response(plan.page ?? livePage, 200, 'text/html;charset=utf-8');
    if (url === LIST_URL) return response(plan.list === undefined ? byUrl.get(LIST_URL)!.body : JSON.stringify(plan.list));
    const pageId = url.startsWith(`${START}/`) ? /(\d{4}-\d{4})$/.exec(url)?.[1] : undefined;
    if (pageId) {
      const planned = plan.jobPage?.(pageId);
      if (planned) return planned;
      const html = JOB_PAGES[pageId];
      return html ? response(html, 200, 'text/html;charset=utf-8') : response('<html>not found</html>', 404, 'text/html');
    }
    const id = /\/vacancies\/(\d{4}-\d{4})\?language=en$/.exec(url)?.[1];
    if (id) {
      const planned = plan.detail?.(id, n);
      if (planned) return planned;
      const archived = byUrl.get(url);
      return archived ? response(archived.body) : response('{}');
    }
    throw new Error(`requête inattendue : ${url}`);
  });
  vi.stubGlobal('fetch', mock);
  return { mock, attempts };
}
const read = async (plan: Plan = {}, settings: Record<string, unknown> = config) => { network(plan); return normalizeAdapterResult(await fetchMarcOPoloJobs(settings)); };
const counters = (result: Awaited<ReturnType<typeof read>>) => result.enumeration!.pageEvidence![0].componentCounters;
const JOB_PAGES: Record<string, string> = { '2026-4270': page4270, '2026-4271': page4271 };
const html = (body: string) => response(body, 200, 'text/html;charset=utf-8');
const EMPLOYER = 'Marc O’Polo';

beforeEach(() => vi.stubEnv('PIPELINE_PAUSED', '0'));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Marc O'Polo — prémisses : ce que le site publie réellement le 30/09", () => {
  it('fixtures intactes ; la page, l’API et le plan du site nomment les mêmes 116 offres', () => {
    expect(sha256(archiveText)).toBe(ARCHIVE_SHA256);
    expect(sha256(prodPage)).toBe('935f27aaf044ee91267acdc14c5dca8a9faf126beb8ffdeac40e4b34bee24324');
    expect(sha256(filteredPage)).toBe(FILTERED_SHA256);
    expect(sha256(sitemap)).toBe(SITEMAP_SHA256);
    expect(apiList).toHaveLength(116);
    const live = readPublishedList(livePage);
    expect(live).toMatchObject({ declaredApiUrl: API, counter: 116 });
    expect(new Set(live.ids)).toEqual(new Set(apiList.map((row) => row.id)));
    const sitemapIds = [...sitemap.matchAll(/our-jobs\/[^<]*-(\d{4}-\d{4})<\/loc>/g)].map((m) => m[1]);
    expect(new Set(sitemapIds)).toEqual(new Set(apiList.map((row) => row.id)));
  });

  it('la page filtrée par le cache affiche 15 et embarque pourtant la liste entière : le compteur ment, la charge non', () => {
    const filtered = readPublishedList(filteredPage);
    expect(filtered.counter).toBe(15);
    expect(filtered.ids).toHaveLength(116);
    expect(filteredPage).toContain('job-filters__selected-filter"');
  });

  it('la page archivée en production à 06:45 embarque 119 offres, dont trois que l’API ne liste plus', () => {
    const prod = readPublishedList(prodPage);
    expect(prod).toMatchObject({ declaredApiUrl: API, counter: 119 });
    const listed = new Set(apiList.map((row) => row.id));
    expect(prod.ids!.filter((id) => !listed.has(id)).sort()).toEqual(CLOSED);
  });
});

describe("Marc O'Polo — lecture complète et preuve de fin de liste", () => {
  it('116 offres, preuve FULL_RESPONSE, compteur de l’éditeur atteint, adresses identiques à celles du plan du site', async () => {
    const result = await read();
    expect(result.jobs).toHaveLength(116);
    expect(result.complete).toBe(true);
    expect(result.enumerationVerdict).toBe('PROVEN');
    expect(result.declaredTotal).toBe(116);
    expect(result.enumeration).toMatchObject({ termination: 'FULL_RESPONSE', issues: [], canonicalAbsenceProofUsable: true });
    expect(counters(result)).toEqual(expect.arrayContaining(['page.jobList=116', 'page.compteur=116', 'page.seule=0', 'api.seule=0']));
    const sitemapUrls = new Set([...sitemap.matchAll(/<loc>([^<]*our-jobs\/[^<]*)<\/loc>/g)].map((m) => m[1]));
    expect(result.jobs.every((job) => sitemapUrls.has(job.url))).toBe(true);
    expect(result.jobs.every((job) => job.externalId === vacancyExternalId(job.url))).toBe(true);
    expect(result.jobs.every((job) => (job.description?.length ?? 0) > 200 && job.postedAt && job.country)).toBe(true);
    // L'identité des publications déjà en base (lecteur générique : sha1 de l'adresse) est conservée.
    const berlin = result.jobs.find((job) => job.url.endsWith('/verk-ufer-outlet-berlin-wustermark-30h-m-w-d-2026-4360'));
    expect(berlin?.externalId).toBe('09f9737f05b6962a76ba4d1c00d964c1de86a01a');
    // Le code pays du site (« Czech Rep. » → CZ), jamais un libellé que la normalisation ne lit pas.
    expect(result.jobs.filter((job) => job.country === 'CZ')).toHaveLength(2);
  });

  it('une page filtrée servie par le cache ne change rien à la preuve : seule la liste embarquée compte', async () => {
    const result = await read({ page: filteredPage });
    expect(result.complete).toBe(true);
    expect(counters(result)).toEqual(expect.arrayContaining(['page.jobList=116', 'page.compteur=15', 'page.seule=0']));
  });

  it('une page en retard (06:45) : les trois offres qu’elle seule porte sont fermées chez l’éditeur, la preuve tient', async () => {
    const result = await read({ page: prodPage });
    expect(result.complete).toBe(true);
    expect(result.jobs).toHaveLength(116);
    expect(counters(result)).toEqual(expect.arrayContaining(['page.jobList=119', 'page.seule=3', 'page.seule.fermee=3']));
    // Fermées, elles ne sont ni publiées ni déclarées vues : leur publication antérieure pourra se fermer.
    const canonical = new Set(result.enumeration!.pageEvidence![0].canonicalIds);
    expect(result.jobs.some((job) => CLOSED.some((id) => job.url.endsWith(id)))).toBe(false);
    expect(canonical.size).toBe(116);
  });

  it('budget épuisé avant de vérifier les offres que seule la page porte : non vérifiées, la preuve tombe', async () => {
    vi.mocked(sourceDeadlineReached).mockReturnValue(true);
    try {
      const result = await read({ page: prodPage });
      expect(result.complete).toBe(false);
      expect([...result.enumeration!.issues!].sort()).toEqual(CLOSED.map((id) => `PUBLISHED_ONLY_UNVERIFIED:${id}`));
    } finally { vi.mocked(sourceDeadlineReached).mockReturnValue(false); }
  });

  it('une offre que la page publie, que l’API omet et dont la fiche est vivante réfute la preuve', async () => {
    const omitted = apiList[0].id;
    const result = await read({ list: JSON.parse(byUrl.get(LIST_URL)!.body).filter((row: { id: string }) => row.id !== omitted) });
    expect(result.complete).toBe(false);
    expect(result.enumeration!.issues).toContain(`API_LIST_OMITS_PUBLISHED:${omitted}`);
    expect(result.jobs).toHaveLength(115);
  });

  it('une API qui n’est plus celle que le site déclare réfute la preuve', async () => {
    const result = await read({ page: livePage.replace(`AWS_URL:"${API}"`, 'AWS_URL:"https://abc123.execute-api.eu-central-1.amazonaws.com/production"') });
    expect(result.complete).toBe(false);
    expect(result.enumeration!.issues).toContain('PUBLISHED_API_URL_CHANGED');
    expect(result.jobs).toHaveLength(116);
  });

  it('une page sans liste embarquée ne prouve rien, mais les offres sont lues', async () => {
    const result = await read({ page: livePage.replace(/<script[^>]*id="__NUXT_DATA__"[^>]*>[\s\S]*?<\/script>/, '') });
    expect(result.complete).toBe(false);
    expect(result.enumeration!.issues).toEqual(['PUBLISHED_LIST_UNREADABLE:NUXT_PAYLOAD_MISSING']);
    expect(result.jobs).toHaveLength(116);
  });

  it('une page de la liste en échec (403) ne prouve rien, mais les offres sont lues', async () => {
    network();
    const { mock } = network();
    const base = mock.getMockImplementation()!;
    mock.mockImplementation(async (input) => String(input) === START ? response('{"message":"Forbidden"}', 403) : base(input));
    const result = normalizeAdapterResult(await fetchMarcOPoloJobs(config));
    expect(result.complete).toBe(false);
    expect(result.enumeration!.issues).toEqual(['PUBLISHED_LIST_UNREADABLE:PAGE_FETCH_FAILED']);
    expect(result.jobs).toHaveLength(116);
  });

  it('un identifiant répété dans la liste de l’API réfute la preuve', async () => {
    const rows = JSON.parse(byUrl.get(LIST_URL)!.body);
    const result = await read({ list: [...rows, rows[5]] });
    expect(result.complete).toBe(false);
    expect(result.rejectedRows?.map((row) => row.reason)).toContain('DUPLICATE_LISTING_ID');
  });
});

describe("Marc O'Polo — l'employeur déclaré par le site (D-489)", () => {
  it('prémisse : la page archivée en production par le lecteur générique et les deux pages lues déclarent le même nom', () => {
    expect(sha256(prodJobPage)).toBe('7aaa96e8982c04af3aa40d6c6750064e1010fcaa517440306b6921fced93245d');
    expect(sha256(page4270)).toBe('b41af9bf5e521dc0612c4fa3a27989167ed83cef1c691df14aace54a13c39ac9');
    expect(sha256(page4271)).toBe('0dae710eb99a70127a92250128da01daf2c0414dd82ba25f64d5cb9580503a87');
    const title = (id: string) => JSON.parse(byUrl.get(detailUrl(id))!.body).title as string;
    expect(readEmployerFromJobPage(prodJobPage, 'Lagerist Outlet Radolfzell (25- 30h) m/w/d')).toEqual({ name: EMPLOYER });
    expect(readEmployerFromJobPage(page4270, title('2026-4270'))).toEqual({ name: EMPLOYER });
    expect(readEmployerFromJobPage(page4271, title('2026-4271'))).toEqual({ name: EMPLOYER });
    expect(apiList.slice(0, 2).map((row) => row.id)).toEqual(['2026-4270', '2026-4271']);
    // L'API, elle, ne nomme aucun employeur : sans les pages, aucune offre n'en porterait.
    expect(archive.filter((r) => r.url.includes('/vacancies/')).some((r) => /hiringOrganization|employer|company/i.test(r.body))).toBe(false);
  });

  it('les deux pages lues déclarent « Marc O’Polo » : toutes les offres le portent, la preuve le dit', async () => {
    const { attempts } = network();
    const result = normalizeAdapterResult(await fetchMarcOPoloJobs(config));
    expect(result.complete).toBe(true);
    expect(result.jobs.every((job) => job.company === EMPLOYER && job.employerEvidence?.rawName === EMPLOYER
      && job.employerEvidence.rule === 'SITE_JOBPOSTING_EMPLOYER_APPLIED_TO_LISTING')).toBe(true);
    expect(counters(result)).toEqual(expect.arrayContaining([`employeur=${EMPLOYER}`,
      `employeur.page=${vacancyPageUrl('en', apiList[0].title, '2026-4270')}`, `employeur.page=${vacancyPageUrl('en', apiList[1].title, '2026-4271')}`]));
    expect([...attempts.keys()].filter((url) => url.startsWith(`${START}/`))).toHaveLength(2);
    expect((result.jobs[5].raw as { employer: unknown }).employer).toEqual({ name: EMPLOYER, pages: [
      { url: vacancyPageUrl('en', apiList[0].title, '2026-4270'), sha256: sha256(page4270) },
      { url: vacancyPageUrl('en', apiList[1].title, '2026-4271'), sha256: sha256(page4271) }] });
  });

  const absent = async (plan: Plan, motif: string) => {
    const result = await read(plan);
    expect(result.jobs).toHaveLength(116);
    expect(result.jobs.some((job) => job.company !== undefined || job.employerEvidence !== undefined)).toBe(false);
    expect(counters(result)).toContain(`employeur=absent:${motif}`);
    // Un défaut d'employeur n'est pas un défaut de parcours : la preuve de fin de liste tient.
    expect(result.complete).toBe(true);
    expect((result.jobs[0].raw as { employer: { problem?: string } }).employer.problem).toBe(motif);
  };
  it('page d’offre en échec : aucun nom par défaut', () => absent({ jobPage: (id) => (id === '2026-4271' ? response('{"message":"Forbidden"}', 403) : undefined) }, 'EMPLOYER_PAGE_FETCH_FAILED'));
  it('page sans JSON-LD : aucun nom par défaut', () => absent({ jobPage: (id) => (id === '2026-4270' ? html('<html><body>Our Jobs</body></html>') : undefined) }, 'EMPLOYER_PAGE_WITHOUT_JOBPOSTING'));
  it('page d’une autre offre : aucun nom par défaut', () => absent({ jobPage: (id) => (id === '2026-4270' ? html(page4271) : undefined) }, 'EMPLOYER_PAGE_OTHER_POSTING'));
  it('page qui ne déclare pas d’employeur : aucun nom par défaut', () =>
    absent({ jobPage: (id) => (id === '2026-4271' ? html(page4271.replace(/"hiringOrganization":\{[^}]*\},?/, '')) : undefined) }, 'EMPLOYER_NOT_DECLARED'));
  it('deux pages qui déclarent deux noms différents : aucun nom par défaut', () =>
    absent({ jobPage: (id) => (id === '2026-4271' ? html(page4271.replace(/"name":"Marc O’Polo"/, '"name":"MOP Franchise GmbH"')) : undefined) }, 'EMPLOYER_PAGES_DISAGREE'));

  it('la reprise ne rend le nom que s’il vient de pages du site toutes lues', async () => {
    network();
    const job = (await fetchMarcOPoloJobs(config)).jobs[3];
    const raw = JSON.parse(JSON.stringify(job.raw));
    const context = { externalId: job.externalId, url: job.url, observedAt: new Date(), config };
    const recovered = recoverRetainedPublication('generic-listing', raw, context);
    expect(recovered).toMatchObject({ status: 'RECOVERABLE', job: { company: EMPLOYER } });
    const forged = { ...raw, employer: { ...raw.employer, pages: [{ url: 'https://evil.example/our-jobs/x-2026-4270', sha256: raw.employer.pages[0].sha256 }] } };
    expect(readMarcOPoloRaw(forged)?.company).toBeUndefined();
    expect(readMarcOPoloRaw({ ...raw, employer: { ...raw.employer, problem: 'EMPLOYER_PAGES_DISAGREE' } })?.company).toBeUndefined();
    expect(readMarcOPoloRaw({ ...raw, employer: undefined })?.company).toBeUndefined();
  });
});

describe("Marc O'Polo — fiches", () => {
  it('une fiche refusée (403) est relue une fois plus tard, et l’offre revient', async () => {
    const target = apiList[10].id;
    network({ detail: (id, attempt) => (id === target && attempt <= 3 ? response('{"message":"Forbidden"}', 403) : undefined) });
    const result = normalizeAdapterResult(await fetchMarcOPoloJobs(config));
    expect(result.complete).toBe(true);
    expect(result.jobs).toHaveLength(116);
  });

  it('une fiche toujours refusée : l’offre n’est pas publiée, reste vue, et la preuve tombe (échec de lecture)', async () => {
    const target = apiList[10].id;
    const result = await read({ detail: (id) => (id === target ? response('{"message":"Forbidden"}', 403) : undefined) });
    expect(result.jobs).toHaveLength(115);
    expect(result.complete).toBe(false);
    expect(result.rejectedRows).toEqual([expect.objectContaining({ reason: 'DETAIL_FETCH_FAILED',
      canonicalId: vacancyExternalId(vacancyPageUrl('en', apiList[10].title, target)) })]);
  });

  it('une fiche vide chez l’éditeur (offre fermée entre la liste et la fiche) : non publiée, vue, la preuve tient', async () => {
    const target = apiList[20].id;
    const result = await read({ detail: (id) => (id === target ? response('{}') : undefined) });
    expect(result.jobs).toHaveLength(115);
    expect(result.complete).toBe(true);
    expect(result.rejectedRows?.map((row) => row.reason)).toEqual(['DETAIL_EMPTY_AT_SOURCE']);
  });

  it('une fiche qui répond pour une autre offre est refusée, jamais publiée sous le mauvais identifiant', async () => {
    const [a, b] = [apiList[1].id, apiList[2].id];
    const result = await read({ detail: (id) => (id === a ? response(byUrl.get(detailUrl(b))!.body) : undefined) });
    expect(result.jobs.some((job) => job.url.endsWith(a))).toBe(false);
    expect(result.rejectedRows?.map((row) => row.reason)).toEqual(['DETAIL_MALFORMED_IDENTITY']);
  });

  it('toutes les fiches en échec : la collecte échoue, elle ne rend pas une source vide', async () => {
    await expect(read({ detail: () => response('{"message":"Forbidden"}', 403) })).rejects.toThrow('MARC_O_POLO_DETAILS_UNREACHABLE');
  });
});

describe("Marc O'Polo — configuration, rejeu et reprise", () => {
  it('le lecteur est choisi par la famille generic-listing ; une configuration hors du site est refusée', async () => {
    network();
    const result = await fetchAtsJobs('GENERIC_JSONLD', config);
    expect(result.jobs).toHaveLength(116);
    expect(() => marcOPoloSettings({ ...config, startUrl: 'https://evil.example/en/career/start-creating-with-us/our-jobs' })).toThrow('MARC_O_POLO_INVALID_CONFIG');
    expect(() => marcOPoloSettings({ ...config, apiUrl: 'http://169.254.169.254/latest' })).toThrow('MARC_O_POLO_INVALID_CONFIG');
    expect(() => marcOPoloSettings({ ...config, apiUrl: `${API}/vacancies?x=1` })).toThrow('MARC_O_POLO_INVALID_CONFIG');
  });

  it('capture puis rejeu hors réseau identiques ; chaque publication se reprend depuis son RAW retenu', async () => {
    const { mock } = network({ page: prodPage });
    const observedAt = new Date('2026-09-30T09:12:00.000Z');
    const records: CaptureRecord[] = [];
    const live = await withCaptureContext({ sequence: 0, observedAt, write: async (row) => { records.push(row); } }, () => fetchMarcOPoloJobs(config));
    const queues = new Map<string, CaptureRecord[]>();
    for (const row of records) queues.set(row.requestHash, [...(queues.get(row.requestHash) ?? []), row]);
    const calls = mock.mock.calls.length;
    mock.mockImplementation(async () => { throw new Error('Replay tried to use the network'); });
    const replay = await withCaptureContext({ sequence: 0, observedAt, replay: async (hash) => {
      const row = queues.get(hash)?.shift(); if (!row) throw new Error('Offline replay request is absent from the capture'); return row;
    } }, () => fetchMarcOPoloJobs(config));
    expect(replay).toEqual(live);
    expect([...queues.values()].every((queue) => queue.length === 0)).toBe(true);
    expect(mock.mock.calls.length).toBe(calls);
    for (const job of live.jobs) {
      const recovered = recoverRetainedPublication('generic-listing', JSON.parse(JSON.stringify(job.raw)),
        { externalId: job.externalId, url: job.url, observedAt, config });
      // D-508 §4 : une candidature spontanée retenue à la collecte ne se republie jamais depuis son RAW.
      if (job.publicationHold) { expect(recovered).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'PUBLICATION_HELD' }); continue; }
      expect(recovered.status).toBe('RECOVERABLE');
      if (recovered.status === 'RECOVERABLE') expect(recovered.job).toMatchObject({ description: job.description, company: EMPLOYER });
    }
    expect(live.jobs.filter((job) => job.publicationHold)).toHaveLength(5);
    // Le lieu et le code postal se lisent dans le RAW retenu, comme le JSON-LD le permettait au lecteur générique.
    const radolfzell = live.jobs.find((job) => job.url.endsWith('2026-4345'))!;
    expect(readLocations('GENERIC_JSONLD', radolfzell.raw)).toMatchObject({ status: 'DECLARED',
      value: [expect.objectContaining({ city: 'FO Radolfzell', postalCode: '78315', country: 'Germany' })] });
  });

  it('un RAW retenu dont l’adresse ne reproduit pas celle du titre de liste n’est pas repris', () => {
    const raw = { source: 'marc-o-polo-vacancies-v1', language: 'en', pageUrl: `${START}/autre-2026-4345`,
      listing: apiList.find((row) => row.id === '2026-4345'), detail: JSON.parse(byUrl.get(detailUrl('2026-4345'))!.body), employer: { problem: 'EMPLOYER_NO_PAGE_TO_READ', pages: [] } };
    expect(recoverRetainedPublication('generic-listing', raw, { externalId: vacancyExternalId(raw.pageUrl), url: raw.pageUrl,
      observedAt: new Date(), config })).toMatchObject({ status: 'RECOLLECT_OR_REVIEW' });
    // La reprise refuse aussi par son contrôle d'identité ; la lecture du RAW, elle, ne rend jamais une offre dont
    // l'adresse contredit celle qu'il retient (elle serait publiée sous une autre adresse par tout autre appelant).
    expect(readMarcOPoloRaw(raw)).toBeNull();
    expect(readMarcOPoloRaw({ ...raw, pageUrl: vacancyPageUrl('en', raw.listing!.title, '2026-4345') })).not.toBeNull();
  });
});

const ARCHIVE_SHA256 = 'dbd769e7c36cda3256bcb5a0ab1201c6afc0acb3d5e08e043e44e0fc5ba44f22';
const FILTERED_SHA256 = 'b4468ad3a89cd74f1ee597eec6e8418299292072ad1eec6ab16b9952f82e911c';
const SITEMAP_SHA256 = 'f1c0295ec077b7f36893dc06b3c2280aee61b9917b21940e0c2ff6792dcd365d';

/*
 * D-508 §4 (02/10/2026) — RÉOUVERTURE : LES OFFRES DES MAGASINS FRANCHISÉS SONT GARDÉES SOUS MARC O'POLO, LES
 * CANDIDATURES SPONTANÉES NE SONT PAS PUBLIÉES. Sur la lecture réelle complète du 30/09 (116 offres).
 */
describe("Marc O'Polo — D-508 §4 : franchisés gardés, candidatures spontanées retenues et retirées", () => {
  const SPONTANEOUS = ['2026-4040', '2026-4043', '2026-4088', '2026-4105', '2026-4126'];
  type ApiRow = { id: string; title: string; careerLevel?: string; department?: string };
  const rows = apiList as ApiRow[];
  const franchise = rows.filter((row) => row.department === 'Franchise').map((row) => row.id).sort();
  const urlOf = (id: string) => vacancyPageUrl('en', rows.find((row) => row.id === id)!.title, id);

  it('prémisse : la liste réelle porte 5 candidatures spontanées (3 « Initiativ », 2 « Initiativbewerbung ») et 9 offres de franchisés', () => {
    expect(rows.filter((row) => (row.careerLevel ?? '').trim() === 'Initiativ').map((row) => row.id).sort()).toEqual(['2026-4040', '2026-4043', '2026-4088']);
    expect(rows.filter((row) => /Initiativbewerbung/.test(row.title)).map((row) => row.id).sort()).toEqual(['2026-4105', '2026-4126']);
    expect(rows.filter((row) => isMarcOPoloSpontaneousApplication(row)).map((row) => row.id).sort()).toEqual(SPONTANEOUS);
    expect(franchise).toHaveLength(9);
    expect(rows.filter((row) => franchise.includes(row.id)).every((row) => /Franchise Store/.test(row.title))).toBe(true);
    // Aucune offre de franchisé ne porte les signes d'une candidature spontanée.
    expect(franchise.filter((id) => SPONTANEOUS.includes(id))).toEqual([]);
  });

  it('les 5 candidatures spontanées sont retenues avec un retrait daté ; les 9 offres de franchisés sont publiées sous Marc O’Polo', async () => {
    const observedAt = new Date('2026-10-02T09:00:00.000Z');
    network();
    const result = normalizeAdapterResult(await withCaptureContext({ sequence: 0, observedAt, write: async () => {} }, () => fetchMarcOPoloJobs(config)));
    const held = result.jobs.filter((job) => job.publicationHold);
    expect(held.map((job) => job.url).sort()).toEqual(SPONTANEOUS.map(urlOf).sort());
    expect(held.every((job) => job.publicationHold === MARC_O_POLO_SPONTANEOUS_HOLD && job.publicationWithdrawnAt?.getTime() === observedAt.getTime())).toBe(true);
    const franchised = result.jobs.filter((job) => franchise.some((id) => job.url === urlOf(id)));
    expect(franchised).toHaveLength(9);
    expect(franchised.every((job) => !job.publicationHold && !job.publicationWithdrawnAt && job.company === EMPLOYER)).toBe(true);
    // La preuve tient : les candidatures sont VUES et nommées (disposition « retenu »), rien ne manque ni ne casse.
    expect(result).toMatchObject({ complete: true, enumerationVerdict: 'PROVEN' });
    expect(result.enumeration?.issues ?? []).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
    expect(held.every((job) => result.enumeration!.pageEvidence![0].canonicalIds!.includes(job.externalId))).toBe(true);
    // L'employeur se lit toujours sur les pages de deux offres réelles.
    expect(counters(result).filter((c) => c.startsWith('employeur.page=')).map((c) => /(\d{4}-\d{4})$/.exec(c)![1])).toEqual(['2026-4270', '2026-4271']);
  });

  it('la retenue retire une publication antérieure, est décidée (D-508 §4) et ne fait pas échouer le RUN', () => {
    expect(publicationDisposition(MARC_O_POLO_SPONTANEOUS_HOLD)).toEqual({ kind: 'WITHDRAWN', reason: 'OUT_OF_SCOPE' });
    expect(isNativeEvidenceRetention(MARC_O_POLO_SPONTANEOUS_HOLD)).toBe(true);
    expect(retentionStatus(MARC_O_POLO_SPONTANEOUS_HOLD)).toBe('décidé');
  });

  it('contre-témoins : un intitulé voisin n’est pas une candidature spontanée', () => {
    expect(isMarcOPoloSpontaneousApplication({ title: 'Initiative & Events Manager m/w/d', careerLevel: 'Professional' })).toBe(false);
    expect(isMarcOPoloSpontaneousApplication({ title: 'Store Manager Franchise Store Konstanz m/w/d', careerLevel: '(Deputy) Store Manager' })).toBe(false);
    expect(isMarcOPoloSpontaneousApplication({ title: 'Verkäufer m/w/d', careerLevel: 'Initiativ ' })).toBe(true);
    expect(isMarcOPoloSpontaneousApplication({ title: 'Verkäufer m/w/d' }, { careerLevel: 'Initiativ' })).toBe(true);
  });
});
