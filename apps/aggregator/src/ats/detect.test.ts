import { describe, it, expect } from 'vitest';
import { detectionFromUrl, detectFromHtml, detectAllLinkedAts } from './detect.js';
import { KIND_TO_ATS } from '../pipeline/ingest.js';

/**
 * C-05a — la matrice vendor × (détection, adaptateur), épinglée.
 *
 * Le trou mesuré : 356 des 366 « generic-listing » gated étaient des boards de
 * vendors à VRAI adaptateur que la détection ne reconnaissait pas — ils
 * tombaient dans le crawler générique et produisaient zéro. Chaque ligne ici
 * prouve (1) que la signature détecte, (2) que le type détecté a un adaptateur
 * câblé dans le dispatcher du pipeline.
 */

const URL_CASES: Array<{ url: string; type: string; config: Record<string, unknown> }> = [
  { url: 'https://candidate.hr-manager.net/vacancies/list.aspx?customer=ganni&uiculture=en', type: 'TALENT_RECRUITER', config: { customer: 'ganni', locale: 'en' } },
  { url: 'https://harri.com/Saltrock-Careers', type: 'HARRI', config: { slug: 'Saltrock-Careers', portalUrl: 'https://harri.com/Saltrock-Careers' } },
  { url: 'https://capri.wd1.myworkdayjobs.com/en-US/Michael_Kors', type: 'WORKDAY', config: { tenant: 'capri', site: 'Michael_Kors' } },
  { url: 'https://hub-urbn.icims.com/jobs/search', type: 'ICIMS', config: { origin: 'https://hub-urbn.icims.com' } },
  { url: 'https://eljs.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs', type: 'ORACLE_HCM', config: { siteNumber: 'CX' } },
  { url: 'https://lde.tbe.taleo.net/lde02/ats/careers/v2/searchResults?org=ARNOTTS&cws=41', type: 'TALEO', config: { origin: 'https://lde.tbe.taleo.net/lde02', org: 'ARNOTTS', cws: [41] } },
  { url: 'https://boards.greenhouse.io/lacoste', type: 'GREENHOUSE', config: { board: 'lacoste' } },
  { url: 'https://jobs.lever.co/allbirds', type: 'LEVER', config: { site: 'allbirds' } },
  { url: 'https://careers.smartrecruiters.com/SMCP', type: 'SMARTRECRUITERS', config: { company: 'SMCP' } },
  { url: 'https://maison.recruitee.com/', type: 'RECRUITEE', config: { subdomain: 'maison' } },
  { url: 'https://brand.jobs.personio.de/', type: 'PERSONIO', config: { subdomain: 'brand', host: 'brand.jobs.personio.de' } },
  { url: 'https://richemont.wd3.myworkdayjobs.com/Richemont', type: 'WORKDAY', config: { tenant: 'richemont', site: 'Richemont', origin: 'https://richemont.wd3.myworkdayjobs.com' } },
  // Les branches ajoutées par C-05a :
  { url: 'https://apply.workable.com/apm-monaco/', type: 'WORKABLE', config: { account: 'apm-monaco' } },
  { url: 'https://jobs.ashbyhq.com/sezane', type: 'ASHBY', config: { board: 'sezane' } },
  { url: 'https://brand.teamtailor.com/jobs', type: 'TEAMTAILOR', config: { origin: 'https://brand.teamtailor.com' } },
  { url: 'https://brand.pinpointhq.com/', type: 'PINPOINT', config: { origin: 'https://brand.pinpointhq.com' } },
  { url: 'https://app.eightfold.ai/careers', type: 'EIGHTFOLD', config: { origin: 'https://app.eightfold.ai', domain: 'app.eightfold.ai' } },
  { url: 'https://loreal.avature.net/jobs/SearchJobs/', type: 'AVATURE', config: { origin: 'https://loreal.avature.net', listingUrl: 'https://loreal.avature.net/jobs/SearchJobs/' } },
];

describe('detectionFromUrl — matrice vendor (C-05a)', () => {
  for (const { url, type, config } of URL_CASES) {
    it(`${type}: reconnaît ${new URL(url).hostname} et son adaptateur existe`, () => {
      const detection = detectionFromUrl(url);
      expect(detection?.type).toBe(type);
      expect(detection?.config).toMatchObject(config);
      // Le type détecté doit être branchable dans le pipeline (kind -> ATS).
      expect(Object.values(KIND_TO_ATS)).toContain(type);
    });
  }
});

