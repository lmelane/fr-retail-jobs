import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { calibrate, classifyApplyPage, rateLimiter, readApplyPage, visibleText, type ProbeReading } from './applyLinkProbe.js';

/**
 * R-143 §2 — la sonde des liens « Postuler ». Témoins tirés de pages RÉELLES, lues le 02/10/2026 avec l'identité du
 * collecteur (`__fixtures__/apply-pages/manifest.json`). La sonde du matin en avait classé 12 « mortes », dont 6 à
 * tort : le texte d'erreur était dans le code de la page, pas affiché. Ces témoins gardent les deux sens.
 */
const page = (name: string) => gunzipSync(readFileSync(new URL(`./__fixtures__/apply-pages/${name}.html.gz`, import.meta.url))).toString('utf8');
const read = (name: string, status = 200) => classifyApplyPage({ status, finalUrl: `https://example.test/${name}`, contentType: 'text/html; charset=utf-8', body: page(name) });
const OPEN: ProbeReading = { verdict: 'OPEN', reason: 'OPEN' };

describe('une page ouverte dont le CODE porte un texte d’erreur reste ouverte', () => {
  // Chaque page contient, dans un script ou une chaîne de traduction, un motif que la sonde du matin prenait pour une fin.
  it.each([
    ['flatchr-adopt-ouverte', /closed/i],
    ['icims-footlocker-ouverte', /closed/i],
    ['smartrecruiters-hm-ouverte', /nicht mehr/i],
    ['lacoste-ouverte', /plus disponible/i],
    ['smartrecruiters-primark-ouverte', /nicht mehr/i],
    ['rituals-ouverte', /not found/i],
  ])('%s', (name, motif) => {
    // Prémisse : le motif est bien dans le code de la page, sinon le témoin ne teste rien.
    expect(page(name)).toMatch(motif);
    expect(visibleText(page(name))).not.toMatch(/no longer available|has expired|plus disponible|plus en ligne|has been filled/i);
    expect(read(name).verdict).toBe('OPEN');
  });
});

describe('une page qui AFFICHE la fin de l’offre est morte', () => {
  it.each([
    ['smartrecruiters-hm-expiree', 'offre a expiré'],
    ['smartrecruiters-primark-expiree', 'job has expired'],
    ['lacoste-hors-ligne', "n'est plus en ligne"],
    ['eqwa-nocibe-hors-ligne', "n'est plus en ligne"],
  ])('%s', (name, phrase) => {
    expect(read(name)).toMatchObject({ verdict: 'DEAD', reason: 'DEAD_TEXT_DISPLAYED', matched: phrase });
  });
  it('404 et 410 sont des fins', () => {
    expect(classifyApplyPage({ status: 404, finalUrl: 'u', contentType: 'text/html', body: '' }).verdict).toBe('DEAD');
    expect(classifyApplyPage({ status: 410, finalUrl: 'u', contentType: 'text/html', body: '' }).verdict).toBe('DEAD');
  });
});

describe('une erreur technique ne retire jamais rien', () => {
  it.each([403, 429, 500, 502, 503])('HTTP %i', status => {
    expect(classifyApplyPage({ status, finalUrl: 'u', contentType: 'text/html', body: page('smartrecruiters-hm-expiree') }).verdict).toBe('TECHNICAL');
  });
  it('une coquille d’application sans texte affiché n’est pas concluante', () => {
    const shell = '<html><head><title>Jobs</title></head><body><div id="root"></div><script>window.i18n={"NOT_FOUND":"This job is no longer available"}</script></body></html>';
    expect(classifyApplyPage({ status: 200, finalUrl: 'u', contentType: 'text/html', body: shell })).toMatchObject({ verdict: 'NON_CONCLUSIVE', reason: 'NO_VISIBLE_CONTENT' });
  });
  it('un délai dépassé, une panne de transport : TECHNICAL', async () => {
    const scopes = [{ origin: 'https://jobs.example.com', path: { kind: 'PREFIX' as const, value: '/offres/' }, methods: ['GET' as const],
      query: { fixed: {}, variable: [] }, surface: 'PUBLIC_HTML_PAGE' as never }];
    const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    expect(await readApplyPage('https://jobs.example.com/offres/1', scopes, async () => {}, async () => { throw timeout; }))
      .toMatchObject({ verdict: 'TECHNICAL', reason: 'TIMEOUT' });
    expect(await readApplyPage('https://jobs.example.com/offres/1', scopes, async () => {}, async () => { throw new TypeError('fetch failed'); }))
      .toMatchObject({ verdict: 'TECHNICAL' });
  });
  it('une adresse hors du périmètre d’accès revu n’est pas lue', async () => {
    let called = false;
    const reading = await readApplyPage('https://ailleurs.example.com/x', [], async () => {}, async () => { called = true; return new Response(''); });
    expect(reading).toMatchObject({ verdict: 'NON_CONCLUSIVE', reason: 'OUTSIDE_ACCESS_SCOPE' });
    expect(called).toBe(false);
  });
});

describe('le témoin vivant : un signal de mort qui touche aussi l’offre la plus fraîche de la source n’est pas une fin', () => {
  // Trois cas réels du 02/10 : la source LISTE encore ces offres (revues il y a moins de 24 h), et la page dit pourtant la fin.
  it('Sephora affiche « position has been filled » sur une offre que sa source liste', () => {
    const fresh = read('sephora-pourvue-affichee-sur-offre-listee');
    expect(fresh.verdict).toBe('DEAD');
    expect(calibrate(fresh, fresh).verdict).toBe('NON_CONCLUSIVE');
  });
  it('Ulta répond 404 à une offre listée ; URBN (iCIMS) 410', () => {
    const ulta = read('jibe-ulta-404-sur-offre-listee', 404), urbn = read('icims-urbn-410-sur-offre-listee', 410);
    expect(calibrate(ulta, ulta).verdict).toBe('NON_CONCLUSIVE');
    expect(calibrate(urbn, urbn).verdict).toBe('NON_CONCLUSIVE');
  });
  it('une fin ne tient qu’avec un témoin ouvert de la même source', () => {
    const dead = read('smartrecruiters-hm-expiree');
    expect(calibrate(dead, read('smartrecruiters-hm-ouverte')).verdict).toBe('DEAD');
    expect(calibrate(dead, null).verdict).toBe('NON_CONCLUSIVE');
    expect(calibrate(dead, { verdict: 'TECHNICAL', reason: 'HTTP_403' }).verdict).toBe('NON_CONCLUSIVE');
    expect(calibrate(OPEN, null)).toEqual(OPEN);
  });
});

describe('politesse', () => {
  it('au plus 2 départs par seconde, quel que soit le nombre d’appels', async () => {
    let clock = 0;
    const starts: number[] = [];
    const acquire = rateLimiter(2, () => clock, async ms => { clock += ms; });
    for (let i = 0; i < 6; i++) { await acquire(); starts.push(clock); }
    expect(starts).toEqual([0, 500, 1000, 1500, 2000, 2500]);
  });
});
