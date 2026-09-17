import { describe, expect, it } from 'vitest';

import {
  educationLevel,
  lvmhExperienceYears,
  personioExperienceYears,
} from '../experience.js';

/**
 * TÉMOINS DE LECTURE DE L'EXPÉRIENCE ET DU NIVEAU D'ÉTUDES.
 *
 * Chaque bloc AFFIRME D'ABORD SA PRÉMISSE : que le jeu d'essai contient bien la
 * valeur source réelle, dans la forme exacte mesurée en base le 2026-09-15. Un
 * témoin dont la prémisse n'atteint pas le défaut passe au vert sans rien
 * exercer — c'est le faux négatif rassurant que ce dépôt a déjà payé.
 */

/**
 * Les valeurs RÉELLES de `requiredExperienceFilter`, relevées en production
 * (5 443 offres LVMH) : exactement ces quatre, et rien d'autre.
 */
const LVMH_FILTRE_REEL = [
  ['Beginner', 2749],
  ['Minimum 3 years', 1633],
  ['Minimum 5 years', 789],
  ['Minimum 10 years', 272],
] as const;

describe('lvmhExperienceYears', () => {
  it('PRÉMISSE — le jeu d’essai porte les 4 valeurs canoniques mesurées, non traduites', () => {
    // Si LVMH renomme sa facette, ce témoin doit tomber AVANT les suivants :
    // sans cette assertion, un mapping devenu muet rendrait `undefined` partout
    // et les tests d'abstention passeraient au vert pour la mauvaise raison.
    expect(LVMH_FILTRE_REEL).toHaveLength(4);
    for (const [valeur] of LVMH_FILTRE_REEL) {
      expect(lvmhExperienceYears(valeur)).toBeTypeOf('number');
    }
  });

  it('convertit chaque palier en ANNÉES, la convention de la colonne', () => {
    expect(lvmhExperienceYears('Beginner')).toBe(0);
    expect(lvmhExperienceYears('Minimum 3 years')).toBe(3);
    expect(lvmhExperienceYears('Minimum 5 years')).toBe(5);
    expect(lvmhExperienceYears('Minimum 10 years')).toBe(10);
  });

  it('« Beginner » vaut 0 AN EXIGÉ, et non une absence', () => {
    // 0 et `undefined` ne disent pas la même chose : 0 est une exigence
    // (« débutant accepté », 2 749 offres), `undefined` est un silence. Les
    // confondre effacerait la plus grosse population de la facette.
    expect(lvmhExperienceYears('Beginner')).toBe(0);
    expect(lvmhExperienceYears('Beginner')).not.toBeUndefined();
  });

  /**
   * PRÉMISSE DU PIÈGE : `requiredExperience` (le libellé d'affichage) porte
   * réellement ces formes traduites en base — 25 valeurs, six langues.
   * Aucune ne doit produire de chiffre : les lire reviendrait à maintenir une
   * table de traduction qui se périmerait au premier marché ouvert.
   */
  it('REFUSE les libellés traduits du champ d’affichage', () => {
    const traduits = [
      'Minimum 3 ans',
      'Mindestens 3 Jahre',
      'Almeno 3 anni',
      '3年以上',
      '两年及以上',
      'Débutant',
      'Berufseinsteiger(in)',
      'Prima Esperienza',
      '未経験者',
    ];
    // La prémisse : ces formes existent bel et bien côté source.
    expect(traduits.length).toBeGreaterThan(5);
    for (const libelle of traduits) {
      expect(lvmhExperienceYears(libelle)).toBeUndefined();
    }
  });

  it('s’abstient sur le vide, le nul et l’inconnu plutôt que de deviner', () => {
    expect(lvmhExperienceYears('')).toBeUndefined();
    expect(lvmhExperienceYears('   ')).toBeUndefined();
    expect(lvmhExperienceYears(undefined)).toBeUndefined();
    expect(lvmhExperienceYears(null)).toBeUndefined();
    expect(lvmhExperienceYears(3)).toBeUndefined();
    // Un palier que LVMH n'a pas encore publié : case vide, jamais un chiffre
    // interpolé.
    expect(lvmhExperienceYears('Minimum 15 years')).toBeUndefined();
  });

  it('n’hérite rien du prototype d’Object', () => {
    // `Object.hasOwn` protège d'un `raw` valant "constructor" ou "toString",
    // qui rendrait une fonction là où la colonne attend un Int.
    expect(lvmhExperienceYears('constructor')).toBeUndefined();
    expect(lvmhExperienceYears('toString')).toBeUndefined();
    expect(lvmhExperienceYears('__proto__')).toBeUndefined();
  });
});

