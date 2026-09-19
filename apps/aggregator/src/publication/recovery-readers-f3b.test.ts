import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { recoverRetainedPublication, retainedPublicationIdentity } from './recovery.js';

/**
 * Lot F3b : cinq familles dont la publication se relit depuis le RAW retenu, hors réseau. Chaque cas part d'un RAW
 * tel que son collecteur l'écrit aujourd'hui (annonce SmartRecruiters `jobAd`, ligne RMK v2, diffusion principale
 * DigitalRecruiters, nœud JSON-LD avec sa page d'origine, position Personio avec l'évidence du détail).
 */
const read = (kind: string, raw: unknown, url: string, externalId: string, config: Record<string, unknown>) =>
  recoverRetainedPublication(kind, raw, { externalId, url, observedAt: new Date('2026-09-16T12:00:00Z'), config });
const identity = (kind: string, raw: unknown, url: string, externalId: string, config: Record<string, unknown>) =>
  retainedPublicationIdentity(kind, raw, { externalId, url, observedAt: new Date('2026-09-16T12:00:00Z'), config });
const postingEvidence = (url: string, description = '<p>Detail description</p>') => ({
  pageUrl: url, htmlSha256: 'a'.repeat(64), jobPostingCount: 1, geographyConflict: false, hiringOrganization: null, employerFromJobPosting: false,
  jobPosting: { '@type': 'JobPosting', title: 'Own title', description, datePosted: '2026-09-01', url },
});
vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network'); }));

