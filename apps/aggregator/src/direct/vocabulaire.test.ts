import { describe, expect, it } from 'vitest';
import { CORRESPONDANCE_DIRECTE_VERSION, codesSecteur, dimensionsEmploi, nomUnivers } from './vocabulaire.js';

/** Chaque valeur du backend ÉTABLIT une dimension et une seule ; l'inconnu reste nul (lot 6, même discipline que D-421). */
describe('correspondance des vocabulaires directs', () => {
  it('est versionnée', () => {
    expect(CORRESPONDANCE_DIRECTE_VERSION).toBe(1);
  });

  it('un contrat établit la durée, OU le programme, OU la nature — jamais deux à la fois', () => {
    expect(dimensionsEmploi('CDI', 'TEMPS_PLEIN', null)).toEqual({ employmentTerm: 'PERMANENT', workTime: 'FULL_TIME', programType: null, engagementType: null, workplaceType: null });
    expect(dimensionsEmploi('CDD', 'TEMPS_PARTIEL', 'NONE')).toMatchObject({ employmentTerm: 'FIXED_TERM', workTime: 'PART_TIME', workplaceType: 'ONSITE' });
    expect(dimensionsEmploi('INTERIM', 'TEMPS_PLEIN', null)).toMatchObject({ employmentTerm: 'TEMPORARY' });
    expect(dimensionsEmploi('STAGE', 'TEMPS_PLEIN', null)).toMatchObject({ employmentTerm: null, programType: 'INTERNSHIP', engagementType: null });
    expect(dimensionsEmploi('ALTERNANCE', 'TEMPS_PLEIN', null)).toMatchObject({ employmentTerm: null, programType: 'APPRENTICESHIP' });
    expect(dimensionsEmploi('FREELANCE', 'TEMPS_PLEIN', null)).toMatchObject({ employmentTerm: null, programType: null, engagementType: 'FREELANCE' });
  });

  it('une valeur inconnue n’établit rien : nul, jamais deviné', () => {
    expect(dimensionsEmploi('PORTAGE', 'HORAIRES_LIBRES', 'PARFOIS')).toEqual({ employmentTerm: null, workTime: null, programType: null, engagementType: null, workplaceType: null });
  });

  it('le télétravail se projette sur le lieu de travail du catalogue', () => {
    expect(dimensionsEmploi('CDI', 'TEMPS_PLEIN', 'FULL').workplaceType).toBe('REMOTE');
    expect(dimensionsEmploi('CDI', 'TEMPS_PLEIN', 'FREQUENT').workplaceType).toBe('HYBRID');
    expect(dimensionsEmploi('CDI', 'TEMPS_PLEIN', 'OCCASIONAL').workplaceType).toBe('HYBRID');
    expect(dimensionsEmploi('CDI', 'TEMPS_PLEIN', 'NONE').workplaceType).toBe('ONSITE');
  });

  it('« Luxe » n’est pas un secteur : seule, elle ne code rien ; les doublons se fondent', () => {
    expect(codesSecteur(['LUXE'], [])).toEqual([]);
    expect(codesSecteur(['MODE', 'LUXE'], ['PRET_A_PORTER_ACCESSOIRES', 'MAROQUINERIE'])).toEqual(['FASHION', 'LEATHER_GOODS']);
    expect(codesSecteur(['BEAUTE'], ['SOINS', 'MAQUILLAGE', 'PARFUM'])).toEqual(['BEAUTY', 'FRAGRANCE']);
    expect(codesSecteur([], ['HORLOGERIE', 'BIJOUTERIE_JOAILLERIE', 'CHAUSSURE', 'INCONNU'])).toEqual(['WATCHMAKING', 'JEWELRY', 'FOOTWEAR']);
  });

  it('nomme une Maison confidentielle par ses univers, comme la page /offres', () => {
    expect(nomUnivers(['MODE', 'LUXE'])).toBe('Mode, Luxe');
    expect(nomUnivers(['BEAUTE'])).toBe('Beauté');
    expect(nomUnivers([])).toBe('Maison confidentielle');
    expect(nomUnivers(['AUTRE'])).toBe('Maison confidentielle');
  });
});
