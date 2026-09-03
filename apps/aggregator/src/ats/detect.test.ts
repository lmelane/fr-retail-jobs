import { describe, it, expect } from 'vitest';
import { detectionFromUrl, detectFromHtml } from './detect.js';
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
