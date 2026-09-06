import { describe, it, expect } from 'vitest';
import {
  normalizeContract,
  extractContract,
  extractSalaryBand,
} from './contract.js';

/**
 * Behaviour these tests pin down (BDD): a candidate must never read a wrong
 * contract or an invented salary on a fiche. Each case below is a real
 * misclassification observed in the current code, written as the CORRECT
 * expectation so the fix is provable.
 */

describe('normalizeContract — the contract a source states', () => {
  it('classes a permanent role as CDI even when the title says "Consultant"', () => {
    // "Consultant … (CDI)": FREELANCE pattern (CONSULTANT) must not outrank CDI.
    expect(normalizeContract('Consultant Retail Merchandiser CDI')).toBe('CDI');
    expect(normalizeContract('Business Consultant - CDI')).toBe('CDI');
  });

  it('still classes a genuine freelance/consultant role as FREELANCE', () => {
    expect(normalizeContract('Consultant indépendant')).toBe('FREELANCE');
    expect(normalizeContract('Freelance Photographer')).toBe('FREELANCE');
  });

  it('does not turn "Mission" in a job title into INTERIM', () => {
    // "MISSION" must be word-bounded and not match Commission/Emission/… nor a
    // permanent "Chef de Mission".
    expect(normalizeContract('Chef de Mission Comptable')).not.toBe('INTERIM');
    expect(normalizeContract('Commission Analyst')).not.toBe('INTERIM');
    expect(normalizeContract('Emission Control Specialist')).not.toBe('INTERIM');
  });

  it('still classes a real interim/temporary contract as INTERIM', () => {
    expect(normalizeContract('Contrat intérimaire')).toBe('INTERIM');
    expect(normalizeContract('Mission d’intérim 3 mois')).toBe('INTERIM');
  });

  it('does not read the French word "vie" as a V.I.E contract', () => {
    expect(normalizeContract('Belle qualité de vie au travail')).not.toBe('VIE');
    expect(normalizeContract('Assurance vie proposée')).not.toBe('VIE');
  });

  it('still classes a real V.I.E as VIE', () => {
    expect(normalizeContract('V.I.E Marketing - Milan')).toBe('VIE');
    expect(normalizeContract('Volontariat International en Entreprise')).toBe('VIE');
  });

  it('does not read CONTEMPORARY as a temporary contract', () => {
    expect(normalizeContract('Contemporary Art Advisor')).not.toBe('INTERIM');
  });
});

describe('extractContract — the contract read from the posting body', () => {
  it('respects negation: "pas un CDI" is not a CDI', () => {
    expect(
      extractContract(null, "Ce poste n'est pas un CDI, c'est une alternance."),
    ).toBe('ALTERNANCE');
  });

  it('does not read "qualité de vie" in the body as a V.I.E', () => {
    expect(
      extractContract('Conseiller de vente', 'Nous offrons une vraie qualité de vie au travail.'),
    ).not.toBe('VIE');
  });
});

describe('extractSalaryBand — only a real salary, never any euro amount', () => {
  it('does not read a company turnover as a salary', () => {
    expect(extractSalaryBand("Chiffre d'affaires de 500 000 € en 2025")).toBeNull();
  });

  it('does not read a budget as a salary', () => {
    expect(extractSalaryBand('Vous gérez un budget de 1 200 000 €.')).toBeNull();
  });

  it('still reads a stated salary band', () => {
    const band = extractSalaryBand('Rémunération : 30 000 - 35 000 € brut annuel');
    expect(band).not.toBeNull();
    expect(band?.min).toBe(30_000);
    expect(band?.max).toBe(35_000);
  });
});

// ——— l2 (2026-09-06) : valeurs structurées des ATS, perdues à la frontière ———
import { normalizeWorkingTime, isWorkingTimeValue, isEmploymentTerm } from './contract.js';