describe('detectFromHtml — widgets embarqués (C-05a)', () => {
  const page = 'https://careers.brand.com/jobs';
  const cases: Array<{ marker: string; type: string }> = [
    { marker: '<script src="https://static.eightfold.ai/pcs.js"></script>', type: 'EIGHTFOLD' },
    { marker: '<script src="https://cdn.phenompeople.com/widget.js"></script>', type: 'PHENOM' },
    { marker: '<link href="https://assets.sfstatic.io/theme.css">', type: 'SUCCESSFACTORS' },
    { marker: '<iframe src="https://brand.avature.net/careers"></iframe>', type: 'AVATURE' },
    { marker: '<script>fetch("https://api.magnet.work/v2/job-offers", {siteKey: "9550007d348362827f2534be59208f28"})</script>', type: 'MAGNET' },
    { marker: '<script src="https://cdn.pinpointhq.com/embed.js"></script>', type: 'PINPOINT' },
  ];
  for (const { marker, type } of cases) {
    it(`${type}: signature widget reconnue`, () => {
      const detection = detectFromHtml(`<html><body>${marker}</body></html>`, page);
      expect(detection?.type).toBe(type);
    });
  }

  it('MAGNET capture la siteKey inlinée — sans elle l’adaptateur ne peut rien', () => {
    const detection = detectFromHtml(
      '<script>var siteKey = "9550007d348362827f2534be59208f28";</script><script src="https://api.magnet.work/x.js"></script>',
      page,
    );
    expect(detection?.type).toBe('MAGNET');
    expect(detection?.config.siteKey).toBe('9550007d348362827f2534be59208f28');
  });
});

describe('detectFromHtml — vendors nommés SANS adaptateur', () => {
  const page = 'https://www.brand.com/careers';

  /**
   * Mesuré 2026-09-04 sur aeropostale.com : la page carrière portait la chaîne
   * "icims" en clair et la détection renvoyait null. La marque était classée
   * « aucun ATS trouvé » alors que la vérité était « iCIMS, adaptateur
   * manquant » — deux conclusions qui commandent deux travaux différents.
   */
  const cases: Array<{ marker: string; vendor: string }> = [
    { marker: '<a href="https://brand.taleo.net/careersection/ex/joblist.ftl">Jobs</a>', vendor: 'Taleo Enterprise' },
    { marker: '<iframe src="https://workforcenow.adp.com/mascsr/default/careers"></iframe>', vendor: 'ADP' },
    { marker: '<a href="https://brand.csod.com/ux/ats/careersite/4/home">Careers</a>', vendor: 'Cornerstone' },
    { marker: '<a href="https://brand.gupy.io/">Vagas</a>', vendor: 'Gupy' },
    { marker: '<a href="https://brand.kallidusrecruit.com/Search.aspx">Vacancies</a>', vendor: 'Kallidus' },
    { marker: '<a href="https://dc7.pageuppeople.com/apply">Apply</a>', vendor: 'PageUp' },
  ];

  for (const { marker, vendor } of cases) {
    it(`${vendor} est nommé dans la note, sans être promouvable`, () => {
      const detection = detectFromHtml(`<html><body>${marker}</body></html>`, page);
      expect(detection?.note).toContain(vendor);
      // Aucun adaptateur : le type reste générique pour que rien ne l'ingère.
      expect(detection?.type).toBe('GENERIC_JSONLD');
    });
  }

  it('un ATS OUTILLÉ gagne toujours sur un vendor non outillé présent sur la même page', () => {
    const detection = detectFromHtml(
      '<html><body><a href="https://brand.csod.com/jobs">A</a>' +
        '<a href="https://boards.greenhouse.io/brand">B</a></body></html>',
      page,
    );
    expect(detection?.type).toBe('GREENHOUSE');
  });
});

describe('ATS_HOSTS couvre tout ce que detectionFromUrl sait lire', () => {
  /**
   * ATS_HOSTS filtre les liens AVANT detectionFromUrl : un hôte absent de la
   * liste n'est jamais soumis à la détection, même quand la branche URL existe.
   * Mesuré 2026-09-04 : Workable, Ashby, Pinpoint, Eightfold et Avature étaient
   * exactement dans ce cas.
   */
  const linked: Array<{ url: string; type: string }> = [
    { url: 'https://apply.workable.com/brand/', type: 'WORKABLE' },
    { url: 'https://jobs.ashbyhq.com/brand', type: 'ASHBY' },
    { url: 'https://brand.pinpointhq.com/', type: 'PINPOINT' },
    { url: 'https://brand.eightfold.ai/careers', type: 'EIGHTFOLD' },
    { url: 'https://brand.avature.net/careers', type: 'AVATURE' },
  ];

  for (const { url, type } of linked) {
    it(`${type} lié depuis une page vitrine est détecté`, () => {
      const detection = detectFromHtml(
        `<html><body><a href="${url}">Nous rejoindre</a></body></html>`,
        'https://www.brand.com/',
      );
      expect(detection?.type).toBe(type);
    });
  }
});

