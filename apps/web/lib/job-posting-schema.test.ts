import { describe, it, expect } from 'vitest';
import { jobPostingSchema, markupIneligibility, schemaEmploymentTypes } from './job-posting-schema';
import type { JobRow } from './jobs';

/**
 * S-02a/S-02b intérim — the JSON-LD contract, pinned:
 * datePosted uses the employer publication date, validThrough is source evidence only,
 * employmentTerm speaks schema.org, and addressCountry is NEVER a hard-coded
 * FR — it is the canonical code of what the source said, or absent.
 */

const base: JobRow = {
  id: 'ck123', title: 'Vendeur', company: 'Cartier', companyDomain: 'cartier.com', group: 'Richemont',
  city: 'PARIS', location: 'Paris, France', employmentTerm: 'PERMANENT', sector: 'LUXURY',
  url: 'https://x/1', postedAt: new Date('2026-08-20T00:00:00Z'), latitude: null, longitude: null,
  sourceCount: 1, sources: ['cartier'],
  // Une description RÉELLE : depuis le 2026-09-11 un fragment ne suffit plus à mériter un balisage
  // (`DESCRIPTION_TOO_THIN`). Le décor doit donc porter une annonce plausible, pas le mot « desc ».
  description: 'Nous recherchons un vendeur pour notre boutique parisienne. Vous accueillez la clientèle, '
    + 'conseillez sur nos collections et participez à la tenue du point de vente.',
  applyUrl: 'https://x/1',
  postalCode: null, department: null, jobFunction: null, seniority: null, workTime: null, workplaceType: null,
  programType: null, engagementType: null, isSeasonal: null,
  experienceYears: null, educationLevel: null, salaryMin: null, salaryMax: null,
  salaryCurrency: null, salaryPeriod: null, validThrough: null,
  countryCode: 'FR', language: 'fr', firstSeenAt: new Date('2026-09-01T00:00:00Z'),
};