describe('l2 — FULL_TIME / PART_TIME (schema.org, Workday, Jibe, Phenom) sont un temps de travail', () => {
  it('reconnaît la forme à underscore comme temps de travail, jamais comme contrat', () => {
    expect(normalizeWorkingTime('FULL_TIME')).toBe('TEMPS_PLEIN');
    expect(normalizeWorkingTime('PART_TIME')).toBe('TEMPS_PARTIEL');
    expect(normalizeContract('FULL_TIME')).toBe('UNKNOWN');
    expect(normalizeContract('PART_TIME')).toBe('UNKNOWN');
    expect(isWorkingTimeValue('PART_TIME')).toBe(true);
    expect(isWorkingTimeValue('FULL_TIME')).toBe(true);
  });

  it('lit les libellés Workday (fr/en), allemands et collés (Eightfold)', () => {
    expect(normalizeWorkingTime('À temps plein')).toBe('TEMPS_PLEIN');
    expect(normalizeWorkingTime('Full time')).toBe('TEMPS_PLEIN');
    expect(normalizeWorkingTime('Teilzeit')).toBe('TEMPS_PARTIEL');
    expect(normalizeWorkingTime('Vollzeit')).toBe('TEMPS_PLEIN');
    expect(normalizeWorkingTime('Fulltime-Regular')).toBe('TEMPS_PLEIN');
    expect(normalizeWorkingTime('Regular Part-Time')).toBe('TEMPS_PARTIEL');
  });
});

describe('l2 — permanent/regular → CDI ; temporary/fixed term/seasonal → CDD ; intern → STAGE ; apprentice → ALTERNANCE', () => {
  it('classe les valeurs structurées que les ATS publient', () => {
    expect(normalizeContract('permanent')).toBe('CDI');
    expect(normalizeContract('Regular Part-Time')).toBe('CDI');
    expect(normalizeContract('Fulltime-Regular')).toBe('CDI');
    expect(normalizeContract('Temporary')).toBe('CDD');
    expect(normalizeContract('Fulltime-Temporary')).toBe('CDD');
    expect(normalizeContract('Fixed-term contract')).toBe('CDD');
    expect(normalizeContract('Seasonal')).toBe('CDD');
    expect(normalizeContract('Internship')).toBe('STAGE');
    expect(normalizeContract('Apprenticeship')).toBe('ALTERNANCE');
  });

  it('ne lit pas CONTEMPORARY comme un CDD', () => {
    expect(normalizeContract('Contemporary Art Advisor')).toBe('UNKNOWN');
  });
});

describe('l2 — isEmploymentTerm : un tag qui nomme un contrat ou un temps, et rien d’autre', () => {
  it('accepte Regular / Part Time, refuse une enseigne, une date, une région', () => {
    expect(isEmploymentTerm('Regular')).toBe(true);
    expect(isEmploymentTerm('Part Time')).toBe(true);
    expect(isEmploymentTerm('Regular Part-Time')).toBe(true);
    expect(isEmploymentTerm('Kids Foot Locker')).toBe(false);
    expect(isEmploymentTerm('9/4/2026')).toBe(false);
    expect(isEmploymentTerm('North America')).toBe(false);
    expect(isEmploymentTerm(undefined)).toBe(false);
  });
});

describe('l2 (revue) — un horaire chiffré : partiel sous 35 h, plein de 35 à 39 h', () => {
  it('« 35H » et « 39H » sont un temps plein, « 24H » un temps partiel', () => {
    expect(normalizeWorkingTime('Vendeur 35H CDI')).toBe('TEMPS_PLEIN');
    expect(normalizeWorkingTime('CDI 39h')).toBe('TEMPS_PLEIN');
    expect(normalizeWorkingTime('CDI 24H - Vendeur')).toBe('TEMPS_PARTIEL');
    expect(normalizeWorkingTime('Conseiller H/F')).toBe('UNKNOWN');
  });
});
