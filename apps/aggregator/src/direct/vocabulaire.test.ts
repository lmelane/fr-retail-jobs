import { describe, expect, it } from 'vitest';
import { CORRESPONDANCE_DIRECTE_VERSION, EMPLOYEUR_CATWALKS, codesSecteur, dimensionsEmploi, employeurAffiche, libellesUnivers } from './vocabulaire.js';

/** Chaque valeur du backend ÉTABLIT une dimension et une seule ; l'inconnu reste nul (lot 6, même discipline que D-421). */
describe('correspondance des vocabulaires directs', () => {
  it('est versionnée : la version 3 indexe l’univers comme mot de secteur, et le stock resté en version antérieure est re-projeté', () => {
    expect(CORRESPONDANCE_DIRECTE_VERSION).toBe(3);
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

  it('D-455 §1 : l’univers se lit en mots de secteur, dans l’ordre reçu ; une valeur inconnue ne donne aucun mot', () => {
    expect(libellesUnivers(['MODE', 'LUXE'])).toEqual(['Mode', 'Luxe']);
    expect(libellesUnivers(['BEAUTE'])).toEqual(['Beauté']);
    expect(libellesUnivers(['LUXE', 'INCONNU'])).toEqual(['Luxe']);
    expect(libellesUnivers([])).toEqual([]);
  });

  it('D-455 §1 : l’employeur affiché est la Maison publique, sinon « Catwalks » — jamais l’univers ni « Maison confidentielle »', () => {
    expect(EMPLOYEUR_CATWALKS).toBe('Catwalks');
    expect(employeurAffiche({ nom: 'Dior' })).toBe('Dior');
    expect(employeurAffiche(null)).toBe('Catwalks');
    // Un nom vide, que le contrat laisse passer, ne nomme pas une Maison.
    for (const vide of ['', '   ']) expect(employeurAffiche({ nom: vide }), JSON.stringify(vide)).toBe('Catwalks');
  });
});
