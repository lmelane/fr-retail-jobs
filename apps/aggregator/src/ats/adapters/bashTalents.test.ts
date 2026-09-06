import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn(), DEFAULT_DETAIL_CONCURRENCY: 4 }));

import { fetchText } from '../../lib/http.js';
import { fetchBashTalentsJobs, parseBashDetail, parseBashListing } from './bashTalents.js';

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

/** La page /fr-FR/offre/BASH_001CA6 : intro maison, puis « Descriptif du poste », puis « Profil recherché ». */
const DETAIL = `
<p class="title-primary" itemprop="title">assistant·e digital marketing f/h</p>
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

  it('ne visite pas les détails avec withDescriptions:false', async () => {
    mockText.mockResolvedValueOnce(LISTING);
    const { jobs } = await fetchBashTalentsJobs({ withDescriptions: false });
    expect(mockText).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(2);
  });
});