describe('jobPostingSchema', () => {
  it('keeps open applications out of vacancy structured data without excluding the page', () => {
    expect(jobPostingSchema({ ...base, opportunityType: 'OPEN_APPLICATION' })).toBeNull();
    expect(jobPostingSchema({ ...base, opportunityType: 'JOB_OPENING' })).not.toBeNull();
  });
  it('never substitutes discovery for an absent or invalid employer publication date', () => {
    expect(jobPostingSchema({ ...base, postedAt: null })).toBeNull();
    expect(jobPostingSchema({ ...base, postedAt: new Date('invalid') })).toBeNull();
  });

  it('keeps the employer publication date and omits an unknown deadline', () => {
    const schema = jobPostingSchema(base)!;
    expect(schema.datePosted).toBe('2026-08-20T00:00:00.000Z');
    expect(JSON.parse(JSON.stringify(schema))).not.toHaveProperty('validThrough');
  });

  /**
   * Révisé le 2026-09-11 (arbitrage du propriétaire). Une échéance DÉPASSÉE annonce au moteur un poste clos :
   * la page peut rester visible, mais **aucun balisage n'est émis**. Auparavant le `validThrough` périmé était
   * publié tel quel — honnête sur la date, mais trompeur sur l'offre. Mesuré : 257 offres actives concernées,
   * dates réelles venues des sources, qu'aucun run ne peut rafraîchir tant que les crons sont gelés.
   */
  it('émet AUCUN balisage quand l\'échéance de la source est dépassée', () => {
    expect(jobPostingSchema({ ...base, validThrough: new Date('2026-08-01T00:00:00Z') },
      new Date('2026-09-11T00:00:00Z'))).toBeNull();
  });

  it('publie une échéance encore future telle que la source la donne', () => {
    const schema = jobPostingSchema({ ...base, validThrough: new Date('2026-12-01T00:00:00Z') },
      new Date('2026-09-11T00:00:00Z'))!;
    expect(schema.validThrough).toBe('2026-12-01T00:00:00.000Z');
  });

  it('prefers the source datePosted and a still-future validThrough', () => {
    const schema = jobPostingSchema({
      ...base,
      postedAt: new Date('2026-09-02T00:00:00Z'),
      validThrough: new Date('2026-09-20T00:00:00Z'),
    })!;
    expect(schema.datePosted).toBe('2026-09-02T00:00:00.000Z');
    expect(schema.validThrough).toBe('2026-09-20T00:00:00.000Z');
  });

  it('does not publish a salary with an invented currency', () => {
    for (const amounts of [{ salaryMin: 50000 }, { salaryMax: 70000 }]) {
      const schema = jobPostingSchema({ ...base, ...amounts, salaryCurrency: null })!;
      expect(JSON.parse(JSON.stringify(schema))).not.toHaveProperty('baseSalary');
    }
  });

  it('preserves a known salary currency and period', () => {
    const schema = jobPostingSchema({ ...base, salaryMin: 20, salaryMax: 30, salaryCurrency: 'USD', salaryPeriod: 'HOUR' })!;
    expect(schema.baseSalary).toEqual({
      '@type': 'MonetaryAmount', currency: 'USD',
      value: { '@type': 'QuantitativeValue', minValue: 20, maxValue: 30, unitText: 'HOUR' },
    });
  });

  it('maps addressCountry from the source value, never a default', () => {
    const fr = jobPostingSchema(base) as { jobLocation: { address: Record<string, unknown> } };
    expect(fr.jobLocation.address.addressCountry).toBe('FR');

    const it_ = jobPostingSchema({ ...base, countryCode: 'IT' }) as typeof fr;
    expect(it_.jobLocation.address.addressCountry).toBe('IT');

    // Unknown country: the field is OMITTED — a Milan offer must never say FR.
    const unknown = jobPostingSchema({ ...base, countryCode: null }) as typeof fr;
    expect('addressCountry' in unknown.jobLocation.address).toBe(false);
  });

  it('declares the aggregator honestly: identifier + directApply false', () => {
    const schema = jobPostingSchema(base)!;
    expect(schema.directApply).toBe(false);
    expect(schema.identifier).toEqual({ '@type': 'PropertyValue', name: 'Cartier', value: 'ck123' });
    expect(schema.inLanguage).toBe('fr');
  });
});

/**
 * La TRADUCTION vers schema.org, à la frontière.
 *
 * Google mélange dans un seul champ ce que notre base sépare en quatre
 * dimensions : rythmes, durées, dispositifs et natures juridiques y cohabitent.
 * On parle sa langue en sortie sans jamais re-mélanger le modèle interne.
 */
describe('schemaEmploymentTypes', () => {
  it('traduit chaque dimension vers le vocabulaire de Google', () => {
    expect(schemaEmploymentTypes('FIXED_TERM', null)).toEqual(['TEMPORARY']);
    expect(schemaEmploymentTypes('TEMPORARY', null)).toEqual(['TEMPORARY']);
    expect(schemaEmploymentTypes(null, null, 'INTERNSHIP')).toEqual(['INTERN']);
    expect(schemaEmploymentTypes(null, null, 'APPRENTICESHIP')).toEqual(['INTERN']);
    expect(schemaEmploymentTypes(null, null, null, 'FREELANCE')).toEqual(['CONTRACTOR']);
    expect(schemaEmploymentTypes(null, null, null, 'INDEPENDENT_CONTRACTOR')).toEqual(['CONTRACTOR']);
    expect(schemaEmploymentTypes(null, 'FULL_TIME')).toEqual(['FULL_TIME']);
    expect(schemaEmploymentTypes(null, 'PART_TIME')).toEqual(['PART_TIME']);
  });

  /**
   * `PERMANENT` n'existe pas dans l'énumération de schema.org : le permanent s'y
   * déduit de l'ABSENCE de TEMPORARY. On n'invente donc pas « FULL_TIME », qui
   * serait un rythme affirmé sans preuve.
   */
  it('un poste permanent n’invente pas un rythme', () => {
    expect(schemaEmploymentTypes('PERMANENT', null)).toEqual([]);
    expect(schemaEmploymentTypes('PERMANENT', 'FULL_TIME')).toEqual(['FULL_TIME']);
  });

  /** Les dimensions étant cumulables, plusieurs valeurs peuvent sortir ensemble. */
  it('cumule les dimensions présentes', () => {
    expect(schemaEmploymentTypes('FIXED_TERM', 'PART_TIME')).toEqual(['TEMPORARY', 'PART_TIME']);
    expect(schemaEmploymentTypes(null, 'FULL_TIME', 'INTERNSHIP')).toEqual(['INTERN', 'FULL_TIME']);
  });

  it('rend un tableau vide plutôt qu’une supposition', () => {
    expect(schemaEmploymentTypes(null, null)).toEqual([]);
  });
});

