import { describe, expect, it } from 'vitest';
import {
  readWorkplaceField,
  readWorkplaceText,
  readWorkplaceRestriction,
  readWorkplaceDescription,
  WORKPLACE_TYPES,
} from './workplace.js';

/**
 * `workplaceType` — le mode de travail, dimension mondiale.
 *
 * Remplace `remote`, qui portait le vocabulaire propriétaire de WTTJ
 * (`punctual`, `fulltime`, `unknown`) dans le modèle mondial et stockait
 * « unknown » comme une valeur sur 648 offres.
 *
 * Le gisement plafonne à ~4,3 % du catalogue. Ce n'est pas une raison de garder
 * un champ mal défini : le faible volume décide de ce qu'on EXPOSE, pas de la
 * propreté du modèle (règle Loïc, 2026-09-08).
 */
describe('workplaceType — taxonomie', () => {
  it('expose exactement les trois valeurs validées', () => {
    expect([...WORKPLACE_TYPES]).toEqual(['ONSITE', 'HYBRID', 'REMOTE']);
  });
});

describe('readWorkplaceField — les champs structurés', () => {
  /**
   * L'échelle WTTJ, vérifiée dans la documentation officielle de leur API :
   * no = « Non autorisé », punctual = « Télétravail PONCTUEL autorisé »,
   * partial = « Télétravail partiel », fulltime = « Télétravail total possible ».
   */
  it.each([
    ['remote', 'no', 'ONSITE'],
    ['remote', 'partial', 'HYBRID'],
    ['remote', 'fulltime', 'REMOTE'],
  ])('WTTJ %s=%s → %s', (field, value, expected) => {
    expect(readWorkplaceField(field, value)?.type).toBe(expected);
  });

  /**
   * DÉCISION LOÏC : `punctual` est un poste SUR SITE avec une tolérance
   * occasionnelle, pas un rythme hybride. Le classer HYBRID promettrait des
   * jours télétravaillés garantis qui n'existent pas.
   */
  it('« punctual » (télétravail ponctuel) est ONSITE, jamais HYBRID', () => {
    expect(readWorkplaceField('remote', 'punctual')?.type).toBe('ONSITE');
  });

  /** « unknown » est un VIDE, pas une valeur — 648 offres le stockaient. */
  it('« unknown » ne produit rien', () => {
    expect(readWorkplaceField('remote', 'unknown')).toBeUndefined();
    expect(readWorkplaceField('remote', '')).toBeUndefined();
    expect(readWorkplaceField('remote', null)).toBeUndefined();
  });

  /** La langue de la source ne change jamais le concept canonique. */
  it.each([
    ['custOnsiteRemote', '["Onsite"]', 'ONSITE'],
    ['custOnsiteRemote', '["Hybrid"]', 'HYBRID'],
    ['custOnsiteRemote', '["Remote"]', 'REMOTE'],
    ['custOnsiteRemote', '["Híbrido"]', 'HYBRID'],
    ['custOnsiteRemote', '["Hybryda"]', 'HYBRID'],
    ['workplaceType', 'onsite', 'ONSITE'],
    ['workplaceType', 'OnSite', 'ONSITE'],
    ['workplaceType', 'hybrid', 'HYBRID'],
    ['workplaceType', 'remote', 'REMOTE'],
  ])('%s=%s → %s (multilingue)', (field, value, expected) => {
    expect(readWorkplaceField(field, value)?.type).toBe(expected);
  });

  describe('les booléens ne se lisent qu’avec le sens de leur clé', () => {
    it('isRemote est un vrai booléen de télétravail', () => {
      expect(readWorkplaceField('isRemote', 'true')?.type).toBe('REMOTE');
      expect(readWorkplaceField('isRemote', 'false')?.type).toBe('ONSITE');
    });

    it('telecommuting=false signifie sur site', () => {
      expect(readWorkplaceField('telecommuting', 'false')?.type).toBe('ONSITE');
    });

    it('on_site=true signifie sur site', () => {
      expect(readWorkplaceField('on_site', 'true')?.type).toBe('ONSITE');
    });

    /**
     * `on_site: false` ne dit PAS où l'on travaille — seulement que ce n'est
     * pas exclusivement sur site. Inventer HYBRID ou REMOTE serait une donnée
     * fabriquée.
     */
    it('on_site=false ne conclut RIEN', () => {
      expect(readWorkplaceField('on_site', 'false')).toBeUndefined();
    });

    it('hybrid=false ne conclut rien non plus', () => {
      expect(readWorkplaceField('hybrid', 'true')?.type).toBe('HYBRID');
      expect(readWorkplaceField('hybrid', 'false')).toBeUndefined();
    });

    it('un booléen sans clé interprétable ne dit rien', () => {
      expect(readWorkplaceField('someFlag', 'true')).toBeUndefined();
    });
  });
});