describe('retained publications of the families qualified in lot F3b', () => {
  it('rebuilds a SmartRecruiters posting from its listing entry and retained advert, and keeps a listing-only RAW identified but unpublishable', () => {
    const config = { company: 'MaisonParis' }; const url = 'https://jobs.smartrecruiters.com/MaisonParis/743999';
    const raw = { id: '743999', name: 'Own title', releasedDate: '2026-09-01T00:00:00.000Z', location: { city: 'Paris', country: 'fr' }, typeOfEmployment: { id: 'permanent', label: 'Full-time' },
      jobAd: { sections: { companyDescription: { text: '<p>About us</p>' }, jobDescription: { text: '<p>Own description</p>' } } } };
    const result = read('smartrecruiters-whitelabel', raw, url, '743999', config);
    expect(result).toMatchObject({ status: 'RECOVERABLE', job: { title: 'Own title', url, externalId: '743999', contract: 'Permanent', raw } });
    if (result.status === 'RECOVERABLE') expect(result.job.description).toBe('About us\n\nOwn description');
    const { jobAd: _advert, ...listingOnly } = raw;
    expect(read('smartrecruiters-whitelabel', listingOnly, url, '743999', config)).toMatchObject({ status: 'RECOLLECT_OR_REVIEW', reason: 'CONTENT_MISSING' });
    expect(identity('smartrecruiters-whitelabel', listingOnly, url, '743999', config)).toMatchObject({ status: 'VERIFIED' });
    expect(read('smartrecruiters-whitelabel', raw, url, 'other', config)).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
    expect(read('smartrecruiters-whitelabel', { ...raw, jobAd: 'forged' }, url, '743999', config)).toMatchObject({ reason: 'DETAIL_EVIDENCE_UNUSABLE' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rebuilds a SuccessFactors RMK v2 row on its configured origin, with the retained detail-page posting, and refuses the old slug shape', () => {
    const config = { origin: 'https://careers.maison.example' }; const url = 'https://careers.maison.example/job/own-title/123-fr_FR';
    const item = { id: 123, unifiedStandardTitle: 'Own title', urlTitle: 'own-title', jobLocationShort: ['Paris, FR'], locale: 'fr_FR', source: 'successfactors-rmk-v2',
      rmkDateEvidence: { field: 'unifiedStandardStart', rawValue: null, locale: 'fr_FR', parserVersion: 'rmk-locale-calendar-v1', parsedValue: null } };
    expect(read('successfactors', item, url, '123', config)).toMatchObject({ status: 'RECOLLECT_OR_REVIEW', reason: 'CONTENT_MISSING' });
    expect(identity('successfactors', item, url, '123', config)).toMatchObject({ status: 'VERIFIED' });
    const enriched = { ...item, postingEvidence: postingEvidence(url) };
    const result = read('successfactors', enriched, url, '123', config);
    expect(result).toMatchObject({ status: 'RECOVERABLE', job: { title: 'Own title', url, externalId: '123', raw: enriched } });
    if (result.status === 'RECOVERABLE') { expect(result.job.description).toBe('Detail description'); expect(result.job.postedAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z'); }
    expect(read('successfactors', { slug: 'own-title', source: 'successfactors' }, url, '123', config)).toMatchObject({ reason: 'NATIVE_ID_MISSING' });
    expect(read('successfactors', { ...item, source: 'successfactors-v9' }, url, '123', config)).toMatchObject({ reason: 'READER_UNQUALIFIED' });
    expect(read('successfactors', enriched, 'https://careers.maison.example/job/own-title/124-fr_FR', '123', config)).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
  });

  /*
   * LE DIALECTE RMK DOIT APPLIQUER `successfactorsDetail`, PAS SEULEMENT `postingEvidence`.
   *
   * Les deux dialectes retiennent cette fiche, et le collecteur la fusionne de la même façon
   * (« the same merge serves the live collector and the retained-publication reader »). Mais
   * seule la branche HTML l'appliquait au rejeu : le dialecte RMK reconstruisait l'offre depuis
   * la seule entrée de liste, qui ne porte aucune description.
   *
   * Mesuré le 19/09/2026 : `douglas-sf` 311 offres, `breitling-sf` 46, `goyard-successfactors`
   * 20 — RAW portant `successfactorsDetail`, offres collectées avec leur description, et rejeu
   * refusé CONTENT_MISSING sur la totalité. Après correctif : 311/311, 46/46, 20/20.
   */
  it('applique la fiche de détail retenue au dialecte RMK, pas seulement au dialecte HTML', () => {
    const config = { origin: 'https://careers.maison.example' };
    const url = 'https://careers.maison.example/job/own-title/123-fr_FR';
    const item = { id: 123, unifiedStandardTitle: 'Own title', urlTitle: 'own-title', jobLocationShort: ['Paris, FR'],
      locale: 'fr_FR', source: 'successfactors-rmk-v2',
      rmkDateEvidence: { field: 'unifiedStandardStart', rawValue: null, locale: 'fr_FR', parserVersion: 'rmk-locale-calendar-v1', parsedValue: null } };

    // PRÉMISSE : sans la fiche, le rejeu refuse bien pour contenu manquant — c'est le défaut
    // que ce témoin exerce. Si cette ligne passait au vert, il ne testerait rien.
    expect(read('successfactors', item, url, '123', config)).toMatchObject({ reason: 'CONTENT_MISSING' });

    const avecFiche = { ...item, successfactorsDetail: {
      description: 'Vous pilotez la stratégie de marque.', postedAt: '2026-09-01T00:00:00.000Z', validThrough: null } };
    const resultat = read('successfactors', avecFiche, url, '123', config);
    expect(resultat.status).toBe('RECOVERABLE');
    if (resultat.status === 'RECOVERABLE') {
      expect(resultat.job.description).toBe('Vous pilotez la stratégie de marque.');
      expect(resultat.job.postedAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    }

    // Une fiche illisible reste refusée : on ne devine jamais un contenu absent.
    expect(read('successfactors', { ...item, successfactorsDetail: 'forgé' }, url, '123', config))
      .toMatchObject({ reason: 'DETAIL_EVIDENCE_UNUSABLE' });
  });

  it('rebuilds a SuccessFactors HTML-path posting from its retained listing link and microdata detail, and refuses the older slug-only RAW', () => {
    const config = { origin: 'https://careers.maison.example' }; const url = 'https://careers.maison.example/job/Paris/Own-title/123456/';
    const listing = { slug: 'Paris-Own-title', id: '123456', path: '/job/Paris/Own-title/123456/', source: 'successfactors' };
    expect(identity('successfactors', listing, url, '123456', config)).toMatchObject({ status: 'VERIFIED' });
    expect(read('successfactors', listing, url, '123456', config)).toMatchObject({ reason: 'CONTENT_MISSING' });
    const detail = { title: 'Own title', location: 'Paris, FR', city: 'Paris', country: 'FR', postalCode: '75001', postedAt: '2026-09-01T00:00:00.000Z', validThrough: null, description: 'Detail description', company: 'Maison', employerEvidence: { rawName: 'Maison', path: 'microdata.hiringOrganization', rule: 'HIRING_ORGANIZATION_LABEL' } };
    const result = read('successfactors', { ...listing, successfactorsDetail: detail }, url, '123456', config);
    expect(result).toMatchObject({ status: 'RECOVERABLE', job: { title: 'Own title', url, externalId: '123456', city: 'Paris', country: 'FR', postalCode: '75001', company: 'Maison' } });
    if (result.status === 'RECOVERABLE') { expect(result.job.description).toBe('Detail description'); expect(result.job.postedAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z'); }
    expect(read('successfactors', { slug: 'Paris-Own-title', source: 'successfactors' }, url, '123456', config)).toMatchObject({ reason: 'NATIVE_ID_MISSING' });
    expect(read('successfactors', { ...listing, successfactorsDetail: 'forged' }, url, '123456', config)).toMatchObject({ reason: 'DETAIL_EVIDENCE_UNUSABLE' });
  });

  it('rebuilds a DigitalRecruiters announcement from its retained primary diffusion and detail-page posting', () => {
    const config = { domainName: 'careers.maison.example' }; const url = 'https://careers.maison.example/fr/annonce/123/456-vendeur';
    const primary = { id: 456, job_ad_id: 123, title: 'Own title', url: '123/456-vendeur', location: 'Paris', contract: 'CDI', careers_site_url: url };
    const raw = { ...primary, diffusions: [{ id: 456, location: 'Paris', url: '123/456-vendeur' }], locations: ['Paris'], postingEvidence: postingEvidence(url) };
    const result = read('digitalrecruiters', raw, url, '123', config);
    expect(result).toMatchObject({ status: 'RECOVERABLE', job: { title: 'Own title', url, externalId: '123', location: 'Paris', contract: 'CDI', raw } });
    if (result.status === 'RECOVERABLE') expect(result.job.description).toBe('Detail description');
    // Without careers_site_url the tenant's own path names the announcement; a foreign URL is an identity mismatch.
    const { careers_site_url: _site, ...withoutSiteUrl } = raw;
    expect(read('digitalrecruiters', { ...withoutSiteUrl, postingEvidence: postingEvidence(url) }, url, '123', config)).toMatchObject({ status: 'RECOVERABLE' });
    expect(read('digitalrecruiters', raw, 'https://careers.maison.example/fr/annonce/999/1-autre', '123', config)).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
    const { postingEvidence: _evidence, ...listingOnly } = raw;
    expect(read('digitalrecruiters', listingOnly, url, '123', config)).toMatchObject({ reason: 'CONTENT_MISSING' });
  });

  it('identifies a generic JSON-LD posting by the page it was read from, retained beside the node', () => {
    const pageUrl = 'https://www.maison.example/careers/vendeur'; const sha1 = createHash('sha1').update(pageUrl).digest('hex');
    const node = { '@type': 'JobPosting', title: 'Own title', description: '<p>Own description</p>', datePosted: '2026-09-01' };
    expect(read('generic-jsonld', { ...node, catwalksPageUrl: pageUrl }, pageUrl, sha1, {})).toMatchObject({ status: 'RECOVERABLE', job: { url: pageUrl, externalId: sha1 } });
    // Prémisse : la page lue et l'URL déclarée par l'offre diffèrent ; sans la page retenue l'identité serait irrémédiablement perdue.
    const declared = 'https://www.maison.example/jobs/1';
    expect(read('generic-listing', { ...node, url: declared, catwalksPageUrl: pageUrl }, declared, sha1, {})).toMatchObject({ status: 'RECOVERABLE', job: { url: declared, externalId: sha1 } });
    expect(read('generic-listing', { ...node, url: declared }, declared, sha1, {})).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
    // A posting that declares no URL and was retained before lot F3b was published at the page it was read from.
    expect(read('generic-jsonld', node, pageUrl, sha1, {})).toMatchObject({ status: 'RECOVERABLE', job: { url: pageUrl, externalId: sha1 } });
    expect(read('generic-jsonld', { title: 'Not a posting' }, pageUrl, sha1, {})).toMatchObject({ reason: 'READER_UNQUALIFIED' });
  });

  it('applies the retained Personio detail evidence (description, date, employer, geography) exactly as the collector did', () => {
    const config = { host: 'brand.jobs.personio.com' }; const url = 'https://brand.jobs.personio.com/job/42';
    const position = { id: 42, name: 'Own title', office: 'Paris', jobDescriptions: { jobDescription: [{ name: 'Duties', value: '<p>XML description</p>' }] } };
    const evidence = { method: 'PERSONIO_NEXT_FLIGHT', htmlSha256: 'b'.repeat(64), matchingModels: 1,
      position: { id: '42', name: 'Own title', published_at: '2026-09-02T08:00:00.000Z', fields: [{ label: '$a1', value: '$b2' }], office_addresses: [{ country: 'France', city: 'Paris' }] },
      careerSiteSettings: { company_name: 'Maison Retail SAS' }, resolvedText: { $a1: 'Duties', $b2: '<p>Detail description</p>' } };
    const result = read('personio', { ...position, personioDetail: evidence }, url, '42', config);
    expect(result).toMatchObject({ status: 'RECOVERABLE', job: { title: 'Own title', url, externalId: '42', company: 'Maison Retail SAS', country: 'France', city: 'Paris',
      employerEvidence: { rule: 'EXPLICIT_PERSONIO_PORTAL_EMPLOYER' } } });
    if (result.status === 'RECOVERABLE') { expect(result.job.description).toBe('Duties\nDetail description'); expect(result.job.postedAt?.toISOString()).toBe('2026-09-02T08:00:00.000Z'); }
    // An unresolved flight text never replaces the XML description; a legal entity in the XML keeps precedence over the portal employer.
    const partial = { ...evidence, resolvedText: { $a1: 'Duties' }, descriptionReadError: 'UNRESOLVED_FLIGHT_TEXT', unresolvedTextReferences: ['$b2'] };
    const kept = read('personio', { ...position, subcompany: 'Maison France', personioDetail: partial }, url, '42', config);
    expect(kept).toMatchObject({ status: 'RECOVERABLE', job: { company: 'Maison France', employerEvidence: { rule: 'EXPLICIT_PERSONIO_LEGAL_ENTITY' } } });
    if (kept.status === 'RECOVERABLE') expect(kept.job.description).toContain('XML description');
    expect(read('personio', { ...position, personioDetail: { position: evidence.position } }, url, '42', config)).toMatchObject({ reason: 'READER_UNQUALIFIED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rebuilds a Phenom CareerConnect entry (Hugo Boss dialect) from its retained list row and detail evidence, which the api/jobs reader cannot identify', () => {
    const config = { origin: 'https://careers.hugoboss.com', dialect: 'CAREER_CONNECT_WIDGETS', localePath: 'global/en' };
    const url = 'https://careers.hugoboss.com/global/en/job/143861/tax-manager-corporate-tax-m-w-d';
    const entry = { jobSeqNo: 'HUBOGLOBAL143861EXTERNALENGLOBAL', jobId: '143861', reqId: '143861', title: 'Tax Manager Corporate Tax (m/w/d)', descriptionTeaser: '<p>Teaser only</p>',
      city: 'Metzingen', state: 'Baden-Württemberg', country: 'Germany', cityState: 'Metzingen, Baden-Württemberg', dateCreated: '2026-09-01T00:00:00.000Z', hiringType: 'Full time',
      latitude: '48.53', longitude: '9.28', category: 'Finance', locale: 'en_global' };
    // Prémisse : sous le lecteur du dialecte historique (`slug`/`req_id`), cette ligne n'a pas d'identifiant natif — le refus des 671 lignes Hugo Boss en F3b.
    expect(read('phenom', entry, url, entry.jobSeqNo, { origin: config.origin })).toMatchObject({ status: 'RECOLLECT_OR_REVIEW', reason: 'NATIVE_ID_MISSING' });
    const teaser = read('phenom', entry, url, entry.jobSeqNo, config);
    expect(teaser).toMatchObject({ status: 'RECOVERABLE', job: { title: entry.title, url, externalId: entry.jobSeqNo, city: 'Metzingen', country: 'Germany', latitude: 48.53 } });
    if (teaser.status === 'RECOVERABLE') expect(teaser.job.description).toBe('Teaser only');
    const withEvidence = read('phenom', { ...entry, postingEvidence: postingEvidence(url) }, url, entry.jobSeqNo, config);
    expect(withEvidence).toMatchObject({ status: 'RECOVERABLE', job: { url, externalId: entry.jobSeqNo, raw: { jobSeqNo: entry.jobSeqNo, postingEvidence: { pageUrl: url } } } });
    if (withEvidence.status === 'RECOVERABLE') expect(withEvidence.job.description).toBe('Detail description');
    expect(read('phenom', { ...entry, postingEvidence: postingEvidence('https://careers.hugoboss.com/global/en/job/999/other') }, url, entry.jobSeqNo, config)).toMatchObject({ reason: 'DETAIL_EVIDENCE_UNUSABLE' });
    expect(read('phenom', { ...entry, jobSeqNo: '' }, url, entry.jobSeqNo, config)).toMatchObject({ reason: 'NATIVE_ID_MISSING' });
    expect(read('phenom', entry, url, 'other', config)).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
    expect(identity('phenom', entry, url, entry.jobSeqNo, config)).toMatchObject({ status: 'VERIFIED' });
    expect(read('phenom', entry, url, entry.jobSeqNo, { ...config, dialect: 'UNKNOWN_DIALECT' })).toMatchObject({ reason: 'READER_UNQUALIFIED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rebuilds a Talentsoft listing card from its retained card, RSS item and detail page, and refuses the card-only shape of the old reader', () => {
    const config = { origin: 'https://recrutement.maison.example' };
    const path = '/offre-de-emploi/emploi-vendeur-conseil-h-f_10266.aspx'; const url = `${config.origin}${path}`;
    const card = { path, id: '10266', title: 'Vendeur Conseil H/F - A&#233;roport de Nice', cells: ['Réf. : 2026-10266', '08/09/2026', 'CDI', 'Nice'] };
    // Prémisse : aucun `link` — la forme que le lecteur historique refusait (`NATIVE_ID_MISSING` sur 100 % des lignes de sept sources).
    expect((card as Record<string, unknown>).link).toBeUndefined();
    const listed = read('talentsoft', card, url, '10266', config);
    expect(listed).toMatchObject({ status: 'RECOLLECT_OR_REVIEW', reason: 'CONTENT_MISSING' });
    expect(identity('talentsoft', card, url, '10266', config)).toMatchObject({ status: 'VERIFIED' });
    const detail = { pageUrl: url, htmlSha256: 'c'.repeat(64), description: 'Detail description' };
    const withDetail = read('talentsoft', { ...card, talentsoftDetail: detail }, url, '10266', config);
    expect(withDetail).toMatchObject({ status: 'RECOVERABLE', job: { title: 'Vendeur Conseil H/F - Aéroport de Nice', url, externalId: '10266', location: 'Nice', raw: { path, talentsoftDetail: detail } } });
    if (withDetail.status === 'RECOVERABLE') { expect(withDetail.job.description).toBe('Detail description'); expect(withDetail.job.postedAt?.toISOString()).toBe('2026-09-08T00:00:00.000Z'); }
    const rss = { link: `${config.origin}/offre-de-emploi/emploi-vendeur-conseil-h-f_10266.aspx`, title: 'Vendeur Conseil H/F', description: '<p>RSS description</p>', category: ['Commerce', 'CDI', 'Nice'], pubDate: 'Tue, 08 Sep 2026 00:00:00 GMT' };
    const withRss = read('talentsoft', { ...card, rss }, url, '10266', config);
    expect(withRss).toMatchObject({ status: 'RECOVERABLE', job: { title: 'Vendeur Conseil H/F', url, externalId: '10266', contract: 'CDI', location: 'Nice', raw: { path, rss } } });
    if (withRss.status === 'RECOVERABLE') expect(withRss.job.description).toBe('RSS description');
    expect(read('talentsoft', { ...card, rss: { ...rss, link: `${config.origin}/offre-de-emploi/autre_99999.aspx` } }, url, '10266', config)).toMatchObject({ reason: 'DETAIL_IDENTITY_MISMATCH' });
    expect(read('talentsoft', { ...card, talentsoftDetail: { ...detail, pageUrl: `${config.origin}/autre` } }, url, '10266', config)).toMatchObject({ reason: 'DETAIL_EVIDENCE_UNUSABLE' });
    expect(read('talentsoft', { ...card, id: '99999' }, url, '10266', config)).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
    expect(read('talentsoft', { path }, url, '10266', config)).toMatchObject({ reason: 'CONTENT_MISSING' });
    expect(read('talentsoft', rss, rss.link, '10266', config)).toMatchObject({ status: 'RECOVERABLE', job: { externalId: '10266', url: rss.link } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
