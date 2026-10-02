import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn(), DEFAULT_DETAIL_CONCURRENCY: 4 }));
import { fetchJson, fetchText } from '../../lib/http.js';
import { fetchTalentRecruiterJobs, parseTalentRecruiterPosition, talentRecruiterDate, TALENT_RECRUITER_ADVERTISEMENT_WITHDRAWN } from './talentRecruiter.js';
import { fetchAtsJobs } from '../index.js';
import { explicitlyListed, publicationDisposition, retentionClass, retentionStatusLabel } from '../../pipeline/publicationDisposition.js';
import { recoverRetainedPublication } from '../../publication/recovery.js';
const api = vi.mocked(fetchJson), text = vi.mocked(fetchText);
const position = (Id: number, overrides: Record<string, unknown> = {}) => ({
  Id, Name: 'Client Advisor', CustomerAlias: 'ganni', CustomerName: 'GANNI A/S', ProjectType: 'RecruitmentProject',
  Published: '/Date(1788294884000+0200)/', Created: '/Date(1788294816000+0200)/',
  AdvertisementUrlSecure: `https://candidate.hr-manager.net/ApplicationInit.aspx?cid=1970&ProjectId=${Id}&MediaId=5`,
  Advertisements: [{ Id: 1, Content: '<p>Join the store team.</p>' }],
  WorkPlaceCoordinates: '48.873224, 2.3323863', PositionLocation: { Name: 'Paris' },
  DepartmentTree: { Country: 'Danmark' }, ProjectParticipants: ['Not needed for public job evidence'], ...overrides,
});
const feed = (Items: ReturnType<typeof position>[], total = Items.length, skip = 0) => ({
  Items, CustomerAlias: 'ganni', CustomerName: 'GANNI A/S', TransactionStatus: { StatusCode: 0 },
  PositionCountCustomer: total, PositionCountSearch: total, PositionCountList: Items.length, PositionCountSkipped: skip,
});
beforeEach(() => { vi.resetAllMocks(); text.mockResolvedValue('<iframe src="https://www.google.com/maps/embed/v1/place?q=40%20Bd%20Haussmann,75008%20Paris,Frankrig"></iframe>'); });