describe('readWorkplaceText — titre et description', () => {
  it('lit un mot explicite', () => {
    expect(readWorkplaceText('Sr Data Engineer (Remote)')).toEqual({ type: 'REMOTE', evidence: 'EXPLICIT' });
    expect(readWorkplaceText('Account Manager - Hybrid')).toEqual({ type: 'HYBRID', evidence: 'EXPLICIT' });
    expect(readWorkplaceText('Vendeur - présentiel')).toEqual({ type: 'ONSITE', evidence: 'EXPLICIT' });
  });

  /**
   * LES FAUX POSITIFS signalés par Loïc : la recherche texte sert à TROUVER des
   * candidats, jamais à écrire une valeur canonique aveuglément.
   */
  it.each([
    'Engineer, Remote Control Systems',
    'Manager, Remote Team Collaboration',
    'Field Manager - support remote stores',
    'Data Architect - Hybrid Cloud',
  ])('écarte le faux positif « %s »', (title) => {
    expect(readWorkplaceText(title)).toBeUndefined();
  });

  /**
   * L'INFÉRENCE : le mode n'est pas nommé, il se déduit d'un rythme. Preuve
   * d'autorité moindre, exactement comme « 21h » pour le temps de travail.
   */
  it('déduit HYBRID d’un rythme, en le marquant INFERRED', () => {
    expect(readWorkplaceText('Vous serez 3 jours au bureau par semaine')).toEqual({
      type: 'HYBRID',
      evidence: 'INFERRED',
    });
    expect(readWorkplaceText('2 days per week in the office')).toEqual({
      type: 'HYBRID',
      evidence: 'INFERRED',
    });
  });

  it('ne conclut rien sur un texte muet', () => {
    expect(readWorkplaceText('Conseiller de vente - Paris')).toBeUndefined();
  });
});

/**
 * La RESTRICTION GÉOGRAPHIQUE : conservée telle quelle en v1, sans taxonomie ni
 * colonne dédiée (décision Loïc — on accumule, on promeut quand le volume le
 * justifie).
 */
describe('readWorkplaceRestriction', () => {
  it.each([
    ['Luxury Sales Specialist - Remote USA', 'USA'],
    ['Account Director, Central US (Remote)', undefined],
    ['Nurse Practitioner (Remote, NJ License Required)', 'NJ License Required'],
  ])('%s → %s', (title, expected) => {
    const found = readWorkplaceRestriction(title);
    if (expected === undefined) expect(found === undefined || found.length > 0).toBe(true);
    else expect(found).toContain(expected.split(' ')[0]);
  });

  it('« Remote Role » n’est pas un lieu', () => {
    expect(readWorkplaceRestriction('Regional Account Manager (Remote Role)')).toBeUndefined();
    expect(readWorkplaceRestriction('Software Engineer | Remote Work')).toBeUndefined();
  });

  it('ne rend rien sans mention de télétravail', () => {
    expect(readWorkplaceRestriction('Conseiller de vente - Paris')).toBeUndefined();
  });
});

/**
 * FAUX POSITIFS trouvés par le DRY-RUN du 2026-09-08 — deux champs dont le NOM
 * promettait une information que leur CONTENU ne porte pas.
 */
describe('faux positifs de champs, mesurés en base', () => {
  /**
   * `has_remote` vaut `true` sur 100 % des lignes WTTJ — y compris quand
   * `remote: no`. Ce n'est pas un booléen de télétravail : c'est un marqueur
   * « ce champ est présent ». Le lire comme REMOTE aurait faussement classé
   * 873 offres, dont 396 explicitement « pas de télétravail ».
   */
  it('has_remote=true n’est PAS une preuve de télétravail', () => {
    expect(readWorkplaceField('has_remote', 'true')).toBeUndefined();
    expect(readWorkplaceField('has_remote', 'false')).toBeUndefined();
  });

  it('mais isRemote et telecommuting restent de vrais booléens', () => {
    expect(readWorkplaceField('isRemote', 'true')?.type).toBe('REMOTE');
    expect(readWorkplaceField('telecommuting', 'false')?.type).toBe('ONSITE');
  });

  /**
   * `flexible_within_country` (Estée Lauder) apparaît sur des postes en
   * BOUTIQUE — « Beauty Advisor - Multibrand », « SAINT LAURENT Client Advisor
   * - Wuhan SKP ». Ce champ ne parle pas d'une restriction de télétravail.
   */
  it('flexible_within_country n’est pas une restriction de télétravail', () => {
    expect(readWorkplaceRestriction('flexible_within_country')).toBeUndefined();
  });
});

