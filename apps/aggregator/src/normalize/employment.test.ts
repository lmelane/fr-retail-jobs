import { describe, expect, it } from 'vitest';
import {
  readEmployment,
  decomposeCompositeCode,
  EMPLOYMENT_TERMS,
  WORK_TIMES,
  PROGRAM_TYPES,
  ENGAGEMENT_TYPES,
  type Employment,
} from './employment.js';

/**
 * LES QUATRE DIMENSIONS D'EMPLOI — indépendantes et CUMULABLES.
 *
 * Validé par Loïc le 2026-09-08, après deux erreurs de modélisation successives
 * mesurées dans cette base :
 *
 *  1. `contract` mélangeait quatre concepts dans un champ unique et imposait une
 *     grille juridique FRANÇAISE (CDI/CDD) à un catalogue mondial.
 *  2. `seniority` était contaminé par des PROGRAMMES : INTERNSHIP 3 438,
 *     APPRENTICESHIP 658, GRADUATE 200 — ce ne sont pas des niveaux de séniorité.
 *
 * Règle posée : « le faible volume décide si on EXPOSE une dimension, pas si on
 * POLLUE la taxonomie canonique. » Une colonne nullable propre vaut mieux qu'une
 * valeur rangée dans la mauvaise dimension.
 */
describe('les quatre taxonomies sont fermées et disjointes', () => {
  it('expose exactement les valeurs validées', () => {
    expect([...EMPLOYMENT_TERMS]).toEqual(['PERMANENT', 'FIXED_TERM', 'TEMPORARY']);
    expect([...WORK_TIMES]).toEqual(['FULL_TIME', 'PART_TIME']);
    expect([...PROGRAM_TYPES]).toEqual(['INTERNSHIP', 'APPRENTICESHIP', 'GRADUATE_PROGRAM', 'VIE']);
    expect([...ENGAGEMENT_TYPES]).toEqual(['EMPLOYEE', 'FREELANCE', 'INDEPENDENT_CONTRACTOR']);
  });

  it('aucune valeur n’appartient à deux dimensions', () => {
    const all = [...EMPLOYMENT_TERMS, ...WORK_TIMES, ...PROGRAM_TYPES, ...ENGAGEMENT_TYPES];
    expect(new Set(all).size).toBe(all.length);
  });
});

/**
 * LA DÉCOMPOSITION DES VALEURS COMPOSITES — mesurée en base le 2026-09-08.
 *
 * `employment_type_code` sert `parttime_fixed_term` (225 offres),
 * `fulltime_permanent` (154), `fulltime_fixed_term` (148)… Ces valeurs portent
 * DEUX dimensions à la fois : un champ unique devait en écraser une. C'est la
 * preuve mesurée qui a validé le modèle à quatre dimensions.
 */
describe('decomposeCompositeCode', () => {
  it('décompose parttime_fixed_term en deux dimensions', () => {
    expect(decomposeCompositeCode('parttime_fixed_term')).toEqual({
      workTime: 'PART_TIME',
      employmentTerm: 'FIXED_TERM',
    });
  });

  it('décompose fulltime_permanent', () => {
    expect(decomposeCompositeCode('fulltime_permanent')).toEqual({
      workTime: 'FULL_TIME',
      employmentTerm: 'PERMANENT',
    });
  });

  it('décompose parttime_permanent', () => {
    expect(decomposeCompositeCode('parttime_permanent')).toEqual({
      workTime: 'PART_TIME',
      employmentTerm: 'PERMANENT',
    });
  });

  /**
   * LE GARDE-FOU EXIGÉ : un token inconnu ne doit JAMAIS être forcé dans une
   * dimension. « minijob » est un statut allemand qui ne correspond à aucune
   * valeur d'`employmentTerm` — on prend le rythme, et on laisse le terme vide
   * plutôt que d'inventer.
   */
  it('parttime_minijob ne produit AUCUN employmentTerm', () => {
    expect(decomposeCompositeCode('parttime_minijob')).toEqual({ workTime: 'PART_TIME' });
  });

  /**
   * Ces valeurs sont des PROGRAMMES, pas des termes d'emploi : elles ne doivent
   * pas gonfler le gain d'`employmentTerm` juste parce qu'elles apparaissent
   * dans `employment_type_code`.
   */
  it('internship et apprenticeship vont en programType, jamais en employmentTerm', () => {
    expect(decomposeCompositeCode('internship')).toEqual({ programType: 'INTERNSHIP' });
    expect(decomposeCompositeCode('apprenticeship')).toEqual({ programType: 'APPRENTICESHIP' });
  });

  /**
   * « contract » seul est ambigu : en anglais d'entreprise il peut désigner un
   * CDD comme une prestation indépendante. On refuse de trancher.
   */
  it('« contract » seul ne produit rien — trop ambigu', () => {
    expect(decomposeCompositeCode('contract')).toEqual({});
  });

  it('freelance va en engagementType, jamais en employmentTerm', () => {
    expect(decomposeCompositeCode('freelance')).toEqual({ engagementType: 'FREELANCE' });
  });

  it('les valeurs simples restent lues', () => {
    expect(decomposeCompositeCode('fulltime')).toEqual({ workTime: 'FULL_TIME' });
    expect(decomposeCompositeCode('temporary')).toEqual({ employmentTerm: 'FIXED_TERM' });
    expect(decomposeCompositeCode('seasonal')).toEqual({ isSeasonal: true });
  });

  it('une valeur inconnue ne produit rien', () => {
    expect(decomposeCompositeCode('vendeur_polyvalent')).toEqual({});
    expect(decomposeCompositeCode('')).toEqual({});
  });
});