/**
 * LES QUATRE SCÉNARIOS DE RÉCEPTION (P5, bloc final du 2026-09-11).
 *
 * Ils portent sur la distinction que le lot impose : **visible sur Mode Careers** et **éligible au balisage** sont
 * deux questions différentes. Une page peut rester servie sans qu'aucun `JobPosting` ne soit émis.
 *
 * Les motifs sont testés par `markupIneligibility`, la MÊME fonction que celle qui garde `jobPostingSchema` :
 * un contrôle qui réimplémenterait ces conditions finirait par en diverger.
 */
describe('éligibilité au balisage — quatre scénarios de réception', () => {
  const NOW = new Date('2026-09-11T12:00:00Z');

  it('1. offre datée mais sans description complète → visible, AUCUN JobPosting', () => {
    // Mesuré en production : 124 offres actives sans description, 353 sous le seuil, sur 78 932.
    for (const description of [null, '', 'Vendeur H/F', 'Poste à pourvoir.']) {
      const job = { ...base, description } as JobRow;
      expect(markupIneligibility(job, NOW)).toContain('DESCRIPTION_TOO_THIN');
      expect(jobPostingSchema(job, NOW)).toBeNull();
    }
    // La date seule ne suffit plus : c'était exactement le défaut du compte de 77 482.
    expect(base.postedAt).not.toBeNull();
  });

  it('2. offre active avec validThrough passé → visible si voulu, AUCUN JobPosting', () => {
    const job = { ...base, validThrough: new Date('2026-09-06T16:00:00Z') } as JobRow;
    expect(markupIneligibility(job, NOW)).toContain('VALID_THROUGH_EXPIRED');
    expect(jobPostingSchema(job, NOW)).toBeNull();
    // La date de la source n'est ni réécrite ni prolongée : elle reste ce qu'elle est.
    expect(job.validThrough?.toISOString()).toBe('2026-09-06T16:00:00.000Z');
  });

  it('3. offre à PLUSIEURS lieux physiques → tableau jobLocation cohérent avec la source', () => {
    /**
     * Cas réel mesuré : « Hong Kong; Shanghai, Shanghai, China; Shenzhen Shi, Guangdong, China ». La colonne
     * `city` a agrégé ces noms en « China Hong Kong Shanghai » — qui n'est pas une ville et ne doit pas être
     * publiée comme `addressLocality`. Le balisage repart donc du libellé énuméré.
     */
    const job = { ...base, city: 'China Hong Kong Shanghai', countryCode: 'CN',
      location: 'Hong Kong; Shanghai, Shanghai, China; Shenzhen Shi, Guangdong, China' } as JobRow;
    const schema = jobPostingSchema(job, NOW)!;
    const places = schema.jobLocation as Array<Record<string, any>>;
    expect(Array.isArray(places)).toBe(true);
    expect(places).toHaveLength(3);
    expect(places.map((pl) => pl.address.addressLocality)).toEqual([
      'Hong Kong', 'Shanghai, Shanghai, China', 'Shenzhen Shi, Guangdong, China',
    ]);
    // L'agrégat trompeur n'apparaît nulle part.
    expect(JSON.stringify(schema)).not.toContain('China Hong Kong Shanghai');
    // Un seul lieu reste un objet, pas un tableau : on ne change pas la forme sans raison.
    expect(Array.isArray(jobPostingSchema(base, NOW)!.jobLocation)).toBe(false);
  });

  it('4. offre 100 % distante → TELECOMMUTE et restriction géographique quand elle est connue', () => {
    const job = { ...base, workplaceType: 'REMOTE', city: 'New York', countryCode: 'US',
      location: 'New York, US' } as JobRow;
    const schema = jobPostingSchema(job, NOW)!;
    expect(schema.jobLocationType).toBe('TELECOMMUTE');
    expect(schema.applicantLocationRequirements).toEqual({ '@type': 'Country', name: 'US' });
    // Le rattachement nommé par la source est conservé : c'est une information vraie.
    expect((schema.jobLocation as any).address.addressLocality).toBe('New York');
  });

  it('4b. distante sans pays connu → TELECOMMUTE sans restriction inventée', () => {
    // On n'invente pas une restriction géographique : son absence est une absence, pas un « monde entier ».
    const job = { ...base, workplaceType: 'REMOTE', city: null, countryCode: null, location: null } as JobRow;
    // Sans lieu ni pays, l'offre n'est pas localisable du tout : pas de balisage.
    expect(markupIneligibility(job, NOW)).toContain('NO_USABLE_LOCATION');
    expect(jobPostingSchema(job, NOW)).toBeNull();
  });

  it('nomme chaque motif d\'inéligibilité séparément, et ne cumule rien à tort', () => {
    expect(markupIneligibility(base, NOW)).toEqual([]);
    expect(markupIneligibility({ ...base, postedAt: null } as JobRow, NOW)).toEqual(['NO_REAL_POSTED_DATE']);
    expect(markupIneligibility({ ...base, company: '' } as JobRow, NOW)).toEqual(['NO_HIRING_ORGANIZATION']);
    expect(markupIneligibility({ ...base, url: 'mailto:rh@example.com' } as JobRow, NOW)).toEqual(['NO_APPLY_PATH']);
    // Plusieurs défauts → plusieurs motifs, chacun nommé.
    expect(markupIneligibility({ ...base, postedAt: null, description: '' } as JobRow, NOW))
      .toEqual(['NO_REAL_POSTED_DATE', 'DESCRIPTION_TOO_THIN']);
  });
});

