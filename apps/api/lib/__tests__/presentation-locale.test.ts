import { LANGUES_LIBELLES, employmentLabel } from '@catwalks/db/presentation';
import { describe, expect, it } from 'vitest';
import { parseFilters } from '../jobs';
import { planifierRecherche } from '../search-plan';
import { resoudrePerimetre } from '../perimetre';
import { localeAffichage, nomFacette } from '../presentation-locale';
import { libelleConcept, libelleInconnu } from '../taxonomy-labels';
import catalogue from '../data/taxonomy-labels.json';
import manifest from '../../../../packages/db/data/occupations-v1.json';
import sectors from '../../../../packages/db/data/sectors-v1.json';

describe('locale de présentation indépendante des critères', () => {
  it('ne modifie ni le plan de recherche, ni le filtre sur la langue des annonces', () => {
    for (const code of ['CA','CH','BE']) {
      const p = resoudrePerimetre(code)!;
      const initial = parseFilters({ marche: code, q: 'sales', langue: 'en', temps: 'PART_TIME' });
      for (const locale of p.marche!.locales) {
        const f = parseFilters({ marche: code, q: 'sales', langue: 'en', temps: 'PART_TIME', locale });
        expect(f.filtres.langue).toEqual(['en']);
        expect(planifierRecherche(p, f)).toEqual(planifierRecherche(p, initial));
      }
    }
  });
  it('valide la locale sans transformer une valeur arbitraire en critère SQL', () => {
    const p=resoudrePerimetre('CA')!;
    expect(localeAffichage('fr-CA',p)).toBe('fr-CA');
    for (const invalid of ['zz','../fr','en;DROP TABLE Job','it','fr-FR','']) expect(localeAffichage(invalid,p)).toBe('en-CA');
  });
  it('le pays monolingue impose sa langue malgré une ancienne préférence', () => {
    expect(localeAffichage('fr', resoudrePerimetre('IT')!)).toBe('it-IT');
    expect(localeAffichage('it', resoudrePerimetre('FR')!)).toBe('fr-FR');
    expect(localeAffichage('fr', resoudrePerimetre('CA')!)).toBe('fr-CA');
    expect(localeAffichage('it', resoudrePerimetre('CH')!)).toBe('it-CH');
  });
  it('conserve les mots du marché canadien et sépare les langues belges', () => {
    const ca=resoudrePerimetre('CA')!,be=resoudrePerimetre('BE')!;
    expect(nomFacette('temps','Type de poste',ca,'fr-CA')).toBe('Temps de travail');
    expect(nomFacette('temps','Type de poste',ca,'en-CA')).toBe('Working hours');
    expect(nomFacette('ville','Ville · Stad',be,'fr-BE')).toBe('Ville');
    expect(nomFacette('ville','Ville · Stad',be,'nl-BE')).toBe('Stad');
  });
});
describe('vocabulaires de présentation', () => {
  it('traduit chaque concept livré sans modifier les règles ou les valeurs', () => {
    for (const lang of LANGUES_LIBELLES.filter((l) => l !== 'fr' && l !== 'en')) {
      for (const o of manifest.occupations) expect((catalogue.occupations as Record<string, {labels: Record<string,string>}>)[o.key].labels[lang],`${lang}/${o.key}`).toBeTruthy();
      for (const s of sectors) expect(libelleConcept('sectors',s.code,s.labels,lang)).toBeTruthy();
      expect(libelleInconnu(lang,'metier')).not.toBe(libelleInconnu('fr','metier'));
    }
  });
  it('les mots canadiens ne sont pas assimilés au contrat français', () => {
    expect(employmentLabel('employmentTerm', 'PERMANENT', 'fr', 'CA')).toBe('Permanent');
    expect(employmentLabel('programType', 'APPRENTICESHIP', 'fr', 'CA')).toBe('Apprentissage');
    expect(employmentLabel('programType', 'APPRENTICESHIP', 'fr', 'FR')).toBe('Alternance');
    expect(employmentLabel('employmentTerm', 'UNKNOWN', 'ja', 'JP')).toBeNull();
  });
  it('un concept nouveau ou renommé ne reçoit pas une ancienne traduction', () => {
    expect(libelleConcept('occupations','sales-advisor',{fr:'Nouveau sens',en:'New meaning'},'de')).toBe('New meaning');
    expect(libelleConcept('occupations','new-key',{fr:'Nouveau',en:'New'},'de')).toBe('New');
    expect(libelleConcept('occupations','sales-advisor',{fr:'Vente',en:'Sales advisor',de:'Verkaufsberatung validée'},'de')).toBe('Verkaufsberatung validée');
  });
});