describe('personioExperienceYears', () => {
  it('PRÉMISSE — le jeu d’essai porte les 7 intervalles réels mesurés', () => {
    const reels = ['lt-1', '1-2', '2-5', '5-7', '7-10', '10-15', 'gt-15'];
    expect(reels).toHaveLength(7);
    for (const intervalle of reels) {
      expect(personioExperienceYears(intervalle)).toBeTypeOf('number');
    }
  });

  it('prend la BORNE BASSE, c’est-à-dire l’exigence minimale', () => {
    expect(personioExperienceYears('lt-1')).toBe(0);
    expect(personioExperienceYears('1-2')).toBe(1);
    expect(personioExperienceYears('2-5')).toBe(2);
    expect(personioExperienceYears('5-7')).toBe(5);
    expect(personioExperienceYears('7-10')).toBe(7);
    expect(personioExperienceYears('10-15')).toBe(10);
    expect(personioExperienceYears('gt-15')).toBe(15);
  });

  /**
   * PRÉMISSE : `seniority` est un champ RÉEL du même ATS (251 offres), porté
   * par les mêmes annonces. C'est précisément ce qui rend la confusion
   * possible — et ce que ce témoin interdit.
   */
  it('REFUSE l’échelle de séniorité du même ATS, qui ne dit aucune durée', () => {
    for (const rang of ['experienced', 'entry-level', 'student', 'executive']) {
      expect(personioExperienceYears(rang)).toBeUndefined();
    }
  });

  it('s’abstient sur le vide et l’inconnu', () => {
    expect(personioExperienceYears('')).toBeUndefined();
    expect(personioExperienceYears(undefined)).toBeUndefined();
    expect(personioExperienceYears('15-20')).toBeUndefined();
    expect(personioExperienceYears('constructor')).toBeUndefined();
  });
});

/**
 * LES ÉCHELLES QU'ON REFUSE D'ÉCRIRE — le cœur du principe « jamais de fausses
 * DATA ».
 *
 * Ce bloc n'appelle aucune fonction de conversion, parce qu'AUCUNE n'existe
 * pour ces champs, et c'est exactement ce qu'il garde. S'il devient possible de
 * convertir `mid_senior_level` en années sans décision produit, ce témoin doit
 * être le premier à tomber.
 */
describe('les rangs de séniorité ne se convertissent PAS en années', () => {
  it('aucune des échelles mesurées n’est convertible par les lecteurs existants', () => {
    // SmartRecruiters (6 243 offres) et Workable (279) : échelle LinkedIn.
    // Recruitee (653) : rang, mêlé de rangs hiérarchiques (`manager`).
    const rangs = [
      'entry_level', 'associate', 'mid_senior_level', 'director', 'executive',
      'internship', 'not_applicable',
      'mid_level', 'experienced', 'student_school', 'student_college',
      'manager', 'senior_manager',
      'Associate', 'Mid-Senior level', 'Entry level', 'Director',
    ];
    // Prémisse : la liste couvre bien les trois ATS mesurés.
    expect(rangs.length).toBeGreaterThanOrEqual(17);
    for (const rang of rangs) {
      expect(lvmhExperienceYears(rang)).toBeUndefined();
      expect(personioExperienceYears(rang)).toBeUndefined();
    }
  });

  it('`not_applicable` est une ABSENCE, jamais 0', () => {
    // 1 667 offres SmartRecruiters — le 2e volume de l'échelle. Le classer à 0
    // les ferait apparaître comme « ouvertes aux débutants », ce que la source
    // ne dit nulle part.
    expect(lvmhExperienceYears('not_applicable')).toBeUndefined();
    expect(lvmhExperienceYears('not_applicable')).not.toBe(0);
    expect(personioExperienceYears('not_applicable')).toBeUndefined();
  });
});