describe('« Remote » n\'est jamais publié comme un lieu', () => {
  const NOW = new Date('2026-09-11T12:00:00Z');

  it('retire le segment « Remote » d\'une énumération de lieux', () => {
    // Cas réel mesuré sur les pages servies : « Lehi, Utah, United States; Remote » publiait
    // `addressLocality: "Remote"` — une ville qui n'existe pas. Le télétravail se dit par `jobLocationType`.
    const job = { ...base, city: null, countryCode: 'US', location: 'Lehi, Utah, United States; Remote' } as JobRow;
    const schema = jobPostingSchema(job, NOW)!;
    expect(JSON.stringify(schema)).not.toContain('"Remote"');
    // Un seul lieu réel subsiste : la forme redevient un objet, et la localité est celle de la source.
    expect(Array.isArray(schema.jobLocation)).toBe(false);
    expect((schema.jobLocation as any).address.addressLocality).toBe('Lehi, Utah, United States');
  });

  it('n\'émet aucune localité vide quand la source n\'en donne pas', () => {
    const job = { ...base, city: null, countryCode: 'US', location: 'Remote' } as JobRow;
    const schema = jobPostingSchema(job, NOW)!;
    const address = (schema.jobLocation as any).address;
    expect(address).not.toHaveProperty('addressLocality');
    expect(address.addressCountry).toBe('US');
  });
});