describe('readEmployment — lecture d’une valeur libre vers les 4 dimensions', () => {
  describe('employmentTerm', () => {
    it.each([
      ['CDI', 'PERMANENT'],
      ['Contrat à durée indéterminée', 'PERMANENT'],
      ['Permanent', 'PERMANENT'],
      ['Regular', 'PERMANENT'],
      ['Unbefristet', 'PERMANENT'],
      ['CDD', 'FIXED_TERM'],
      ['Fixed-term', 'FIXED_TERM'],
      ['Fix-Term', 'FIXED_TERM'],
      ['Temporary', 'FIXED_TERM'],
      ['Befristet', 'FIXED_TERM'],
      ['Intérim', 'TEMPORARY'],
    ])('%s → employmentTerm %s', (input, expected) => {
      expect(readEmployment(input).employmentTerm).toBe(expected);
    });
  });

  describe('workTime', () => {
    it.each([
      ['Full-time', 'FULL_TIME'],
      ['Temps plein', 'FULL_TIME'],
      ['Vollzeit', 'FULL_TIME'],
      ['Part Time', 'PART_TIME'],
      ['Temps partiel', 'PART_TIME'],
      ['Teilzeit', 'PART_TIME'],
      ['24H', 'PART_TIME'],
      ['35H', 'FULL_TIME'],
    ])('%s → workTime %s', (input, expected) => {
      expect(readEmployment(input).workTime).toBe(expected);
    });

    it('un rythme ne produit JAMAIS un employmentTerm', () => {
      expect(readEmployment('Full-time').employmentTerm).toBeUndefined();
      expect(readEmployment('Part Time').employmentTerm).toBeUndefined();
    });
  });

  describe('programType — sorti de seniority ET de contract', () => {
    it.each([
      ['Stage', 'INTERNSHIP'],
      ['Stagiaire', 'INTERNSHIP'],
      ['Internship', 'INTERNSHIP'],
      ['Praktikum', 'INTERNSHIP'],
      ['Alternance', 'APPRENTICESHIP'],
      ['Apprenticeship', 'APPRENTICESHIP'],
      ['Graduate Program', 'GRADUATE_PROGRAM'],
      ['V.I.E', 'VIE'],
      ['Volontariat International en Entreprise', 'VIE'],
    ])('%s → programType %s', (input, expected) => {
      expect(readEmployment(input).programType).toBe(expected);
    });

    /**
     * DÉCISION LOÏC : pas d'assimilation forcée. Un V.I.E est borné dans le
     * temps, mais tant que la source ne l'écrit pas, `employmentTerm` reste vide.
     */
    it('V.I.E ne produit AUCUN employmentTerm par assimilation', () => {
      expect(readEmployment('V.I.E').employmentTerm).toBeUndefined();
    });

    it('un stage ne produit pas FIXED_TERM par assimilation', () => {
      expect(readEmployment('Stage').employmentTerm).toBeUndefined();
    });

    /** Workday sert « Contrat à durée déterminée (hors stagiaire) » : un vrai CDD. */
    it('respecte une exclusion explicite', () => {
      const r = readEmployment('Contrat à durée déterminée (hors stagiaire)');
      expect(r.employmentTerm).toBe('FIXED_TERM');
      expect(r.programType).toBeUndefined();
    });
  });

  describe('engagementType', () => {
    it('freelance et independent contractor restent DISTINCTS', () => {
      expect(readEmployment('Freelance').engagementType).toBe('FREELANCE');
      expect(readEmployment('CONTRACTOR').engagementType).toBe('INDEPENDENT_CONTRACTOR');
      expect(readEmployment('Independent Contractor').engagementType).toBe('INDEPENDENT_CONTRACTOR');
    });

    /** Aucune source ne déclare « EMPLOYEE » : on ne le déduit jamais d'une absence. */
    it('EMPLOYEE n’est jamais déduit d’une absence de preuve', () => {
      expect(readEmployment('CDI').engagementType).toBeUndefined();
      expect(readEmployment('Permanent').engagementType).toBeUndefined();
    });

    it('un freelance ne produit pas d’employmentTerm', () => {
      expect(readEmployment('Freelance').employmentTerm).toBeUndefined();
    });
  });

  describe('cumul — les dimensions sont indépendantes', () => {
    it('une valeur composée renseigne plusieurs dimensions à la fois', () => {
      expect(readEmployment('Fulltime-Regular')).toEqual({
        workTime: 'FULL_TIME',
        workTimeEvidence: 'EXPLICIT',
        employmentTerm: 'PERMANENT',
      });
    });

    it('« CDI 35H » donne le terme ET le rythme', () => {
      const r = readEmployment('CDI 35H');
      expect(r.employmentTerm).toBe('PERMANENT');
      expect(r.workTime).toBe('FULL_TIME');
    });

    it('« Stage temps plein » donne le programme ET le rythme, sans terme', () => {
      const r = readEmployment('Stage temps plein');
      expect(r.programType).toBe('INTERNSHIP');
      expect(r.workTime).toBe('FULL_TIME');
      expect(r.employmentTerm).toBeUndefined();
    });
  });

  it('une valeur vide ou inconnue ne produit rien', () => {
    const empty: Employment = {};
    expect(readEmployment(null)).toEqual(empty);
    expect(readEmployment('Conseiller de vente')).toEqual(empty);
  });
});

