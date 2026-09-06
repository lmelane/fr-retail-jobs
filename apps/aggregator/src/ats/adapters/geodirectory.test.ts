import { describe, expect, it } from 'vitest';
import { normalizeGeoDirPost, type GeoDirPost } from './geodirectory.js';

/** Un post tel que /wp-json/geodir/v2/offres le sert chez Beauty Success (capturé le 2026-09-06, tronqué). */
const POST: GeoDirPost = {
  id: '1098563',
  link: 'https://recrutement.beautysuccess.fr/offres/conseiller-e-estheticien-ne-polyvalent-e-h-f-sarrebourg-1098563/',
  date: '2026-09-04T00:00:00',
  date_gmt: '2026-09-03T22:00:00',
  title: { rendered: 'CONSEILLER.E ESTHETICIEN.NE POLYVALENT.E H/F' },
  content: {
    rendered:
      '<p style="text-align: center;"><strong>VOTRE PARFUMERIE</strong></p><p>La parfumerie Beauty Success de Sarrebourg recrute un.e conseiller.e esthéticien.ne polyvalent.e en CDI, temps plein.</p>',
  },
  city: 'Sarrebourg',
  region: 'Grand Est',
  country: 'France',
  zip: '57400',
  latitude: '48.7356',
  longitude: '7.0572',
  type_de_contrat: { rendered: 'CDI' },
  temps_de_travail: { rendered: 'Temps plein' },
  description_de_lemployeur: '<p><strong>Chez Beauty Success</strong>, le métier de conseiller esthéticien est un métier de passion.</p>',
  profil_recherch: '<p>Vous êtes diplômé.e en esthétique (CAP, BP, Bac Pro).</p>',
};

describe('normalizeGeoDirPost', () => {
  it('lit identifiant, titre, lien, date et contrat', () => {
    const job = normalizeGeoDirPost(POST)!;
    expect(job.externalId).toBe('1098563');
    expect(job.title).toBe('CONSEILLER.E ESTHETICIEN.NE POLYVALENT.E H/F');
    expect(job.url).toContain('/offres/conseiller-e-estheticien-ne-polyvalent-e-h-f-sarrebourg-1098563/');
    expect(job.postedAt?.toISOString()).toBe('2026-09-03T22:00:00.000Z');
    expect(job.contract).toBe('CDI');
    expect(job.workingTime).toBe('Temps plein');
  });

  it('remonte le lieu structuré du plugin (ville, code postal, région, pays, coordonnées)', () => {
    const job = normalizeGeoDirPost(POST)!;
    expect(job.city).toBe('Sarrebourg');
    expect(job.postalCode).toBe('57400');
    expect(job.region).toBe('Grand Est');
    expect(job.country).toBe('France');
    expect(job.location).toBe('Sarrebourg, 57400, France');
    expect(job.latitude).toBeCloseTo(48.7356);
    expect(job.longitude).toBeCloseTo(7.0572);
  });

  it('assemble la description depuis les trois blocs, sans balises', () => {
    const job = normalizeGeoDirPost(POST)!;
    expect(job.description).toContain('Sarrebourg recrute');
    expect(job.description).toContain('métier de passion');
    expect(job.description).toContain('CAP, BP, Bac Pro');
    expect(job.description).not.toContain('<');
  });

  it('ignore un post sans lien plutôt que de produire une offre incliquable', () => {
    expect(normalizeGeoDirPost({ ...POST, link: undefined })).toBeNull();
  });

  it('laisse les coordonnées vides quand le plugin met 0', () => {
    const job = normalizeGeoDirPost({ ...POST, latitude: '0', longitude: '' })!;
    expect(job.latitude).toBeUndefined();
    expect(job.longitude).toBeUndefined();
  });
});