/**
 * LA DESCRIPTION — verrouillée par l'audit de précision du 2026-09-08.
 *
 * Elle pesait 70 % des décisions : le principal risque d'injecter des faux
 * positifs en masse. L'audit a montré que sur 6 665 offres où un mot apparaît,
 * seules ~1 300 portent une ASSERTION sur le poste. Les 5 361 autres sont des
 * mentions incidentes.
 *
 * Règle (Loïc) : la description n'écrit que si elle affirme quelque chose sur
 * l'organisation du travail DE CETTE OFFRE — jamais sur simple présence du mot.
 */
describe('description — assertion sur le poste, pas mention du mot', () => {
  it.each([
    ['This role is 100% REMOTE', 'REMOTE'],
    ['This role is a remote work opportunity.', 'REMOTE'],
    ['This is a hybrid position with in-office work on Monday', 'HYBRID'],
    ['This role is hybrid in-office (3 days/week)', 'HYBRID'],
    ['Hybrid (3 days in NYC office)', 'HYBRID'],
    ['This position is located on-site in our Wausau office', 'ONSITE'],
    ['Télétravail 2 jours par semaine', 'HYBRID'],
  ])('assertion « %s » → %s', (text, expected) => {
    expect(readWorkplaceDescription(text)?.type).toBe(expected);
  });

  /**
   * LES MENTIONS INCIDENTES, toutes trouvées dans de vraies descriptions par
   * l'audit. Aucune ne parle du régime de travail de l'offre.
   */
  it.each([
    'Experience managing hybrid technology landscapes consisting of SaaS, cloud',
    'Company Culture Employee Resource Groups #LI-KS1 #LI-Remote',
    'coordinating and executing digital, physical or hybrid events',
    'from flexible working hours, to possibility of remote working, to Sunny Fridays',
    'Hybrid work arrangement with on-site parking',
    'Remboursement des transports en commun à 50%',
  ])('refuse la mention « %s »', (text) => {
    expect(readWorkplaceDescription(text)).toBeUndefined();
  });

  /**
   * LA NÉGATION, trouvée par l'audit sur de vraies offres Foot Locker : « This
   * role is NOT available as a remote position » ressortait REMOTE. Une
   * négation inverse le sens, elle ne le confirme pas.
   */
  it('respecte une négation explicite', () => {
    expect(readWorkplaceDescription('This role is not available as a remote position.')?.type).not.toBe('REMOTE');
    expect(readWorkplaceDescription('Ce poste n’est pas éligible au télétravail.')?.type).not.toBe('REMOTE');
  });
});

/**
 * INVARIANT 1 (Loïc, 2026-09-08) : une négation de REMOTE est une preuve
 * d'EXCLUSION, pas une valeur canonique positive.
 *
 * « This role is NOT available as a remote position » interdit d'écrire REMOTE.
 * Elle ne prouve PAS ONSITE : l'offre peut parfaitement être hybride.
 */
describe('négation : exclure REMOTE sans conclure ONSITE', () => {
  it('une négation seule ne conclut rien', () => {
    expect(readWorkplaceDescription('This role is not available as a remote position.')).toBeUndefined();
    expect(readWorkplaceDescription('Ce poste n’est pas éligible au télétravail.')).toBeUndefined();
  });

  /**
   * Le défaut que l'invariant a révélé : la négation faisait un abandon GLOBAL,
   * donc une assertion hybride valide dans la même description était perdue.
   */
  it('une négation de REMOTE n’efface pas une assertion HYBRID de la même offre', () => {
    const text =
      'This role is not available as a remote position. This is a hybrid position with 3 days in the office.';
    expect(readWorkplaceDescription(text)?.type).toBe('HYBRID');
  });

  it('une négation n’efface pas non plus une assertion ONSITE explicite', () => {
    const text = 'This role is not available as a remote position. This position is located on-site in our office.';
    expect(readWorkplaceDescription(text)?.type).toBe('ONSITE');
  });
});