/**
 * DÉFAUTS DE PRIORITÉ trouvés par le DRY-RUN du 2026-09-08 sur 71 629 offres.
 *
 * Le dry-run n'a pas servi qu'à compter : ses 3 237 conflits d'`employmentTerm`
 * et 197 de `programType` ont exposé trois règles mal ordonnées. Chaque cas
 * ci-dessous est un titre RÉEL du catalogue.
 */
describe('conflits révélés par le dry-run', () => {
  /**
   * LA CORRECTION DE MODÈLE (Loïc, 2026-09-08). 2 359 offres Sephora portent
   * `contract = CDD` ET un titre « Seasonal Retail Associate » : les deux sont
   * VRAIES. Les opposer dans une même dimension imposait un faux arbitrage et ne
   * laissait que 4 SEASONAL dans tout le catalogue. Le caractère saisonnier est
   * une caractéristique indépendante, cumulable avec n'importe quelle durée.
   */
  it('saisonnier et durée coexistent, sans jamais s’écraser', () => {
    expect(decomposeCompositeCode('temporary_seasonal')).toEqual({
      employmentTerm: 'FIXED_TERM',
      isSeasonal: true,
    });
    const r = readEmployment('Material Handler (1st Shift Seasonal)');
    expect(r.isSeasonal).toBe(true);
    expect(r.employmentTerm).toBeUndefined();
  });

  it('« Seasonal » ne produit AUCUNE durée — il ne la nomme pas', () => {
    expect(readEmployment('Seasonal').employmentTerm).toBeUndefined();
    expect(readEmployment('Seasonal').isSeasonal).toBe(true);
    expect(readEmployment('Saisonnier').isSeasonal).toBe(true);
  });

  /**
   * « Saison » nu est écarté : dans ce secteur, « collection Automne-Hiver » et
   * « bilan de saison » sont partout sans qu'aucun poste ne soit saisonnier.
   */
  it('ne prend pas le mot « saison » du secteur pour un poste saisonnier', () => {
    expect(readEmployment('Chef de produit collection Automne-Hiver').isSeasonal).toBeUndefined();
    expect(readEmployment('Analyste bilan de saison').isSeasonal).toBeUndefined();
  });

  /**
   * « VIE - Data Analyst (H/F) - New York » : la source écrit VIE nu, en tête de
   * titre. Le motif n'acceptait que la forme pointée (garde contre « qualité de
   * vie »), et 100 % des V.I.E étaient perdus.
   */
  it('reconnaît « VIE » nu quand il est isolé comme un sigle', () => {
    expect(readEmployment('VIE - Data Analyst (H/F) - New York').programType).toBe('VIE');
    expect(readEmployment('VIE Data Engineer').programType).toBe('VIE');
  });

  it("ne prend toujours PAS le mot « vie » courant pour un dispositif", () => {
    expect(readEmployment('Qualité de vie au travail').programType).toBeUndefined();
    expect(readEmployment('Responsable assurance vie').programType).toBeUndefined();
    expect(readEmployment('Chef de projet Art de Vivre').programType).toBeUndefined();
  });

  /**
   * « SeedZ Management Trainee Programm » est un GRADUATE_PROGRAM : « trainee »
   * seul évoque le stage, mais accompagné de « program » il désigne un parcours
   * de jeune diplômé.
   */
  it('« Trainee Program » est un graduate program, pas un stage', () => {
    expect(readEmployment('SeedZ Management Trainee Programm (m/w/d)').programType).toBe('GRADUATE_PROGRAM');
    expect(readEmployment('Finance Management Trainee Program').programType).toBe('GRADUATE_PROGRAM');
  });

  it('« Trainee » seul reste un stage', () => {
    expect(readEmployment('Trainee Digital Media').programType).toBe('INTERNSHIP');
  });
});

