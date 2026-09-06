import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJobLocationBlock, parseSwatchJobPage, resolveBrand } from './swatchgroup.js';

/** Fiches capturées le 2026-09-06 (head/nav/footer retirés, contenu inchangé). */
const fixture = (id: string) => readFileSync(new URL(`./__fixtures__/swatchgroup-${id}.html`, import.meta.url), 'utf8');

describe('parseSwatchJobPage — 32916, « sans lieu » dans le JSON-LD (addressRegion vide, streetAddress = siège Miami)', () => {
  const job = parseSwatchJobPage(fixture('32916'), 'https://www.swatchgroup.com/en/job/32916')!;

  it('prend le lieu de travail dans #jl, jamais le siège de la filiale', () => {
    expect(job.location).toBe('NC 28211 Charlotte, United States');
    expect(job.city).toBe('Charlotte');
    expect(job.region).toBe('North Carolina');
    expect(job.postalCode).toBe('28211');
    expect(job.country).toBe('US');
    expect(job.location).not.toContain('Miami');
  });

  it('identifiant = numéro de l’URL, titre depuis le <h1>, date depuis le JSON-LD', () => {
    expect(job.externalId).toBe('32916');
    expect(job.title).toBe('Swatch Part Time Keyholder - SouthPark (NC)');
    expect(job.postedAt?.toISOString()).toBe('2026-08-26T14:39:10.000Z');
    expect(job.url).toBe('https://www.swatchgroup.com/en/job/32916');
  });

  it('marque = Swatch (logo brands-logos/swatch.png), entité légale conservée dans raw', () => {
    expect(job.company).toBe('Swatch');
    expect(job.group).toBe('Swatch Group');
    expect((job.raw as { legalEntity?: string }).legalEntity).toBe('The Swatch Group (U.S.) Inc.');
  });
});

describe('parseSwatchJobPage — 33044, « sans description » dans le JSON-LD (body = 199 caractères)', () => {
  const job = parseSwatchJobPage(fixture('33044'), 'https://www.swatchgroup.com/de/job/33044')!;

  it('concatène les cinq sections de la page dans l’ordre, titres de section sur leur ligne', () => {
    const d = job.description ?? '';
    expect(d.length).toBeGreaterThan(3000);
    const order = ['Firmenbeschreibung', 'Stellenbeschreibung', 'Dafür suchen wir Dich', 'Was Dich dafür auszeichnet', 'Damit Du Dich bei uns wohlfühlst'].map((s) => d.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(d).toMatch(/\n\s*Stellenbeschreibung\s*\n/);
    expect(d).not.toContain('<');
    // La personne de contact et l'adresse du siège ne font pas partie de l'annonce.
    expect(d).not.toContain('Kontaktperson');
    expect(d).not.toContain('Frankfurter Strasse 20');
  });

  it('lit le lieu en allemand (Arbeitsort) et déduit le pays ISO-2', () => {
    expect(job.location).toBe('40212 Frankfurt, Deutschland');
    expect(job.city).toBe('Frankfurt');
    expect(job.region).toBe('Nordrhein Westfalen');
    expect(job.country).toBe('DE');
    expect(job.language).toBe('de');
  });

  it('marque = Tissot par le logo, bien que hiringOrganization.name soit la filiale allemande', () => {
    expect(job.company).toBe('Tissot');
    expect((job.raw as { legalEntity?: string }).legalEntity).toBe('The Swatch Group (Deutschland) GmbH');
    expect(job.title).toBe('Verkaufsberater (all genders) Tissot Concession Düsseldorf & Köln');
  });
});

describe('parseSwatchJobPage — 33046, fiche normale (addressRegion rempli)', () => {
  const job = parseSwatchJobPage(fixture('33046'), 'https://www.swatchgroup.com/en/job/33046')!;

  it('#jl prime aussi sur addressRegion et apporte le pays absent du JSON-LD', () => {
    expect(job.location).toBe('37215 Nashville TN, United States');
    expect(job.city).toBe('Nashville');
    expect(job.region).toBe('Tennessee');
    expect(job.postalCode).toBe('37215');
    expect(job.country).toBe('US');
    expect(job.company).toBe('Swatch');
    expect((job.description ?? '').length).toBeGreaterThan(200);
    expect((job.raw as { applyUrl?: string }).applyUrl).toContain('lumessetalentlink.com');
  });

  it('rend null sans identifiant ni titre plutôt qu’une ligne vide', () => {
    expect(parseSwatchJobPage('<html></html>', 'https://www.swatchgroup.com/en/job-finder')).toBeNull();
  });
});

describe('parseJobLocationBlock', () => {
  it('lit un bloc à deux lignes (sans rue) et garde un pays inconnu tel quel', () => {
    const loc = parseJobLocationBlock('<div id="jl" class="mb-4"><p class="blue-bold mb-0">Job location</p> 2502 Biel/Bienne (Bern)<br /> Atlantide </div>');
    expect(loc).toEqual({ location: '2502 Biel/Bienne, Atlantide', city: 'Biel/Bienne', region: 'Bern', postalCode: '2502', country: 'Atlantide' });
  });

  it('gabarit à une ligne (f-n-field-job-work-address, 6 fiches sur 279) : lieu gardé, pays absent — jamais déduit du siège', () => {
    const loc = parseJobLocationBlock('<div id="jl" class="mb-4"> <p class="blue-bold mb-0">Job location</p> <div class="field f-n-field-job-work-address f-t-string">2000 Sydney</div> </div>');
    expect(loc).toEqual({ location: '2000 Sydney', city: 'Sydney', region: undefined, postalCode: '2000', country: undefined });
  });

  it('rend {} sans bloc #jl', () => {
    expect(parseJobLocationBlock('<div id="ca">siège</div>')).toEqual({});
  });
});

describe('resolveBrand', () => {
  it('logo d’abord, titre ensuite, groupe en dernier', () => {
    expect(resolveBrand('https://www.swatchgroup.com/sites/default/files/brands-logos/omega.png', 'Client Advisor')).toBe('Omega');
    expect(resolveBrand('https://www.swatchgroup.com/sites/default/files/brands-logos/glashutte-original.png', 'x')).toBe('Glashütte Original');
    expect(resolveBrand(undefined, 'E-Com Manager (all genders) Longines')).toBe('Longines');
    expect(resolveBrand('https://www.swatchgroup.com/sites/default/files/brands-logos/inconnu.png', 'Harry Winston Sales Associate')).toBe('Harry Winston');
    expect(resolveBrand(undefined, 'Horloger·ère de production')).toBe('Swatch Group');
    expect(resolveBrand(undefined, 'Swatch Group Services controller')).toBe('Swatch Group');
  });
});
