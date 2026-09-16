import { describe, expect, it } from 'vitest';
import { EMPLOYMENT_LABELS, LANGUES_LIBELLES, employmentLabel, langueDesLibelles } from '@catwalks/db/presentation';
import { MARCHES } from '@catwalks/db/marches';
import { languageLabel } from '../projection';
import { langueDesLibellesDuPays, perimetreServi } from '../jobs';
import { resoudrePerimetre } from '../perimetre';

/**
 * LOT 8 — la langue des libellés d'emploi, de pays et de langue est celle du
 * marché servi quand un catalogue existe, sinon le français, NOMMÉMENT.
 * Aucun libellé natif n'est inventé pour un marché sans catalogue.
 */
describe('la langue des libellés (lot 8)', () => {
  it('PRÉMISSE — deux catalogues existent et divergent ; chaque valeur française a son anglais', () => {
    expect(LANGUES_LIBELLES).toEqual(['fr', 'en']);
    for (const dimension of Object.keys(EMPLOYMENT_LABELS.fr) as Array<keyof typeof EMPLOYMENT_LABELS.fr>) {
      expect(Object.keys(EMPLOYMENT_LABELS.en[dimension]).sort(), dimension).toEqual(Object.keys(EMPLOYMENT_LABELS.fr[dimension]).sort());
    }
    expect(EMPLOYMENT_LABELS.en.employmentTerm.PERMANENT).not.toBe(EMPLOYMENT_LABELS.fr.employmentTerm.PERMANENT);
  });

  it('une étiquette BCP 47 mène à son catalogue ; une langue sans catalogue retombe sur le français', () => {
    expect(langueDesLibelles('en-US')).toBe('en');
    expect(langueDesLibelles('en-GB')).toBe('en');
    expect(langueDesLibelles('fr-CA')).toBe('fr');
    expect(langueDesLibelles('de-DE')).toBe('fr');
    expect(langueDesLibelles('zh-CN')).toBe('fr');
    expect(langueDesLibelles(undefined)).toBe('fr');
    expect(langueDesLibelles('EN')).toBe('en');
  });

  it('le libellé suit la langue demandée, avec repli français valeur par valeur', () => {
    expect(employmentLabel('employmentTerm', 'PERMANENT', 'en')).toBe('Permanent');
    expect(employmentLabel('employmentTerm', 'PERMANENT')).toBe('CDI');
    expect(employmentLabel('workTime', 'PART_TIME', 'en')).toBe('Part-time');
    expect(employmentLabel('workplaceType', 'REMOTE', 'en')).toBe('Remote');
    expect(employmentLabel('workTime', null, 'en')).toBeNull();
    expect(employmentLabel('workTime', 'INCONNU', 'en')).toBe('Valeur à vérifier');
  });

  it('chaque marché du registre sait dans quelle langue il est libellé : anglophones en anglais, francophones en français, les autres en français nommément', () => {
    const attendu: Record<string, 'fr' | 'en'> = { US: 'en', GB: 'en', AU: 'en', CA: 'en', FR: 'fr', BE: 'fr', CH: 'fr', DE: 'fr', IT: 'fr', ES: 'fr', NL: 'fr', CN: 'fr' };
    for (const [code, langue] of Object.entries(attendu)) {
      expect(perimetreServi(resoudrePerimetre(code)!).langueDesLibelles, code).toBe(langue);
      // Prémisse pour DE/IT/ES/NL/CN : leur langue de service n'a pas de catalogue.
      if (langue === 'fr' && !['FR', 'BE', 'CH'].includes(code)) expect(MARCHES[code as keyof typeof MARCHES].localeParDefaut.startsWith('fr')).toBe(false);
    }
    // Un pays servi seul, sans marché mesuré : français.
    expect(perimetreServi(resoudrePerimetre('JP')!).langueDesLibelles).toBe('fr');
  });

  it('une offre lue seule suit le marché de son pays : Autriche → DE → français, Irlande → GB → anglais', () => {
    expect(langueDesLibellesDuPays('US')).toBe('en');
    expect(langueDesLibellesDuPays('IE')).toBe('en');
    expect(langueDesLibellesDuPays('AT')).toBe('fr');
    expect(langueDesLibellesDuPays('FR')).toBe('fr');
    expect(langueDesLibellesDuPays(null)).toBe('fr');
  });

  it('les noms de langue suivent aussi la langue des libellés', () => {
    expect(languageLabel('fr')).toBe('Français');
    expect(languageLabel('fr', 'en')).toBe('French');
    expect(languageLabel('zz', 'en')).toBe('zz');
  });
});
