import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAltamiraDetail, type AltamiraRow } from './altamira.js';
import { recoverRetainedPublication } from '../../publication/recovery.js';

/*
 * Pages réelles de careers.zegnagroup.com, corps archivés par la collecte du 29/09/2026 (lot 7e96ccce) : la fiche
 * 275749301, sans aucun JobPosting JSON-LD (une des 4 refusées DETAIL_EVIDENCE_UNUSABLE ce jour-là), et la fiche
 * 276488895, qui en porte un. Leur sha256 est l'empreinte retenue par le collecteur. Les deux `…-sortie-20260929.json`
 * sont les octets de sortie enregistrés par la production pour ces deux fiches (empreintes du manifeste).
 */
const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const origin = 'https://careers.zegnagroup.com';
const sans = { html: fixture('altamira-zegna-275749301-sans-jsonld.html'), recorded: fixture('altamira-zegna-275749301-sortie-20260929.json'),
  url: `${origin}/jobs/job-details?JobID=275749301&Team=231361273` };
const avec = { html: fixture('altamira-zegna-276488895-jsonld.html'), recorded: fixture('altamira-zegna-276488895-sortie-20260929.json'),
  url: `${origin}/jobs/job-details?JobID=276488895&Team=231361272` };
/** La ligne de liste telle que le collecteur l'a lue : son titre et son lieu sont ceux de la sortie enregistrée. */
const rowOf = (page: typeof sans): AltamiraRow => {
  const job = JSON.parse(page.recorded);
  return { externalId: job.externalId, team: new URL(page.url).searchParams.get('Team')!, title: job.title, location: job.location };
};
/** Le RAW tel que le stockage le rend. */
const stored = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const recover = (raw: unknown, url = sans.url, config: Record<string, unknown> = { origin }) =>
  recoverRetainedPublication('altamira', raw, { externalId: new URL(url).searchParams.get('JobID')!, url, observedAt: new Date('2026-09-29T16:30:02Z'), config });

