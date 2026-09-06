import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAvatureListing, parseAvaturePortalDetail, parseAvaturePortalListing, titleFromCard } from './avature.js';

describe('titleFromCard — le bouton n’est pas un intitulé de poste', () => {
  /**
   * Mesuré le 2026-09-05 sur careers.loreal.com : 20 des 40 cartes de la
   * première page rendaient « Apply Now », et 189 offres actives en base
   * portaient ce titre. Le candidat voyait 189 annonces identiques.
   */
  const url =
    'https://careers.loreal.com/en_US/jobs/JobDetail/Regional-Activation-Manager-m-f-d-for-the-Consumer-Products-Division-Romandie/253399';

  it('remplace un libellé de bouton par le titre porté par l’URL', () => {
    expect(titleFromCard('Apply Now', url)).toBe(
      'Regional Activation Manager m f d for the Consumer Products Division Romandie',
    );
  });

  it.each(['Apply', 'Postuler', 'Bewerben', 'View Job', 'En savoir plus', 'Read more'])(
    '« %s » est reconnu comme un bouton',
    (label) => {
      expect(titleFromCard(label, url)).not.toBe(label);
    },
  );

  it('garde un vrai titre tel quel', () => {
    expect(titleFromCard('Nordic Data & Analytics Manager', url)).toBe('Nordic Data & Analytics Manager');
  });

  it('ne fabrique rien quand l’URL ne porte pas de slug', () => {
    expect(titleFromCard('Apply Now', 'https://careers.loreal.com/en_US/jobs/')).toBeUndefined();
  });

  it('un titre qui CONTIENT le mot n’est pas confondu avec le bouton', () => {
    expect(titleFromCard('Apply Engineering Manager', url)).toBe('Apply Engineering Manager');
  });
});

describe('parseAvatureListing — le marqueur de date dépend de la langue', () => {
  /**
   * Le code ne connaissait que « Publié ». careers.loreal.com, servi en
   * anglais, écrit « Posted 01-Oct-2026 » : l'index restait introuvable et la
   * ville, pourtant juste avant, était perdue — 20 cartes sur 20 sans lieu.
   */
  const card = (marker: string) =>
    `<a href="/en_US/jobs/JobDetail/Nordic-Data-Analytics-Manager/9">Nordic Data & Analytics Manager</a>` +
    `<span>Copenhagen</span><span>${marker} 01-Oct-2026</span><p>A day in the role...</p>`;

  it.each(['Posted', 'Publié', 'Veröffentlicht', 'Publicado'])('« %s » situe la ville', (marker) => {
    const [job] = parseAvatureListing(card(marker));
    expect(job.location).toBe('Copenhagen');
  });

  it('lit aussi la date de publication', () => {
    const [job] = parseAvatureListing(card('Posted'));
    expect(job.postedAt?.getUTCFullYear()).toBe(2026);
  });
});

