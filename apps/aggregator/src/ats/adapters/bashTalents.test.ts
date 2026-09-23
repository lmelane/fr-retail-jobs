import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn(), DEFAULT_DETAIL_CONCURRENCY: 4 }));

import { fetchText } from '../../lib/http.js';
import { fetchBashTalentsJobs, parseBashDetail, parseBashListing } from './bashTalents.js';
import { normalizeAdapterResult } from '../index.js';

const mockText = vi.mocked(fetchText);
beforeEach(() => mockText.mockReset());

/** Deux cartes telles que talents.ba-sh.com/fr-FR/offres les rend (capturées le 2026-09-06). */
const LISTING = `
<p class="text-right">50 Résultats</p>
<div id="job-offers">
<div class="job-wrapper simulate-href" attr-href="https://talents.ba-sh.com/fr-FR/offre/BASH_CE23B0" itemscope itemtype="http://schema.org/JobPosting">
  <div class="job-content">
    <p class="title-default" itemprop="title">conseiller·ère de vente f/h - boutique marseille - cdd 35h</p>
    <p class="job-path" itemprop="industry">Conseiller.ère de Vente &amp; Premier.ère Vendeur.euse</p>
    <div class="description_short" itemprop="description"></div>
  </div>
  <div class="job-footer"><ul>
    <li class="hide-xs"><i class="icon icon-clock"></i> <b>09/2026</b></li>
    <li><i class="icon icon-position"></i> <b>Marseille, Provence – Alpes – Côte - d’Azur</b></li>
    <li><i class="icon icon-contract"></i> <b>CDD</b></li>
  </ul></div>
  <div class="hide">
    <span itemprop="hiringOrganization" itemtype="http://schema.org/Organization" itemscope><span itemprop="name">Ba&sh</span></span>
    <span itemprop="employmentType">contract</span>
    <span itemprop="jobLocation" itemtype="http://schema.org/Place" itemscope>
      <span itemprop="address" itemtype="http://schema.org/PostalAddress" itemscope>
        <span itemprop="addressLocality">Marseille</span>
        <span itemprop="addressRegion">Provence – Alpes – Côte - d’Azur</span>
      </span>
    </span>
    <span itemprop="datePosted">05/09/2026</span>
  </div>
</div>
<div class="job-wrapper simulate-href" attr-href="https://talents.ba-sh.com/fr-FR/offre/BASH_001CA6" itemscope itemtype="http://schema.org/JobPosting">
  <div class="job-content">
    <p class="title-default" itemprop="title">assistant·e digital marketing f/h</p>
    <p class="job-path" itemprop="industry">Direct to consumer</p>
    <div class="description_short" itemprop="description"><p>Au sein de l&rsquo;&eacute;quipe Digital, vous serez rattach&eacute;.e au p&ocirc;le Direct to Customer.</p></div>
  </div>
  <div class="job-footer"><ul>
    <li><i class="icon icon-position"></i> <b>Paris, Île-de-France</b></li>
    <li><i class="icon icon-contract"></i> <b>Alternance</b></li>
  </ul></div>
  <div class="hide">
    <span itemprop="employmentType">full-time</span>
    <span itemprop="addressLocality">Paris</span>
    <span itemprop="addressRegion">Île-de-France</span>
    <span itemprop="datePosted">06/09/2026</span>
  </div>
</div>
</div>`;

/**
 * La page /fr-FR/offre/BASH_001CA6 : intro maison, puis « Descriptif du poste », puis « Profil recherché ».
 * Sa « Date de publication » est la VRAIE (mesurée le 2026-09-15 : 02/09/2026 quand le listing
 * annonçait 15/09 pour les 50 offres à la fois).
 */
const DETAIL = `
<p class="title-primary" itemprop="title">assistant·e digital marketing f/h</p>
<p><b>Date de publication : </b> <span itemprop="datePosted">02/09/2026</span></p>
<div class="text-primary text-justify cms-content"><!DOCTYPE html><html><body><p>En 2003, Barbara Boccara &amp; Sharon Krief cr&eacute;ent ba&amp;sh.</p></body></html></div>
<hr class="small-margin-top"/>
<p class="title-default">Descriptif du poste</p>
<div class="text-primary text-justify cms-content" itemprop="description"><!DOCTYPE html><html><body><p class="MsoNormal">Au sein de l&rsquo;&eacute;quipe Digital, vous serez rattach&eacute;.e au p&ocirc;le Direct to Customer (DTC).</p><p>Vos missions sont les suivantes :</p></body></html></div>
<hr/>
<p class="title-default">Profil recherché</p>
<div class="text-primary text-justify cms-content"><!DOCTYPE html><html><body><p>Vous pr&eacute;parez un Master en marketing digital.</p></body></html></div>
<hr/>
<span itemprop="experienceRequirements">Etudiant</span>
<span itemprop="employmentType" class="hide">contract</span>`;

