import { describe, it, expect } from 'vitest';
import { detectFromHtml, detectionFromUrl } from './detect.js';

/**
 * Pure detection tests (no network): a page's HTML/URL -> the ATS + config the
 * adapter needs. Locks the widget detections that grow discovery coverage
 * (DigitalRecruiters, Teamtailor, WTTJ/Welcomekit, Flatchr, Factorial), proven
 * end-to-end against the live brands they were derived from.
 */

describe('detectionFromUrl — direct ATS URLs', () => {
  it('extracts the WTTJ org slug from a companies URL', () => {
    const d = detectionFromUrl('https://www.welcometothejungle.com/fr/companies/balzac-paris/jobs');
    expect(d?.type).toBe('WTTJ');
    expect(d?.config.slug).toBe('balzac-paris');
  });

  it('extracts the Workday tenant/site/origin', () => {
    const d = detectionFromUrl('https://richemont.wd3.myworkdayjobs.com/Richemont/job/PARIS/Vendeur_JR1');
    expect(d?.type).toBe('WORKDAY');
    expect(d?.config).toMatchObject({ tenant: 'richemont', site: 'Richemont' });
  });
});

describe('detectFromHtml — embedded white-label widgets', () => {
  it('detects DigitalRecruiters and configs it with the page host', () => {
    const html = '<script src="https://app.digitalrecruiters.com/widget.js"></script>';
    const d = detectFromHtml(html, 'https://careers.thekooples.com/fr/');
    expect(d?.type).toBe('DIGITALRECRUITERS');
    expect(d?.config.domainName).toBe('careers.thekooples.com');
  });

  it('detects a WTTJ/Welcomekit link on a brand page and keeps the slug', () => {
    const html = '<a href="https://www.welcometothejungle.com/fr/companies/balzac-paris">Nous rejoindre</a>';
    const d = detectFromHtml(html, 'https://www.balzac-paris.fr/');
    expect(d?.type).toBe('WTTJ');
    expect(d?.config.slug).toBe('balzac-paris');
  });

  it('detects Factorial as a generic careers page (no adapter yet, review queue)', () => {
    const html = '<iframe src="https://jimmyfairly.factorial.fr/#jobs"></iframe>';
    const d = detectFromHtml(html, 'https://www.jimmyfairly.com/');
    expect(d?.type).toBe('GENERIC_JSONLD');
  });

  it('returns null for a page with no ATS signal at all', () => {
    const d = detectFromHtml('<html><body>Hello</body></html>', 'https://example.com/');
    expect(d).toBeNull();
  });
});