describe('mode portail — gabarit careers.ralphlauren.com (capturé le 2026-09-06)', () => {
  /** Une carte de `SearchJobsCorporate/?jobOffset=0` telle que le portail la rend. */
  const CARD = `
<p class="results">1-6
                                    of 209
                 results</p>
<article class="article article--result 1" id="article--1">
<div class="article__header"><div class="article__header__text">
<h3 class="article__header__text__title title title--h6" data-au="ag-h3-6">
<a class="link" href="https://careers.ralphlauren.com/en_US/CareersCorporate/JobDetailCorporate?jobId=67979" data-au="ag-a-10">
(Senior) Sales Executive (w/m/d), Polo MW
</a>
</h3>
<div class="article__header__text__subtitle">
<span class="list-item-location">München, Bavaria, Germany</span> <span class="separator" aria-hidden="true">&nbsp;&#8226;&nbsp;</span> <span class="list-item-ref">#W181339</span> <span class="separator" aria-hidden="true">&nbsp;&#8226;&nbsp;</span> <span class="list-item-department">Sales &amp; Customer Support</span>
</div></div></div>
<p class="article__content" tabindex="0">
What you will dopresentation and selling of our collections in our Showroom...
</p>
<div class="article__footer">
<a class="button button--share button--apply" href="https://careers.ralphlauren.com/en_US/CareersCorporate/ApplicationMethods?jobId=67979">APPLY</a>
</div>
</article>`;

  /** La page `JobDetailCorporate?jobId=67979`, réduite à ses blocs `article--details`. */
  const DETAIL = `
<article class="article article--details regular-fields--cols-2Z" >
<div class="article__content__view__field "><div class="article__content__view__field__label" >
Ref #
</div><div class="article__content__view__field__value">
W181339
</div></div>
<div class="article__content__view__field "><div class="article__content__view__field__label" >
State/Region
</div><div class="article__content__view__field__value">
Bavaria
</div></div>
<div class="article__content__view__field "><div class="article__content__view__field__label" >
Location
</div><div class="article__content__view__field__value">
Germany
</div></div>
<div class="article__content__view__field "><div class="article__content__view__field__label" >
City
</div><div class="article__content__view__field__value">
München
</div></div>
</article>
<article class="article article--details " >
<h2 class="article__header__text__title title title--h6" id="section3__title">
COMPANY DESCRIPTION
</h2>
<div class="article__content__view__field__value">
<html> <div style="text-align: justify;"> <body> Ralph Lauren Corporation (NYSE:RL) is a global leader in the design, marketing and distribution of premium lifestyle products. </body></div></html>
</div>
</article>
<article class="article article--details " >
<h2 class="article__header__text__title title title--h6" id="section5__title">
ESSENTIAL DUTIES &amp; RESPONSIBILITIES
</h2>
<div class="article__content__view__field__value">
<div><u>What you will do</u></div><ul><li><span>presentation and selling of our collections in our Showroom</span></li><li><span>regular visits of designated accounts</span></li></ul>
</div>
</article>
<article class="article article--details " >
<h2 class="article__header__text__title">Share this job</h2>
<div>Facebook LinkedIn X</div>
</article>`;

  it('lit identifiant, titre, lieu, lien et référence depuis une carte', () => {
    const { jobs, declaredTotal } = parseAvaturePortalListing(CARD);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].externalId).toBe('67979');
    expect(jobs[0].title).toBe('(Senior) Sales Executive (w/m/d), Polo MW');
    expect(jobs[0].location).toBe('München, Bavaria, Germany');
    expect(jobs[0].url).toBe('https://careers.ralphlauren.com/en_US/CareersCorporate/JobDetailCorporate?jobId=67979');
    expect(jobs[0].raw).toMatchObject({ reference: '#W181339', department: 'Sales & Customer Support' });
    expect(jobs[0].description).toContain('What you will do');
    expect(declaredTotal).toBe(209);
  });

  it('accepte les routes de détail des autres listes (Retail, campus)', () => {
    const retail = CARD.replace(/JobDetailCorporate/g, 'JobDetailRetail').replace(/67979/g, '57705');
    const [job] = parseAvaturePortalListing(retail).jobs;
    expect(job.externalId).toBe('57705');
    expect(job.url).toContain('JobDetailRetail?jobId=57705');
  });

  it('déduplique deux cartes du même identifiant', () => {
    expect(parseAvaturePortalListing(CARD + CARD).jobs).toHaveLength(1);
  });

  it('rend une liste vide (sans total) sur une page qui n’a pas ce gabarit', () => {
    const parsed = parseAvaturePortalListing('<html><body>maintenance</body></html>');
    expect(parsed.jobs).toHaveLength(0);
    expect(parsed.declaredTotal).toBeUndefined();
  });

  it('assemble les sections titrées du détail en une description, sans le partage social', () => {
    const detail = parseAvaturePortalDetail(DETAIL);
    expect(detail.description).toContain('COMPANY DESCRIPTION');
    expect(detail.description).toContain('global leader in the design');
    expect(detail.description).toContain('ESSENTIAL DUTIES & RESPONSIBILITIES');
    expect(detail.description).toContain('regular visits of designated accounts');
    expect(detail.description).not.toContain('Share this job');
    expect(detail.description).not.toContain('<');
  });

  it('lit ville, pays (champ « Location ») et région depuis le bloc de champs', () => {
    const detail = parseAvaturePortalDetail(DETAIL);
    expect(detail.city).toBe('München');
    expect(detail.country).toBe('Germany');
    expect(detail.region).toBe('Bavaria');
    expect(detail.reference).toBe('W181339');
  });

  it('rend des champs vides sur une page sans ce gabarit, pour garder la carte de liste', () => {
    const detail = parseAvaturePortalDetail('<html><body>maintenance</body></html>');
    expect(detail.description).toBeUndefined();
    expect(detail.city).toBeUndefined();
  });
});

describe('parseAvatureListing — carte réelle careers.loreal.com (g6, 2026-09-06)', () => {
  const CARD = readFileSync(new URL('./__fixtures__/g6-loreal-listing-card.html', import.meta.url), 'utf8');

  it('lit titre, ville, date, et un extrait sans artefact « /a> » ni bloc de partage', () => {
    const [job] = parseAvatureListing(CARD);
    expect(job.title).toBe("Skincare Expert pro L'Oréal Luxe (Lancôme, Biotherm, Kiehl's)");
    expect(job.externalId).toBe('253106');
    expect(job.location).toBe('Prague');
    expect(job.postedAt?.toISOString().slice(0, 10)).toBe('2026-07-15');
    expect(job.description).toMatch(/^Jsme L'Oréal CZ\/HU\/SK!/);
    expect(job.description).not.toContain('/a>');
    expect(job.description).not.toContain('Share');
    expect(job.description).not.toContain('Apply Now');
  });

  it('ne compte pas deux fois l’offre par son bouton « Apply Now »', () => {
    expect(parseAvatureListing(CARD)).toHaveLength(1);
  });

  /**
   * Mesuré en base le 2026-09-06 : 63 offres dont la description commence
   * par « /a> Dongguan Posted 16-Jun-2026 … » — ville et date dans le MÊME
   * nœud texte, donc le marqueur ancré en tête de cellule ne les voyait pas.
   */
  it('sépare la ville et la date quand elles partagent une cellule', () => {
    const [job] = parseAvatureListing(
      '<a href="/en_US/jobs/JobDetail/Sales-Manager/250079">Sales Manager</a> Dongguan Posted 16-Jun-2026 <div class="article__content">1. 負責區域百貨櫃點</div>',
    );
    expect(job.location).toBe('Dongguan');
    expect(job.postedAt?.toISOString().slice(0, 10)).toBe('2026-06-16');
    expect(job.description).toBe('1. 負責區域百貨櫃點');
  });
});

// ——— l2 (2026-09-06) : la fiche portail publie `datePosted` en JSON-LD (L'Oréal, 1 771 offres sans date) ———
describe('parseAvaturePortalDetail — l2 : date de publication', () => {
  const LOREAL = readFileSync(new URL('./__fixtures__/g6-loreal-jobdetail.html', import.meta.url), 'utf8');

  it('lit le datePosted du JSON-LD de la fiche', () => {
    expect(parseAvaturePortalDetail(LOREAL).postedAt?.toISOString().slice(0, 10)).toBe('2026-07-15');
  });

  it('reste sans date sur une page sans JSON-LD', () => {
    expect(parseAvaturePortalDetail('<html><body>maintenance</body></html>').postedAt).toBeUndefined();
  });
});