describe('parseBashListing', () => {
  it('lit identifiant, titre, lieu, contrat, métier et date depuis les microdonnées', () => {
    const { jobs, declaredTotal } = parseBashListing(LISTING);
    expect(declaredTotal).toBe(50);
    expect(jobs).toHaveLength(2);
    const [job] = jobs;
    expect(job.externalId).toBe('BASH_CE23B0');
    expect(job.title).toBe('conseiller·ère de vente f/h - boutique marseille - cdd 35h');
    expect(job.url).toBe('https://talents.ba-sh.com/fr-FR/offre/BASH_CE23B0');
    expect(job.location).toBe('Marseille, Provence – Alpes – Côte - d’Azur');
    expect(job.city).toBe('Marseille');
    expect(job.region).toBe('Provence – Alpes – Côte - d’Azur');
    expect(job.contract).toBe('CDD');
    expect(job.department).toBe('Conseiller.ère de Vente & Premier.ère Vendeur.euse');
    expect(job.postedAt?.toISOString()).toBe('2026-09-05T00:00:00.000Z');
    expect(job.description).toBeUndefined();
  });

  it('garde la description du listing quand elle est remplie (3 offres sur 50)', () => {
    const { jobs } = parseBashListing(LISTING);
    expect(jobs[1].description).toContain('Au sein de l’équipe Digital, vous serez rattaché.e au pôle');
  });

  it('déduplique deux cartes du même identifiant', () => {
    expect(parseBashListing(LISTING + LISTING).jobs).toHaveLength(2);
  });
});

/**
 * LE CONTRAT DES IDENTIFIANTS CANONIQUES.
 *
 * `BASH_xxx` est l'identifiant NATIF servi par le portail dans `attr-href`, et le même chemin d'identité que
 * `externalId`. Sans la propriété `canonicalIds` sur la preuve, cette source ne peut démontrer aucune absence
 * (`UNVERIFIABLE`). Le listing étant rendu en UN seul document, il n'y a qu'une page de preuve : pas de page
 * muette possible, donc pas de contrat partiel.
 */
describe('Ba&sh — contrat des identifiants canoniques', () => {
  it('déclare canonicalIds, exactement les BASH_xxx servis par le listing', async () => {
    mockText.mockResolvedValue(LISTING);
    const r = await fetchBashTalentsJobs({ withDescriptions: false });

    const pages = r.enumeration!.pageEvidence!;
    expect(pages).toHaveLength(1);
    expect(Object.hasOwn(pages[0], 'canonicalIds')).toBe(true);
    expect(pages[0].canonicalIds).toEqual(['BASH_CE23B0', 'BASH_001CA6']);
    expect(pages[0].canonicalIds).toEqual(r.jobs.map(j => j.externalId));
    expect(r.enumeration!.canonicalAbsenceProofUsable).toBe(true);

    const n = normalizeAdapterResult(r);
    expect(n.enumeration?.canonicalIdViolations).toBeUndefined();
    expect(n.enumeration?.issues ?? []).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
  });

  it('une carte vue puis écartée faute de titre reste une DISPOSITION nommée', async () => {
    const sansTitre = LISTING.replace('<p class="title-default" itemprop="title">assistant·e digital marketing f/h</p>', '');
    mockText.mockResolvedValue(sansTitre);
    const r = await fetchBashTalentsJobs({ withDescriptions: false });

    expect(r.jobs.map(j => j.externalId)).toEqual(['BASH_CE23B0']);
    // Observée dans la preuve MALGRÉ le rejet : sans cela elle paraîtrait disparue au refresh suivant.
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual(['BASH_CE23B0', 'BASH_001CA6']);
    expect(r.rejectedRows?.map(row => row.canonicalId)).toEqual(['BASH_001CA6']);
    expect(normalizeAdapterResult(r).enumeration?.canonicalIdViolations).toBeUndefined();
  });

  it("une carte dont le lien ne porte pas de BASH_xxx interdit l'attestation d'absence", async () => {
    mockText.mockResolvedValue(LISTING.replace('https://talents.ba-sh.com/fr-FR/offre/BASH_001CA6', 'https://talents.ba-sh.com/fr-FR/page/autre'));
    const r = await fetchBashTalentsJobs({ withDescriptions: false });
    expect(r.enumeration!.canonicalAbsenceProofUsable).toBe(false);
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual(['BASH_CE23B0']);
  });
});