/**
 * LA QUALITÉ INTRINSÈQUE DE LA PREUVE (décision Loïc, 2026-09-08).
 *
 * « Sales Associate - Part-Time » DÉCLARE le rythme ; « Conseiller de vente
 * 21h » le laisse DÉDUIRE d'un horaire. Les deux donnent PART_TIME, mais ils
 * n'ont pas la même autorité : un titre explicite peut détrôner un champ
 * structuré dégradé, une inférence non.
 */
describe('readEmployment — explicite vs inféré', () => {
  it('un mot de rythme est une preuve EXPLICITE', () => {
    expect(readEmployment('Sales Associate - Part-Time').workTimeEvidence).toBe('EXPLICIT');
    expect(readEmployment('Conseiller de vente — Temps partiel').workTimeEvidence).toBe('EXPLICIT');
    expect(readEmployment('Verkäufer Vollzeit').workTimeEvidence).toBe('EXPLICIT');
  });

  it('un horaire chiffré est une INFÉRENCE', () => {
    expect(readEmployment('Conseiller de vente 21h').workTime).toBe('PART_TIME');
    expect(readEmployment('Conseiller de vente 21h').workTimeEvidence).toBe('INFERRED');
    expect(readEmployment('Vendeur 35H').workTime).toBe('FULL_TIME');
    expect(readEmployment('Vendeur 35H').workTimeEvidence).toBe('INFERRED');
  });

  it('sans rythme, aucune nature de preuve', () => {
    expect(readEmployment('Conseiller de vente').workTimeEvidence).toBeUndefined();
  });

  /** L'explicite l'emporte quand les deux coexistent : « CDI 21h Temps plein ». */
  it('un mot explicite prime sur un horaire dans le même libellé', () => {
    const r = readEmployment('Vendeur 21h - Temps plein');
    expect(r.workTime).toBe('FULL_TIME');
    expect(r.workTimeEvidence).toBe('EXPLICIT');
  });
});

/**
 * CONVERGENCE avec la taxonomie — divergence trouvée par l'invariant
 * `ingest == replay` (2026-09-08).
 *
 * Le replay et l'ingest classaient « Management Trainee » différemment :
 * `taxonomy.ts` disait GRADUATE_PROGRAM, `employment.ts` INTERNSHIP. Deux
 * modules ne peuvent pas juger la même chose différemment — c'est exactement la
 * divergence que la chaîne commune doit rendre impossible.
 *
 * Arbitrage : un « management trainee » est un parcours de jeune diplômé
 * (rotations, encadrement, débouché cadre) ; un « trainee » seul reste un stage.
 */
describe('convergence programType avec la taxonomie', () => {
  it.each([
    'Management Trainee',
    'Management Trainee (Ankara)',
    'Retail Management Trainee',
    'Graduate Management Trainee',
  ])('« %s » est un graduate program', (title) => {
    expect(readEmployment(title).programType).toBe('GRADUATE_PROGRAM');
  });

  it('« Trainee » seul reste un stage', () => {
    expect(readEmployment('Trainee Digital Media').programType).toBe('INTERNSHIP');
    expect(readEmployment('Marketing Trainee').programType).toBe('INTERNSHIP');
  });
});
