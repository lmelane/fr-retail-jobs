import { describe, expect, it } from 'vitest';
import { lireOffre } from './contrat.js';
import { offreBrute } from './fixture.js';
import { descriptionServie, hashPayload, projeterOffreDirecte, texteRecherche } from './projection.js';

/** La projection reconstruit toutes les colonnes depuis le contrat reçu, à chaque version (lot 6). */
describe('projection d’une offre directe', () => {
  const offre = lireOffre(offreBrute());

  it('projette les colonnes du vocabulaire commun et garde le contrat entier comme provenance', () => {
    const ligne = projeterOffreDirecte(offre, BigInt(12), BigInt(3));
    expect(ligne).toMatchObject({
      id: 'cmoffre0001', version: BigInt(3), appliedSeq: BigInt(12), eligible: true, correspondanceVersion: 1,
      slug: 'visual-merchandiser-paris', anciensSlugs: ['vm-paris'], title: 'Visual Merchandiser', company: 'Maison Témoin Directe', maisonSlug: 'maison-temoin-directe',
      countryCode: 'FR', city: 'Paris', postalCode: '75008', location: 'Paris 8e, France', latitude: 48.87, longitude: 2.31,
      employmentTerm: 'PERMANENT', workTime: 'FULL_TIME', programType: null, engagementType: null, workplaceType: 'HYBRID',
      sectorCodes: ['FASHION', 'LEATHER_GOODS'], occupationLabel: 'Visual Merchandiser', language: 'fr',
      salaryCurrency: 'EUR', salaryPeriod: 'YEAR', visuel: 'https://media.example.com/visuel.jpg',
      applyUrl: 'https://catwalks.io/offres/visual-merchandiser-paris', validThrough: null,
    });
    expect(ligne.salaryMin?.toString()).toBe('38000');
    expect(ligne.salaryMax?.toString()).toBe('45000');
    expect(ligne.postedAt.toISOString()).toBe('2026-09-10T08:00:00.000Z');
    expect(ligne.modifiedAt.toISOString()).toBe('2026-09-11T09:30:00.000Z');
    expect(ligne.payload).toEqual(offre);
    expect(ligne.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('la description sert les sections rédactionnelles dans l’ordre de la fiche ; le texte indexé porte intitulé, Maison, métier, lieu', () => {
    const brute = offreBrute().description as Record<string, string>;
    expect(descriptionServie(offre)).toBe([brute.marque, brute.poste, brute.missions, brute.profil, brute.avantages].join('\n\n'));
    const sansAvantages = lireOffre(offreBrute({ description: { marque: null, poste: 'P', missions: 'M', profil: 'R', avantages: '  ' } }));
    expect(descriptionServie(sansAvantages)).toBe('P\n\nM\n\nR');
    const texte = texteRecherche(offre);
    for (const attendu of ['Visual Merchandiser', 'Maison Témoin Directe', 'Paris 8e, France', '75008', 'Vous concevez les vitrines']) expect(texte).toContain(attendu);
  });

  it('une Maison confidentielle est nommée par ses univers ; un salaire sans borne ne porte ni devise ni période', () => {
    const confidentielle = lireOffre(offreBrute({ maison: null, salaire: { min: null, max: null, devise: 'EUR', texte: 'Selon profil' }, finLe: '2026-12-31T00:00:00.000Z' }));
    const ligne = projeterOffreDirecte(confidentielle, BigInt(1), BigInt(1));
    expect(ligne.company).toBe('Mode, Luxe');
    expect(ligne.maisonSlug).toBeNull();
    expect(ligne).toMatchObject({ salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null });
    expect(ligne.validThrough?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });

  it('le hachage est stable pour un même contrat et change dès qu’un champ change', () => {
    expect(hashPayload(offre)).toBe(hashPayload(lireOffre(offreBrute())));
    expect(hashPayload(lireOffre(offreBrute({ titre: 'Visual Merchandiser Senior' })))).not.toBe(hashPayload(offre));
  });
});
