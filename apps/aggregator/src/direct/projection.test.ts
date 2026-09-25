import { describe, expect, it } from 'vitest';
import { lireOffre } from './contrat.js';
import { contexteTemoin, offreBrute } from './fixture.js';
import { colonnesProjetees, descriptionServie, hashPayload, projeterOffreDirecte, texteRecherche } from './projection.js';
import { CORRESPONDANCE_DIRECTE_VERSION } from './vocabulaire.js';

/** La projection reconstruit toutes les colonnes depuis le contrat reçu, à chaque version (lot 6). */
describe('projection d’une offre directe', () => {
  const offre = lireOffre(offreBrute());
  const contexte = contexteTemoin({ maisons: { 'Maison Témoin Directe': 'societe-temoin' }, metiers: { 'Visual Merchandiser': 'visual-merchandiser' } });

  it('projette les colonnes du vocabulaire commun et garde le contrat entier comme provenance', () => {
    const ligne = projeterOffreDirecte(offre, BigInt(12), BigInt(3), contexte);
    expect(ligne).toMatchObject({
      id: 'cmoffre0001', version: BigInt(3), appliedSeq: BigInt(12), eligible: true, correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION,
      slug: 'visual-merchandiser-paris', anciensSlugs: ['vm-paris'], title: 'Visual Merchandiser', company: 'Maison Témoin Directe', maisonSlug: 'maison-temoin-directe',
      countryCode: 'FR', city: 'Paris', postalCode: '75008', location: 'Paris 8e, France', latitude: 48.87, longitude: 2.31,
      employmentTerm: 'PERMANENT', workTime: 'FULL_TIME', programType: null, engagementType: null, workplaceType: 'HYBRID',
      sectorCodes: ['FASHION', 'LEATHER_GOODS'], occupationLabel: 'Visual Merchandiser', language: 'fr',
      salaryCurrency: 'EUR', salaryPeriod: 'YEAR', visuel: 'https://media.example.com/visuel.jpg',
      applyUrl: 'https://catwalks.io/offres/visual-merchandiser-paris', validThrough: null,
      // D-444 : la Maison rattachée au registre, le métier de la taxonomie active, l'empreinte des colonnes projetées.
      companyId: 'societe-temoin', occupationCode: 'visual-merchandiser', occupationReleaseId: 'release-temoin',
    });
    expect(ligne.projectionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ligne.salaryMin?.toString()).toBe('38000');
    expect(ligne.salaryMax?.toString()).toBe('45000');
    expect(ligne.postedAt.toISOString()).toBe('2026-09-10T08:00:00.000Z');
    expect(ligne.modifiedAt.toISOString()).toBe('2026-09-11T09:30:00.000Z');
    expect(ligne.payload).toEqual(offre);
    expect(ligne.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('la description sert les sections rédactionnelles dans l’ordre de la fiche ; le texte indexé porte intitulé, Maison, métier, univers, lieu', () => {
    const brute = offreBrute().description as Record<string, string>;
    expect(descriptionServie(offre)).toBe([brute.marque, brute.poste, brute.missions, brute.profil, brute.avantages].join('\n\n'));
    const sansAvantages = lireOffre(offreBrute({ description: { marque: null, poste: 'P', missions: 'M', profil: 'R', avantages: '  ' } }));
    expect(descriptionServie(sansAvantages)).toBe('P\n\nM\n\nR');
    expect(texteRecherche(offre).split('\n')).toEqual([
      'Visual Merchandiser', 'Maison Témoin Directe', 'Visual Merchandiser', 'Mode, Luxe', 'Paris 8e, France', 'Paris', '75008', brute.poste, brute.missions, brute.profil,
    ]);
  });

  it('D-455 §1 : une offre sans Maison publique a « Catwalks » pour employeur ; son univers reste un mot de secteur indexé ; un salaire sans borne ne porte ni devise ni période', () => {
    const confidentielle = lireOffre(offreBrute({ maison: null, salaire: { min: null, max: null, devise: 'EUR', texte: 'Selon profil' }, finLe: '2026-12-31T00:00:00.000Z' }));
    // PRÉMISSE : l'offre n'a pas de Maison publique et porte des univers, ceux que la version 1 affichait (« Mode, Luxe »).
    expect(confidentielle.maison).toBeNull();
    expect(confidentielle.univers).toEqual(['MODE', 'LUXE']);
    const ligne = projeterOffreDirecte(confidentielle, BigInt(1), BigInt(1), contexte);
    expect(ligne.company).toBe('Catwalks');
    expect(ligne.maisonSlug).toBeNull();
    const lignes = ligne.searchText.split('\n');
    expect(lignes[1]).toBe('Catwalks');
    // L'univers reste cherchable (« luxe ») : sur sa propre ligne, après le métier, jamais à la place de l'employeur.
    expect(lignes[3]).toBe('Mode, Luxe');
    expect(lignes.filter((l) => l === 'Mode, Luxe')).toHaveLength(1);
    expect(ligne.searchText).not.toContain('Maison confidentielle');
    // Sans univers, la version 1 écrivait « Maison confidentielle » : la retombée reste « Catwalks ».
    expect(projeterOffreDirecte(lireOffre(offreBrute({ maison: null, univers: [] })), BigInt(1), BigInt(1), contexte).company).toBe('Catwalks');
    expect(ligne).toMatchObject({ salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null });
    expect(ligne.validThrough?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });

  it('D-455 §1 : une offre avec une Maison publique l’affiche comme employeur, dans la ligne et dans le texte indexé', () => {
    const dior = projeterOffreDirecte(lireOffre(offreBrute({ maison: { nom: 'Dior', slug: 'dior' } })), BigInt(1), BigInt(1), contexte);
    expect(dior).toMatchObject({ company: 'Dior', maisonSlug: 'dior' });
    expect(dior.searchText.split('\n')[1]).toBe('Dior');
    // L'univers est un mot de secteur de l'offre, Maison publique ou non.
    expect(dior.searchText.split('\n')[3]).toBe('Mode, Luxe');
  });

  it('la re-projection reconstruit les seules colonnes dérivées : ni identité, ni état, ni provenance', () => {
    const colonnes = colonnesProjetees(offre, contexte);
    for (const cle of ['id', 'version', 'appliedSeq', 'eligible', 'payload', 'payloadHash']) expect(colonnes, cle).not.toHaveProperty(cle);
    // Une projection complète est exactement l'identité, l'état et la provenance, plus ces colonnes.
    expect(projeterOffreDirecte(offre, BigInt(12), BigInt(3), contexte)).toEqual({ id: offre.id, version: BigInt(3), appliedSeq: BigInt(12), eligible: true,
      payloadHash: hashPayload(offre), payload: offre, ...colonnes });
  });

  it('le hachage est stable pour un même contrat et change dès qu’un champ change', () => {
    expect(hashPayload(offre)).toBe(hashPayload(lireOffre(offreBrute())));
    expect(hashPayload(lireOffre(offreBrute({ titre: 'Visual Merchandiser Senior' })))).not.toBe(hashPayload(offre));
  });
});