describe('Talent Recruiter public job portal API', () => {
  it('refuses a configured portal pointing to a different customer before any request', async () => {
    await expect(fetchTalentRecruiterJobs({ customer: 'ganni', portalUrl: 'https://candidate.hr-manager.net/vacancies/list.aspx?customer=kimdemo' })).rejects.toThrow('PORTAL_CUSTOMER_CONFLICT');
    expect(api).not.toHaveBeenCalled(); expect(text).not.toHaveBeenCalled();
  });
  it('reads native publication, public content, explicit map address and preserves source coordinates', async () => {
    api.mockResolvedValue(feed([position(144697)])); const r = await fetchTalentRecruiterJobs({ customer: 'ganni' });
    expect(r.complete).toBe(true); expect(r.jobs[0]).toMatchObject({ company: 'GANNI A/S', country: 'Frankrig', latitude: 48.873224, longitude: 2.3323863, opportunityType: 'JOB_OPENING', postedAt: new Date(1788294884000) });
    expect((r.jobs[0].raw as any).position).not.toHaveProperty('ProjectParticipants');
    expect((r.jobs[0].raw as any).position).not.toHaveProperty('DepartmentTree');
  });
  it('uses documented take/skip and all four counters, without geographic or project-type filtering', async () => {
    api.mockResolvedValueOnce(feed([position(1), position(2)], 3)).mockResolvedValueOnce(feed([position(3)], 3, 2));
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' }); expect(r.complete).toBe(true); expect(r.jobs).toHaveLength(3);
    const urls = api.mock.calls.map(([url]) => new URL(url));
    expect(urls.map(u => u.searchParams.get('skip'))).toEqual(['0','2']);
    expect(urls.every(u => u.searchParams.get('take') === '100' && u.searchParams.get('incads') === 'true' && !u.searchParams.has('protype'))).toBe(true);
    expect(r.enumeration?.pageEvidence?.[1].componentCounters).toContain('skipped=2');
  });
  it('retains native open applications, including their absence of specific vacancy content', async () => {
    api.mockResolvedValue(feed([position(143570, { ProjectType: 'OpenApplication', Advertisements: [], Published: undefined, WorkPlaceCoordinates: '', PositionLocation: null })])); text.mockResolvedValue('');
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' }); expect(r.complete).toBe(true); expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0].opportunityType).toBe('OPEN_APPLICATION'); expect(r.jobs[0].postedAt).toBeUndefined(); expect(r.jobs[0].description).toBeUndefined();
  });
  it('does not use the corporate country or a maps place identifier as the physical country/address', async () => {
    api.mockResolvedValue(feed([position(144687, { PositionLocation: { Name: 'Boston' }, WorkPlaceCoordinates: '42.3502433,-71.0792053' })]));
    text.mockResolvedValue('<iframe src="https://www.google.com/maps/embed/v1/place?q=place_id:abc"></iframe>');
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' }); expect(r.jobs[0].country).toBeUndefined(); expect(r.jobs[0].location).toBe('Boston');
    expect((r.jobs[0].raw as any).fieldEvidence.country).toMatchObject({ status: 'NOT_EXPLICIT_IN_PUBLIC_ADDRESS', hasSourceCoordinates: true });
  });
  it('preserves a listing and API description when a detail request fails, and exposes the failed proof', async () => {
    api.mockResolvedValue(feed([position(1)])); text.mockRejectedValue(Error('HTTP 403'));
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' }); expect(r.jobs).toHaveLength(1); expect(r.complete).toBe(false); expect(r.enumeration?.issues).toContain('DETAIL_READ_FAILED:1');
  });
  it('refuses API errors, a different customer and malformed counters instead of reporting a healthy empty feed', async () => {
    for (const response of [{ ...feed([]), TransactionStatus: { StatusCode: 5 } }, { ...feed([]), CustomerAlias: 'kimdemo' }, { ...feed([]), PositionCountCustomer: '0' }]) {
      api.mockResolvedValue(response); await expect(fetchTalentRecruiterJobs({ customer: 'ganni' })).rejects.toThrow('INVALID_FEED');
    }
  });
  it('detects duplicate IDs, scope mismatch, moving totals and a page budget', async () => {
    api.mockResolvedValueOnce(feed([position(1)], 2)).mockResolvedValueOnce(feed([position(1)], 2, 1));
    expect((await fetchTalentRecruiterJobs({ customer: 'ganni' })).enumeration?.issues).toContain('REPEATED_POSTING_ID:1');
    api.mockResolvedValue({ ...feed([position(1)]), PositionCountCustomer: 2 });
    expect((await fetchTalentRecruiterJobs({ customer: 'ganni' })).enumeration?.issues).toContain('UNFILTERED_CUSTOMER_SCOPE_MISMATCH');
    api.mockResolvedValueOnce(feed([position(1)], 2)).mockResolvedValueOnce(feed([position(2)], 3, 1));
    expect((await fetchTalentRecruiterJobs({ customer: 'ganni' })).enumeration?.issues).toContain('DECLARED_TOTAL_CHANGED');
    api.mockResolvedValue(feed([position(1)], 2)); expect((await fetchTalentRecruiterJobs({ customer: 'ganni', maxPages: 1 })).complete).toBe(false);
  });
  it('records invalid source rows and unknown opportunity types without inventing an accepted job', async () => {
    api.mockResolvedValue(feed([position(1), position(2, { AdvertisementUrlSecure: 'https://unrelated.example/2' })]));
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' }); expect(r.jobs).toHaveLength(1); expect(r.rejectedRows).toHaveLength(1); expect(r.complete).toBe(false);
    api.mockResolvedValue(feed([position(3, { ProjectType: 'NewProjectType' })])); expect((await fetchTalentRecruiterJobs({ customer: 'ganni' })).jobs[0].publicationHold).toBe('UNRECOGNISED_OPPORTUNITY_TYPE');
  });
});
it('interprets .NET UTC milliseconds exactly once and never treats Created as Published', () => {
  expect(talentRecruiterDate('/Date(1788294884000+0200)/')).toEqual(new Date(1788294884000));
  expect(talentRecruiterDate('/Date(1788294884000-0500)/')).toEqual(new Date(1788294884000));
  for (const value of [undefined, '', 'invalid', '/Date(not-a-date)/']) expect(talentRecruiterDate(value)).toBeUndefined();
});