describe('detectFromHtml — plusieurs ATS liés depuis une même page', () => {
  /**
   * Mesuré le 2026-09-05 sur careers.nike.com : 10 liens Workday (le board)
   * et 3 liens Avature (la « talent community »). Avature sortait en premier
   * et la source rendait 0 offre. Un board est lié depuis chaque offre, un
   * widget périphérique une fois : le plus cité gagne.
   */
  it('préfère l’ATS le plus lié, pas le premier rencontré', () => {
    const html =
      '<a href="https://nikeats.avature.net/niketalentcommunity">Talent community</a>' +
      '<a href="https://nike.wd1.myworkdayjobs.com/nke/job/a">A</a>' +
      '<a href="https://nike.wd1.myworkdayjobs.com/nke/job/b">B</a>' +
      '<a href="https://nike.wd1.myworkdayjobs.com/nke/job/c">C</a>';
    const d = detectFromHtml(html, 'https://careers.nike.com/jobs');
    expect(d?.type).toBe('WORKDAY');
    expect(d?.config.site).toBe('nke');
  });
});

import { careersLinksInHtml } from './detect.js';

describe('official homepage career discovery', () => {
  it('retains external recruitment links and excludes shop promotions', () => {
    const html = '<a href="/offres">Nos offres</a><a href="/newsletter">Rejoindre la newsletter</a>' +
      '<a href="https://adopt.flatchr.io/fr/company/adopt">Nous rejoindre</a>';
    expect(careersLinksInHtml(html, 'https://www.adopt.com/fr/'))
      .toEqual(['https://adopt.flatchr.io/fr/company/adopt']);
    expect(detectFromHtml(html, 'https://www.adopt.com/fr/')).toMatchObject({
      type: 'FLATCHR', config: { listingUrl: 'https://adopt.flatchr.io/fr/company/adopt/' },
    });
    expect(Object.values(KIND_TO_ATS)).toContain('FLATCHR');
  });
  it('never mistakes an arbitrary Flatchr script for an ingestible employer board', () => {
    expect(detectFromHtml('<script src="https://api.flatchr.io/widget.js"></script>', 'https://brand.com/')).toBeNull();
  });
});

it('reads root-hosted Flatchr board identity from payload, not the domain slug', () => {
  const html = '<script id="__NEXT_DATA__">'+JSON.stringify({page:'/company/[companySlug]',query:{companySlug:'toscane'},props:{baseUrlPath:'/fr/company'}})+'</script>';
  expect(detectFromHtml(html,'https://toscane.flatchr.io/')).toMatchObject({type:'FLATCHR',config:{listingUrl:'https://toscane.flatchr.io/fr/company/toscane/'}});
});


describe('Lot 4 — candidates preserve global portals without inventing configurations', () => {
  it('retains all supported portals, coalescing job links on the same board', () => {
    const html = '<a href="https://a.wd1.myworkdayjobs.com/en-US/External/job/1">A</a>' +
      '<a href="https://a.wd1.myworkdayjobs.com/External/job/2">B</a>' +
      '<a href="https://b.icims.com/jobs/search">C</a>';
    expect(detectAllLinkedAts(html, 'https://brand.com')).toHaveLength(2);
  });
  it('does not infer a board from a locale, or TBE from Enterprise', () => {
    expect(detectionFromUrl('https://a.wd1.myworkdayjobs.com/en-US')).toBeNull();
    expect(detectionFromUrl('https://a.taleo.net/careersection/ex/joblist.ftl')).toBeNull();
    expect(detectionFromUrl('https://a.oraclecloud.com/hcmUI/CandidateExperience/en/')).toBeNull();
  });
  it('does not recognise lookalike vendor domains or non-HTTP links', () => {
    expect(detectionFromUrl('https://evilgreenhouse.io/acme')).toBeNull();
    expect(detectionFromUrl('ftp://boards.greenhouse.io/acme')).toBeNull();
    expect(detectAllLinkedAts('<a href="https://boards.greenhouse.io.evil.com/acme">Careers</a>', 'https://brand.com')).toEqual([]);
  });
});