describe('parseBashDetail', () => {
  it('assemble « Descriptif du poste » et « Profil recherché », sans l’intro maison', () => {
    const { description, experience } = parseBashDetail(DETAIL);
    expect(description).toContain("Au sein de l’équipe Digital, vous serez rattaché.e au pôle Direct to Customer (DTC)");
    expect(description).toContain('Vous préparez un Master en marketing digital');
    expect(description).not.toMatch(/&[a-z]+;/);
    expect(description).not.toContain('Barbara Boccara');
    expect(description).not.toContain('<p');
    expect(experience).toBe('Etudiant');
  });
});

describe('fetchBashTalentsJobs', () => {
  it('lit le listing puis le détail de chaque offre, et fait primer le détail', async () => {
    mockText.mockResolvedValueOnce(LISTING).mockResolvedValue(DETAIL);

    const { jobs, declaredTotal, truncated } = await fetchBashTalentsJobs({});

    expect(mockText).toHaveBeenCalledTimes(3);
    expect(mockText.mock.calls[0][0]).toBe('https://talents.ba-sh.com/fr-FR/offres');
    expect(jobs[0].description).toContain('Direct to Customer (DTC)');
    expect(declaredTotal).toBe(50);
    // Le site annonce 50 : la fixture n'en rend que 2 → lecture incomplète signalée.
    expect(truncated).toBe(true);
  });

  /**
   * Le listing sert la date du JOUR sur toutes les offres à la fois, quand les
   * fiches portent des dates échelonnées.
   *
   * Mesuré contre la source le 2026-09-17 (`npm run verif:bash-live`) : 50
   * offres, 7 dates distinctes une fois les fiches lues. Sans ce correctif, une.
   *
   * Le candidat ne CHOISIT pas de trier par fraîcheur — aucun tri ne lui est
   * exposé. La date agit ailleurs, à deux endroits vérifiés le 2026-09-17 :
   * le classement du matching (R-83 / D-415, « du plus récent au plus ancien
   * au jour parisien près »), et la fiche, seul écran qui la montre encore, en
   * relatif — une offre du 01/09 y annonçait « aujourd'hui ».
   *
   * Le témoin AFFIRME D'ABORD SA PRÉMISSE : sans un listing dont la date diffère
   * de celle de la fiche, il ne pourrait pas distinguer les deux sources et
   * passerait au vert sans jamais exercer le défaut.
   */
  it('fait primer la date de publication de la fiche sur celle du listing', async () => {
    const dansLeListing = parseBashListing(LISTING).jobs[0].postedAt;
    expect(dansLeListing).toEqual(new Date(Date.UTC(2026, 8, 5))); // 05/09 — la date trompeuse
    expect(parseBashDetail(DETAIL).postedAt).toEqual(new Date(Date.UTC(2026, 8, 2))); // 02/09 — la vraie
    expect(dansLeListing).not.toEqual(parseBashDetail(DETAIL).postedAt); // sinon ce test ne prouve rien

    mockText.mockResolvedValueOnce(LISTING).mockResolvedValue(DETAIL);
    const { jobs } = await fetchBashTalentsJobs({});

    expect(jobs[0].postedAt).toEqual(new Date(Date.UTC(2026, 8, 2)));
  });

  /**
   * Le repli ne recopie PAS la date du listing : elle vaut « aujourd'hui » pour
   * les 50 offres, et `upsert.ts` l'écrirait par-dessus la vraie date déjà en
   * base (`postedAt: candidate.postedAt ?? null`, sans condition) — chaque échec
   * de fiche rajeunirait l'offre. Ce témoin passerait au vert si l'offre était
   * retirée du résultat : il exige donc AUSSI qu'elle reste servie, sans quoi il
   * validerait un catalogue qui perd des postes ouverts sur un incident réseau.
   */
  it("part sans date plutôt qu'avec celle du listing quand la fiche est injoignable", async () => {
    // Un rejet par offre du listing (2) : pas de promesse rejetée en trop, que
    // le runtime signalerait comme non capturée alors que l'adaptateur l'a bien
    // absorbée — même forme que `talentFunnel.test.ts`.
    mockText
      .mockResolvedValueOnce(LISTING)
      .mockRejectedValueOnce(new Error('detail 503'))
      .mockRejectedValueOnce(new Error('detail 503'));
    const { jobs } = await fetchBashTalentsJobs({});

    expect(parseBashListing(LISTING).jobs[0].postedAt).toBeDefined(); // le listing EN a une : le repli la refuse volontairement
    expect(jobs[0].postedAt).toBeUndefined();
    expect(jobs).toHaveLength(2); // l'offre reste servie : un incident réseau ne retire pas un poste ouvert
    expect(jobs[0].title).toBeTruthy();
    expect(jobs[0].url).toBeTruthy();
  });

  /**
   * `Date.UTC` REPORTE les champs hors bornes au lieu de les refuser : le 31/06
   * ressort au 1er juillet, le 29/02 d'une année non bissextile au 1er mars. La
   * date obtenue a l'air normale, et `plausiblePostedAt` ne l'écarte pas — il ne
   * connaît que `NaN` et le futur lointain. Le lot corrige une date fausse ; sans
   * ce garde-fou elle reviendrait par ce chemin, et ce témoin serait le seul à
   * pouvoir le dire.
   */
  it('refuse une date de fiche impossible au lieu de la reporter au mois suivant', () => {
    const impossible = DETAIL.replace('>02/09/2026<', '>31/06/2026<');
    expect(impossible).not.toEqual(DETAIL); // la substitution a bien eu lieu
    expect(parseBashDetail(impossible).postedAt).toBeUndefined();

    const bissextile = DETAIL.replace('>02/09/2026<', '>29/02/2026<'); // 2026 n'est pas bissextile
    expect(parseBashDetail(bissextile).postedAt).toBeUndefined();

    // Contre-épreuve : une date réelle passe toujours.
    expect(parseBashDetail(DETAIL).postedAt).toEqual(new Date(Date.UTC(2026, 8, 2)));
  });

  /**
   * `String.match` sans drapeau global rend la PREMIÈRE occurrence du document.
   * Les quatre fiches mesurées le 2026-09-17 n'en portent qu'une, mais le portail
   * sert déjà des microdonnées `JobPosting` sur son listing : un bloc « offres
   * similaires » ajouté demain placerait une date étrangère devant la vraie, sans
   * faire rougir quoi que ce soit. D'où l'ancrage sur le libellé.
   */
  it("ignore un datePosted étranger placé avant le bloc « Date de publication »", () => {
    const parasite = `<span itemprop="datePosted">01/01/2020</span>${DETAIL}`;
    expect(parasite.indexOf('01/01/2020')).toBeLessThan(parasite.indexOf('02/09/2026')); // le parasite est bien devant
    expect(parseBashDetail(parasite).postedAt).toEqual(new Date(Date.UTC(2026, 8, 2)));
  });

  it('ne visite pas les détails avec withDescriptions:false', async () => {
    mockText.mockResolvedValueOnce(LISTING);
    const { jobs } = await fetchBashTalentsJobs({ withDescriptions: false });
    expect(mockText).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(2);
  });
});

it('keeps the native listing fragment and detail usable by the retained reader', async () => {
  const { recoverRetainedPublication } = await import('../../publication/recovery.js');
  mockText.mockImplementation(async url => String(url).endsWith('/offres') ? LISTING : DETAIL);
  const {jobs} = await fetchBashTalentsJobs({});
  for(const job of jobs){
    const recovered = recoverRetainedPublication('bashtalents', JSON.parse(JSON.stringify(job.raw)),
      {externalId: job.externalId, url:job.url, observedAt:new Date('2026-09-23T10:00:00Z'), config:{}});
    expect(recovered.status).toBe('RECOVERABLE');
    if(recovered.status==='RECOVERABLE') expect(recovered.job.description).toBe(job.description);
  }
});