/**
 * LE CONTRAT CANONIQUE — GANNI, 16 offres, deux sans description.
 *
 * `ids` EST déjà `String(p.Id)`, c'est-à-dire l'`externalId` écrit : la correction consiste à le DÉCLARER,
 * pas à le recalculer. Sans la propriété `canonicalIds`, la source ne peut prouver aucune absence.
 */
describe('Talent Recruiter — identifiants canoniques', () => {
  it('déclare canonicalIds, identiques aux externalId, et y garde les offres sans description', async () => {
    // Une annonce PUBLIÉE dont le texte est vide : défaut de contenu (un tableau d'annonces vide, lui, est un retrait, D-514 §4).
    api.mockResolvedValue(feed([position(1), { ...position(2), Advertisements: [{ Id: 2, Content: '' }] }]));
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' });

    const canonical = r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? []);
    const written = r.jobs.map((j) => j.externalId);
    expect(canonical.sort()).toEqual(written.sort());
    // L'offre sans description est VUE et publiée : un défaut de contenu n'est ni un rejet ni une absence.
    expect(canonical).toContain('2');
    expect(r.jobs.find((j) => j.externalId === '2')?.description).toBeUndefined();
    expect(r.enumeration?.issues).toContain('DESCRIPTION_MISSING:2');
    // Et le contrat est satisfait : aucun identifiant observé sans disposition, aucune offre hors preuve.
    expect(r.enumeration?.canonicalIdViolations).toBeUndefined();
    expect(r.complete).toBe(true);
    expect(r.enumeration?.termination).toBe('DECLARED_TOTAL_REACHED');
  });
});

/**
 * UNE LIGNE OBSERVÉE PUIS REJETÉE N'EST PAS UNE LIGNE ABSENTE.
 *
 * L'identifiant entre dans la preuve AVANT les validations : sinon une JobSource historique portant ce même
 * identifiant paraîtrait absente au refresh, donc serait fermée — alors que la source la publie toujours.
 */