describe('Altamira : une fiche sans JobPosting se relit sur ses cellules retenues (Zegna, 29/09/2026)', () => {
  it('prémisse : ce sont les pages et les sorties de la collecte, et la sortie enregistrée est bien refusée', () => {
    expect(sha256(sans.html)).toBe('7a95ddee13ac3c8aa3bb86194dfcd379c305f4e32196e6cf806d7aa2f4529606');
    expect(sha256(avec.html)).toBe('edd16c1df3736b12041d133b578ea4bf9fbf3f4812ffb3b168c79e78b255e4dd');
    expect(sha256(sans.recorded)).toBe('adfe57c1ec68e67ff311200ac15c6ac2caaa3a3a8fbb452687b91cc673fe1c6d');
    expect(sha256(avec.recorded)).toBe('164a39aaeb354e85ff09d8a93c166c0a4ce2af5b079d3f3d05b5de0803b576c9');
    expect(sans.html).not.toMatch(/application\/ld\+json/i);
    expect(avec.html).toMatch(/application\/ld\+json/i);
    // Le défaut de production : la page n'a aucun JobPosting, le RAW enregistré est refusé alors que la description existe.
    const recorded = JSON.parse(sans.recorded);
    expect(recorded.raw.postingEvidence).toMatchObject({ jobPostingCount: 0, jobPosting: null, htmlSha256: sha256(sans.html) });
    expect(recorded.description.length).toBeGreaterThan(1000);
    expect(recover(recorded.raw)).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'DETAIL_EVIDENCE_UNUSABLE' });
  });

  it('la fiche sans JobPosting est récupérable depuis son seul RAW, avec le contenu du collecteur', () => {
    const job = parseAltamiraDetail(rowOf(sans), sans.html, sans.url);
    const raw = stored(job.raw) as Record<string, any>;
    expect(raw.altamiraDetail).toMatchObject({ pageUrl: sans.url, htmlSha256: sha256(sans.html) });
    expect(raw.altamiraDetail.htmlSha256).toBe(raw.postingEvidence.htmlSha256);
    const recovered = recover(raw);
    expect(recovered.status).toBe('RECOVERABLE');
    if (recovered.status !== 'RECOVERABLE') return;
    for (const field of ['title', 'description', 'company', 'country', 'city', 'contract', 'department', 'url'] as const)
      expect(recovered.job[field]).toBe(job[field]);
    expect(recovered.job.company).toBe('Zegna');
  });

  it('la sortie du collecteur ne change que par les cellules retenues', () => {
    const job = stored(parseAltamiraDetail(rowOf(sans), sans.html, sans.url));
    delete (job.raw as Record<string, unknown>).altamiraDetail;
    expect(JSON.stringify(job)).toBe(sans.recorded);
  });

  it('rien ne change pour une fiche qui porte un JobPosting : sortie identique à la production, relue sur son JSON-LD', () => {
    const job = parseAltamiraDetail(rowOf(avec), avec.html, avec.url);
    expect(JSON.stringify(job)).toBe(avec.recorded);
    expect(job.raw).not.toHaveProperty('altamiraDetail');
    expect(recover(stored(job.raw), avec.url)).toMatchObject({ status: 'RECOVERABLE', job: { description: job.description } });
    // Des cellules greffées sur un RAW qui porte un JobPosting ne sont jamais relues : le collecteur n'en produit pas.
    const grafted = { ...stored(job.raw) as Record<string, any> };
    grafted.altamiraDetail = { ...stored(parseAltamiraDetail(rowOf(sans), sans.html, sans.url).raw as Record<string, any>).altamiraDetail,
      pageUrl: avec.url, htmlSha256: grafted.postingEvidence.htmlSha256 };
    expect(recover(grafted, avec.url)).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'DETAIL_EVIDENCE_UNUSABLE' });
  });

  it('des cellules détachées de leur page, de leur preuve ou de leur offre ne sont jamais relues', () => {
    const raw = stored(parseAltamiraDetail(rowOf(sans), sans.html, sans.url).raw) as Record<string, any>;
    const cells = raw.altamiraDetail, evidence = raw.postingEvidence;
    const other = sans.url.replace('275749301', '275749302');
    for (const tampered of [
      { altamiraDetail: { ...cells, htmlSha256: '0'.repeat(64) } },
      { altamiraDetail: { ...cells, pageUrl: other } },
      { altamiraDetail: { ...cells, description: 42 } },
      { altamiraDetail: { ...cells, locations: 'Italy/Milano' } },
      { altamiraDetail: 'cellules' },
      { postingEvidence: { ...evidence, jobPostingCount: 1 } },
      { postingEvidence: { ...evidence, jobPosting: { '@type': 'JobPosting', title: 'Autre' } } },
      { postingEvidence: { ...evidence, geographyConflict: true } },
      { source: 'icims' },
    ]) expect(recover({ ...raw, ...tampered })).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'DETAIL_EVIDENCE_UNUSABLE' });
    // Page et cellules déplacées ENSEMBLE sur une autre offre : l'identité de la page ne correspond plus.
    expect(recover({ ...raw, postingEvidence: { ...evidence, pageUrl: other }, altamiraDetail: { ...cells, pageUrl: other } }))
      .toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'DETAIL_IDENTITY_MISMATCH' });
    expect(recover({ ...raw, team: '231361272' })).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'DETAIL_IDENTITY_MISMATCH' });
    expect(recover(raw, sans.url, { origin: 'https://careers.example' })).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'DETAIL_IDENTITY_MISMATCH' });
  });

  it('une fiche en échec ne retient rien, une page sans cellule ne devient jamais récupérable', () => {
    const failed = parseAltamiraDetail(rowOf(sans), '', sans.url);
    expect(failed.raw).not.toHaveProperty('altamiraDetail');
    expect(recover(stored(failed.raw))).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'DETAIL_EVIDENCE_UNUSABLE' });
    const blank = parseAltamiraDetail(rowOf(sans), '<html><body>Pagina non trovata</body></html>', sans.url);
    expect(blank.raw).toHaveProperty('altamiraDetail');
    expect(recover(stored(blank.raw)).status).toBe('RECOLLECT_OR_REVIEW');
  });
});