describe('educationLevel', () => {
  it('PRÉMISSE — le jeu d’essai porte les libellés natifs réels des 3 référentiels', () => {
    // Recruitee 653 offres, WTTJ 272 renseignées, Workable 45 utiles.
    expect(educationLevel('RECRUITEE', 'bachelor_degree')).toBeTypeOf('string');
    expect(educationLevel('WTTJ', 'bac_5')).toBeTypeOf('string');
    expect(educationLevel('WORKABLE', "Bachelor's Degree")).toBeTypeOf('string');
  });

  it('conserve le libellé SOURCE, préfixé de son référentiel', () => {
    expect(educationLevel('RECRUITEE', 'bachelor_degree')).toBe('RECRUITEE:bachelor_degree');
    expect(educationLevel('RECRUITEE', 'vocational')).toBe('RECRUITEE:vocational');
    expect(educationLevel('WTTJ', 'bac_5')).toBe('WTTJ:bac_5');
    expect(educationLevel('WTTJ', 'no_diploma')).toBe('WTTJ:no_diploma');
    expect(educationLevel('WORKABLE', "Bachelor's Degree")).toBe("WORKABLE:Bachelor's Degree");
  });

  it('ne range PAS des diplômes de pays différents sur une échelle commune', () => {
    // Un `bac_5` français et un `master_degree` néerlandais restent distincts :
    // les fondre produirait une équivalence que personne n'a validée.
    const francais = educationLevel('WTTJ', 'bac_5');
    const neerlandais = educationLevel('RECRUITEE', 'master_degree');
    expect(francais).not.toBe(neerlandais);
    // Et le référentiel reste lisible dans la valeur : sans lui,
    // `bachelor_degree` serait indistinguable d'un homonyme d'un autre ATS.
    expect(francais?.startsWith('WTTJ:')).toBe(true);
    expect(neerlandais?.startsWith('RECRUITEE:')).toBe(true);
  });

  /**
   * PRÉMISSE : ces formes muettes sont massives et réelles — Workable porte
   * 210 chaînes vides et 24 « Unspecified » sur 279 offres. Les écrire
   * remplirait la facette de bruit en la faisant passer pour de la donnée.
   */
  it('écarte les formes qui ne disent RIEN', () => {
    expect(educationLevel('WORKABLE', '')).toBeUndefined();
    expect(educationLevel('WORKABLE', '   ')).toBeUndefined();
    expect(educationLevel('WORKABLE', 'Unspecified')).toBeUndefined();
    expect(educationLevel('WORKABLE', 'unspecified')).toBeUndefined();
    expect(educationLevel('WORKABLE', 'N/A')).toBeUndefined();
    expect(educationLevel('RECRUITEE', undefined)).toBeUndefined();
    expect(educationLevel('RECRUITEE', null)).toBeUndefined();
  });

  /**
   * LE PIÈGE GREENHOUSE, gardé explicitement.
   *
   * `education` chez Greenhouse (414 offres) vaut `education_optional` /
   * `education_required` : un drapeau de FORMULAIRE de candidature, pas un
   * diplôme. Le nom de la clé et son volume en faisaient un candidat évident ;
   * seule la lecture des VALEURS l'a disqualifié.
   *
   * Aucun référentiel GREENHOUSE n'existe dans le type : ce témoin garde
   * l'absence. Si quelqu'un en ajoutait un, il tomberait.
   */
  it('GREENHOUSE n’est pas un référentiel de diplôme et n’en devient pas un', () => {
    const referentiels = ['RECRUITEE', 'WTTJ', 'WORKABLE'];
    expect(referentiels).not.toContain('GREENHOUSE');
    // Et les valeurs de Greenhouse ne sont des diplômes dans aucun référentiel :
    // si un jour elles étaient branchées, elles ressortiraient telles quelles,
    // ce que ce témoin rend visible.
    expect(educationLevel('WORKABLE', 'education_optional')).toBe('WORKABLE:education_optional');
  });
});