describe('Talent Recruiter — rejets identifiables observés avant validation', () => {
  it('A. Id présent, titre absent : observé, non produit, rejeté, contrat satisfait', async () => {
    api.mockResolvedValue(feed([position(1), { ...position(123), Name: '' }]));
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' });

    const canonical = r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? []);
    expect(canonical).toContain('123');                                  // observé
    expect(r.jobs.map((j) => j.externalId)).not.toContain('123');        // non produit
    expect(r.rejectedRows?.find((x) => (x as { canonicalId?: string }).canonicalId === '123')?.reason)
      .toBe('INVALID_POSTING_ID_TITLE_EMPLOYER_OR_URL');                 // rejeté avec motif
    expect(r.enumeration?.canonicalIdViolations).toBeUndefined();        // contrat satisfait
  });

  it('B. Id présent, URL incohérente : même résultat, motif d\'URL', async () => {
    api.mockResolvedValue(feed([position(1),
      { ...position(123), AdvertisementUrlSecure: 'https://candidate.hr-manager.net/x?ProjectId=999' }]));
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' });

    const canonical = r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? []);
    expect(canonical).toContain('123');
    expect(r.jobs.map((j) => j.externalId)).not.toContain('123');
    expect(r.rejectedRows?.find((x) => (x as { canonicalId?: string }).canonicalId === '123')?.reason)
      .toBe('POSTING_URL_IDENTITY_MISMATCH');
    expect(r.enumeration?.canonicalIdViolations).toBeUndefined();
  });

  /**
   * RUN du 01/10/2026 (GANNI) : 10 offres sans annonce, leurs 10 `DESCRIPTION_MISSING` poussés dans l'ordre d'arrivée
   * des fiches ; le rejeu les servait dans un autre ordre et la capture tombait en `REPLAY_RESULT_CHANGED`.
   */
  it('range les motifs des fiches dans l\'ordre des offres, quel que soit l\'ordre d\'arrivée des fiches', async () => {
    const ids = [144691, 144692, 144695];
    const read = async (delays: number[]) => {
      const finished: string[] = [];
      api.mockResolvedValue(feed(ids.map(id => position(id, { Advertisements: [{ Id: id, Content: '' }] }))));
      text.mockImplementation(async url => {
        const id = new URL(url).searchParams.get('ProjectId')!;
        await new Promise(resolve => setTimeout(resolve, delays[ids.indexOf(Number(id))]));
        finished.push(id);
        return '';
      });
      return { finished, issues: (await fetchTalentRecruiterJobs({ customer: 'ganni' })).enumeration?.issues };
    };
    const capture = await read([30, 15, 1]), replay = await read([1, 15, 30]);
    // Prémisse : les deux lectures finissent bien dans des ordres opposés, sinon le témoin ne teste rien.
    expect(capture.finished).toEqual(['144695', '144692', '144691']);
    expect(replay.finished).toEqual(['144691', '144692', '144695']);
    expect(capture.issues).toEqual(['DESCRIPTION_MISSING:144691', 'DESCRIPTION_MISSING:144692', 'DESCRIPTION_MISSING:144695']);
    expect(replay.issues).toEqual(capture.issues);
  });

  /** Une ligne sans identifiant exploitable ne peut être ni observée ni disposée : la preuve tombe. */
  it('une ligne SANS Id exploitable rend l\'énumération non probante', async () => {
    api.mockResolvedValue(feed([position(1), { ...position(2), Id: 0 }]));
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' });

    expect(r.enumeration?.issues).toContain('ROW_WITHOUT_CANONICAL_ID');
    expect(r.complete).toBe(false);
  });

  /** D-511 : la candidature spontanée que l'éditeur déclare (`ProjectType` « OpenApplication ») est retenue et retirée à la collecte. */
  it('la collecte retient la candidature spontanée native et publie le poste voisin (GANNI, D-511)', async () => {
    api.mockResolvedValue(feed([position(143570, { Name: 'Unsolicited applications', ProjectType: 'OpenApplication', Advertisements: [] }), position(144697)]));
    const r = await fetchAtsJobs('TALENT_RECRUITER', { customer: 'ganni' });
    expect(r.jobs.map(j => [j.externalId, j.publicationHold ?? null, !!j.publicationWithdrawnAt]))
      .toEqual([['143570', 'NATIVE_SPONTANEOUS_APPLICATION', true], ['144697', null, false]]);
    expect(r.complete).toBe(true);
  });

  /** D-512 : un vivier sans poste est retenu à la collecte comme une candidature spontanée ; un vivier qui nomme un poste est publié. */
  it('la collecte retient le vivier sans poste et publie le vivier qui nomme un poste (D-512)', async () => {
    api.mockResolvedValue(feed([position(201, { Name: 'GANNI Future Opportunities - (Paris)' }), position(202, { Name: 'Future Opportunities - Store Manager' })]));
    const r = await fetchAtsJobs('TALENT_RECRUITER', { customer: 'ganni' });
    expect(r.jobs.map(j => [j.externalId, j.publicationHold ?? null, !!j.publicationWithdrawnAt]))
      .toEqual([['201', 'NATIVE_SPONTANEOUS_APPLICATION', true], ['202', null, false]]);
  });
});

/**
 * D-514 §4 (arbitrage CEO du 02/10/2026) : le poste que TalentRecruiter liste sans annonce publiée est une offre retirée,
 * non publiée, qui ne bloque plus la source. Forme réelle : GANNI, RUN du 01/10, 10 postes `RecruitmentProject` sur 20 avec
 * `Advertisements: []`, dont les 10 `CONTENT_MISSING` dépassaient la tolérance de la validation native (2) et rejetaient
 * la source (`audits/2026-10-02/d514-talentrecruiter/`).
 */
