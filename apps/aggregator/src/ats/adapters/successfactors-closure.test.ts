import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { applySuccessFactorsDetail, parseMicrodataDetail, retainedSuccessFactorsDetail } from './successfactors.js';
import { publicationDisposition } from '../../pipeline/publicationDisposition.js';

const observedAt = new Date('2026-09-24T06:59:00Z');
// Native RMK block shared by Rocher 1434408933 and Puig 1418803133, RAW audit.
const closed = '<div class="content"><div class="jobTitle"></div><div class="job"><p><strong>Désolé, ce poste est déjà pourvu.</strong></p></div></div>';
const job = { externalId: '1434408933', title: 'Responsable Secteur', url: 'https://careers.groupe-rocher.com/job/Rennes/1434408933/', raw: {} };

describe('native SAP closure, including HTTP 200', () => {
  it('uses the existing closure path, with the original observation time on replay', () => {
    const detail = parseMicrodataDetail(closed, observedAt);
    const live = applySuccessFactorsDetail(job, detail);
    const replay = applySuccessFactorsDetail(job, JSON.parse(JSON.stringify(retainedSuccessFactorsDetail(detail))));
    expect(live).toEqual(replay);
    expect(live).toMatchObject({ publicationHold: 'APPLICATION_EXPLICITLY_CLOSED', publicationWithdrawnAt: observedAt });
    expect(publicationDisposition(live.publicationHold!)).toEqual({ kind: 'CLOSED' });
    expect(live.company).toBeUndefined();
  });
  it('never closes on a menu, quoted text, an unreadable page or conflicting live job content', () => {
    for (const html of ['<nav>Désolé, ce poste est déjà pourvu.</nav>', '<p>Unavailable</p>', '',
      '<div class="content"><div class="job"><p>Que signifie « Désolé, ce poste est déjà pourvu. » ?</p></div></div>',
      closed + '<div itemprop="description">We are hiring.</div>']) {
      expect(applySuccessFactorsDetail(job, parseMicrodataDetail(html, observedAt)).publicationHold).toBeUndefined();
    }
  });
  it('closes on the English native page too — Crocs 1412948000, RUN of 29/09/2026 (real page)', () => {
    const html = readFileSync(new URL('./__fixtures__/successfactors-crocs-closed-20260929.html', import.meta.url), 'utf8');
    const crocs = { externalId: '1412948000', title: 'Team Lead, Sales Part Time', url: 'https://careers.crocs.com/job/Destin-Team-Lead%2C-Sales-Part-Time-FL-32550/1412948000/', raw: {} };
    const detail = parseMicrodataDetail(html, observedAt);
    expect(detail.closure?.message).toBe('Sorry, this position has been filled.');
    expect(applySuccessFactorsDetail(crocs, detail)).toMatchObject({ publicationHold: 'APPLICATION_EXPLICITLY_CLOSED', publicationWithdrawnAt: observedAt });
    const replay = applySuccessFactorsDetail(crocs, JSON.parse(JSON.stringify(retainedSuccessFactorsDetail(detail))));
    expect(replay.publicationHold).toBe('APPLICATION_EXPLICITLY_CLOSED');
  });
  /*
   * Pages réelles, corps archivés en production (le SHA-256 du fichier est la clé du RawBlob). Sephora : six à sept
   * pages « pourvues » par jour aux États-Unis et au Canada, lues sans description ni employeur jusqu'au 30/09 —
   * CONTENT_MISSING au-delà de la tolérance (5), source refusée les 28 et 29/09, et 4 à 5 refus d'identité par jour
   * avant. Aptar : le même message dans l'autre gabarit natif, sans bloc `.content`, le titre de l'offre conservé.
   */
  const page = (name: string) => gunzipSync(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url))).toString('utf8');
  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
  it('closes on Sephora\'s English native page — 1362619755, refused on 28/09 and 29/09 (real page)', () => {
    const html = page('successfactors-sephora-1362619755-pourvue-20260929.html.gz');
    expect(sha256(html)).toBe('38867b6d990653616a595b510b5256e7e5306ffbdef905b22990d480aa8511c9');
    const sephora = { externalId: '1362619755', title: 'Beauty Advisor - Part Time', url: 'https://jobs.sephora.com/USA/job/Sunrise-Beauty-Advisor-Part-Time-FL-33304/1362619755/', raw: {} };
    const detail = parseMicrodataDetail(html, observedAt);
    expect(detail.closure?.message).toBe('Sorry, this position has been filled.');
    const live = applySuccessFactorsDetail(sephora, detail);
    expect(live).toMatchObject({ publicationHold: 'APPLICATION_EXPLICITLY_CLOSED', publicationWithdrawnAt: observedAt });
    expect(applySuccessFactorsDetail(sephora, JSON.parse(JSON.stringify(retainedSuccessFactorsDetail(detail))))).toEqual(live);
  });
  it('closes when the page keeps the posting\'s title — Aptar 1418020933, 25/09/2026 (real page)', () => {
    const html = page('successfactors-aptar-1418020933-pourvue-20260925.html.gz');
    expect(sha256(html)).toBe('5dbfcd6a0098f92635daa4c7ce586f77014ca359b5e22448adca20e8686063a2');
    // Prémisse : le bloc est le message natif entier, sans description, mais la page nomme l'offre (`itemprop="title"`).
    const $ = cheerio.load(html);
    expect($('.content .job')).toHaveLength(1);
    expect($('.content .job').text().replace(/\s+/g, ' ').trim()).toBe('Sorry, this position has been filled.');
    expect($('[itemprop="description"]')).toHaveLength(0);
    expect($('[itemprop="title"]').text().trim()).toBe('Production Supervisor -2nd Shift (51542)');
    const aptar = { externalId: '1418020933', title: 'Production Supervisor -2nd Shift (51542)', url: 'https://jobs.aptar.com/job/Cary-Production-Supervisor-2nd-Shift-%2851542%29-IL-60013/1418020933/', raw: {} };
    const detail = parseMicrodataDetail(html, observedAt);
    expect(detail.closure?.message).toBe('Sorry, this position has been filled.');
    expect(applySuccessFactorsDetail(aptar, detail)).toMatchObject({ publicationHold: 'APPLICATION_EXPLICITLY_CLOSED', publicationWithdrawnAt: observedAt });
  });
  it('never closes an open titled page, nor a titled page whose block quotes the message or carries a description', () => {
    const open = page('successfactors-aptar-1431204133-ouverte-20260925.html.gz');
    expect(sha256(open)).toBe('e15ac41138f331608bdbb89465a0a295a6255e1d6c29728083cfd286147e645c');
    const read = parseMicrodataDetail(open, observedAt);
    expect(read.closure).toBeUndefined();
    expect(read.title).toBe('Inside Sales Representative Rx');
    expect(read.description?.length).toBeGreaterThan(200);
    const titled = (block: string) => `<div class="content"><h1 itemprop="title">Sales Associate</h1>${block}</div>`;
    for (const html of [
      titled('<div class="job"><span itemprop="description"><p>Sorry, this position has been filled.</p></span></div>'),
      titled('<div class="job"><p>Sorry, this position has been filled.</p></div><div class="job"><p>Sorry, this position has been filled.</p></div>'),
      titled('<div class="job"><p>Sorry, this position has been filled. Apply to another one.</p></div>'),
      titled('<div class="job"><p>Sorry, this position has been filled.</p></div>') + '<div itemprop="description">We are hiring.</div>']) {
      expect(parseMicrodataDetail(html, observedAt).closure).toBeUndefined();
    }
  });
  it('rejects invalid retained closure evidence', () => {
    expect(() => applySuccessFactorsDetail(job, { closure: { message: 'Unknown', observedAt: observedAt.toISOString() } })).toThrow();
    expect(() => applySuccessFactorsDetail(job, { closure: { message: 'Désolé, ce poste est déjà pourvu.', observedAt: 'invalid' } })).toThrow();
  });
});