describe('Talent Recruiter — poste listé sans annonce (D-514 §4)', () => {
  const withdrawnIds = [144692, 144691, 144695];
  it('le retient et le retire à la date de l\'observation, sans motif d\'anomalie, et publie le poste voisin', async () => {
    api.mockResolvedValue(feed([...withdrawnIds.map(id => position(id, { Advertisements: [] })), position(144697)]));
    const r = await fetchAtsJobs('TALENT_RECRUITER', { customer: 'ganni' });
    // Prémisse : les trois postes sont des postes de recrutement listés avec un tableau d'annonces explicitement vide.
    expect(r.jobs.filter(j => (j.raw as any).position.ProjectType === 'RecruitmentProject' && Array.isArray((j.raw as any).position.Advertisements)
      && (j.raw as any).position.Advertisements.length === 0).map(j => j.externalId)).toEqual(withdrawnIds.map(String));
    expect(r.jobs.map(j => [j.externalId, j.publicationHold ?? null, !!j.publicationWithdrawnAt]))
      .toEqual([...withdrawnIds.map(id => [String(id), TALENT_RECRUITER_ADVERTISEMENT_WITHDRAWN, true]), ['144697', null, false]]);
    // Vu, donc dans la preuve d'énumération ; aucun motif, l'énumération reste probante.
    expect(r.enumeration?.pageEvidence?.flatMap(pe => pe.canonicalIds ?? [])).toEqual([...withdrawnIds.map(String), '144697']);
    expect(r.enumeration?.issues).toEqual([]);
    expect(r.complete).toBe(true);
    // Le motif est une preuve native décidée, qui retire sans fermer au nom de l'employeur.
    expect(retentionClass(TALENT_RECRUITER_ADVERTISEMENT_WITHDRAWN)).toBe('NATIVE');
    expect(retentionStatusLabel(TALENT_RECRUITER_ADVERTISEMENT_WITHDRAWN)).toBe('décidé (D-514 §4)');
    expect(publicationDisposition(TALENT_RECRUITER_ADVERTISEMENT_WITHDRAWN)).toEqual({ kind: 'WITHDRAWN', reason: 'SOURCE_UNLISTED' });
  });

  it('une vraie anomalie reste une anomalie : annonce publiée au texte vide, tableau d\'annonces absent', async () => {
    api.mockResolvedValue(feed([...withdrawnIds.map(id => position(id, { Advertisements: [] })),
      position(4, { Advertisements: [{ Id: 4, Content: '<p> </p>' }] }), position(5, { Advertisements: undefined })]));
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' });
    // Prémisse : le poste 4 a bien une annonce (illisible), le poste 5 n'a pas de champ d'annonces du tout.
    expect((r.jobs.find(j => j.externalId === '4')!.raw as any).position.Advertisements).toHaveLength(1);
    expect((r.jobs.find(j => j.externalId === '5')!.raw as any).position).not.toHaveProperty('Advertisements');
    expect(r.enumeration?.issues).toEqual(['DESCRIPTION_MISSING:4', 'DESCRIPTION_MISSING:5']);
    expect(r.jobs.filter(j => j.publicationHold).map(j => j.externalId)).toEqual(withdrawnIds.map(String));
  });

  it('une erreur technique reste une anomalie : la fiche illisible d\'un poste publié bloque, celle d\'un poste retiré non', async () => {
    api.mockResolvedValue(feed([position(144692, { Advertisements: [] }), position(144697)])); text.mockRejectedValue(Error('HTTP 503'));
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' });
    // Prémisse : les DEUX fiches ont échoué.
    expect(r.jobs.map(j => !!(j.raw as any).detailError)).toEqual([true, true]);
    expect(r.enumeration?.issues).toEqual(['DETAIL_READ_FAILED:144697']);
    expect(r.enumeration?.blockers).toEqual(['DETAIL_READ_FAILED:144697']);
    expect(r.complete).toBe(false);
  });

  it('la reprise d\'un RAW lit la même règle : retenu, jamais refusé faute de contenu', () => {
    const raw = { position: position(144692, { Advertisements: [] }) };
    const job = parseTalentRecruiterPosition(raw.position as never, 'ganni');
    expect([job.publicationHold, job.publicationWithdrawnAt]).toEqual([TALENT_RECRUITER_ADVERTISEMENT_WITHDRAWN, undefined]);
    expect(recoverRetainedPublication('talentrecruiter', raw, { externalId: '144692', url: raw.position.AdvertisementUrlSecure,
      observedAt: new Date(), config: { customer: 'ganni' } })).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'PUBLICATION_HELD' });
  });

  it('seule une annonce de nouveau publiée relève le retrait (republication)', () => {
    const listed = (overrides: Record<string, unknown>) => explicitlyListed('TALENT_RECRUITER', { position: position(144692, overrides) });
    expect(listed({})).toBe(true);
    expect(listed({ Advertisements: [] })).toBe(false);
    expect(listed({ Advertisements: undefined })).toBe(false);
    expect(listed({ ProjectType: 'OpenApplication' })).toBe(false);
    expect(explicitlyListed('TALENT_RECRUITER', { position: null })).toBe(false);
  });
});
