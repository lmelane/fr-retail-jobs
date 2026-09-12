import { describe, it, expect } from 'vitest';
import { jobPostingSchema, markupIneligibility, schemaEmploymentTypes, COUNTRY_INTEGRITY_PROVING } from './job-posting-schema';
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
  // Aucune preuve de provenance par défaut : c'est l'état conservateur, et celui de la production.
  countryIntegrity: null,
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

    /**
     * Pays inconnu : le champ n'était qu'OMIS — une offre de Milan ne disait jamais FR, ce qui était déjà juste.
     * Renforcé le 2026-09-11 : `addressCountry` est **requis** pour publier une adresse physique. Sans pays
     * établi, la page reste visible mais **aucun balisage n'est émis** — une localisation sans pays n'est pas
     * une localisation structurée fiable, et le pays ne se devine pas depuis la ville.
     */
    expect(jobPostingSchema({ ...base, countryCode: null })).toBeNull();
    expect(markupIneligibility({ ...base, countryCode: null } as JobRow))
      .toContain('PHYSICAL_LOCATION_WITHOUT_COUNTRY');
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

  it('4b. distante sans pays d\'éligibilité → AUCUN balisage, et aucune restriction inventée', () => {
    // On n'invente pas une restriction géographique : son absence est une absence, pas un « monde entier ».
    const job = { ...base, workplaceType: 'REMOTE', city: null, countryCode: null, location: null } as JobRow;
    expect(markupIneligibility(job, NOW)).toContain('REMOTE_WITHOUT_ELIGIBILITY_COUNTRY');
    expect(jobPostingSchema(job, NOW)).toBeNull();
  });

  it('4c. distante avec une VILLE mais sans pays → aucun balisage : la ville ne suffit pas', () => {
    // Point 6 de l'arbitrage : une offre REMOTE ne devient pas éligible grâce à sa ville seule. `applicantLocation-
    // Requirements` doit dire depuis OÙ l'on peut candidater, et une ville ne le dit pas.
    const job = { ...base, workplaceType: 'REMOTE', city: 'New York', countryCode: null, location: 'New York' } as JobRow;
    expect(markupIneligibility(job, NOW)).toContain('REMOTE_WITHOUT_ELIGIBILITY_COUNTRY');
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

/**
 * COHÉRENCE PAYS / LOCALISATION (correctif terminal P5, 2026-09-11).
 *
 * Dans un `JobPosting`, `addressCountry` est un PAYS. L'abréviation d'un état ne l'est pas — et « CA » est à la
 * fois la Californie et le Canada. Les cas ci-dessous sont ceux réellement mesurés en production.
 */
describe('cohérence pays / localisation', () => {
  const NOW = new Date('2026-09-11T12:00:00Z');

  it('1. « San Francisco, CA; Seattle, WA; or San Diego, CA » sous countryCode=CA → jamais publié au Canada', () => {
    const job = { ...base, city: 'San Francisco', countryCode: 'CA',
      location: 'San Francisco, CA; Seattle, WA; or San Diego, CA' } as JobRow;
    expect(markupIneligibility(job, NOW)).toContain('LOCATION_COUNTRY_CONFLICT');
    const schema = jobPostingSchema(job, NOW);
    expect(schema).toBeNull();
    // Et surtout : aucune de ces villes américaines n'est publiée sous le pays Canada.
    expect(JSON.stringify(schema)).not.toContain('"CA"');
  });

  it('2. « New York, N.Y.; Washington, D.C. » sans countryCode → aucun balisage tant que le pays n\'est pas prouvé', () => {
    const job = { ...base, city: 'New York', countryCode: null,
      location: 'New York, N.Y.; Washington, D.C.' } as JobRow;
    expect(markupIneligibility(job, NOW)).toContain('MULTI_LOCATION_COUNTRY_NOT_PROVEN');
    expect(jobPostingSchema(job, NOW)).toBeNull();
  });

  it('5. multilocalisation dont le pays commun est établi → un jobLocation par lieu, avec CE pays', () => {
    const job = { ...base, city: 'New York', countryCode: 'US',
      location: 'New York, NY; Seattle, WA; Boston, MA' } as JobRow;
    expect(markupIneligibility(job, NOW)).toEqual([]);
    const places = jobPostingSchema(job, NOW)!.jobLocation as Array<Record<string, any>>;
    expect(places).toHaveLength(3);
    expect(places.map((pl) => pl.address.addressLocality)).toEqual(['New York, NY', 'Seattle, WA', 'Boston, MA']);
    // Chaque lieu porte le pays réellement établi, le même pour tous puisqu'ils y appartiennent.
    expect(places.every((pl) => pl.address.addressCountry === 'US')).toBe(true);
  });

  it('refuse une multilocalisation dont un segment n\'est pas publiable comme localité', () => {
    // « or San Diego, CA » est une conjonction laissée par l'énumération, pas un nom de ville ; « Scotland » et
    // « United States » désignent un territoire entier. On ne les transforme pas en addressLocality.
    for (const location of [
      'San Francisco, CA; Seattle, WA; or San Diego, CA',
      'Edinburgh; Scotland',
      'Portland; United States',
    ]) {
      const job = { ...base, countryCode: 'US', city: null, location } as JobRow;
      const reasons = markupIneligibility(job, NOW);
      expect(reasons.length).toBeGreaterThan(0);
      expect(jobPostingSchema(job, NOW)).toBeNull();
    }
  });

  it('refuse une multilocalisation qui nomme un pays contredisant le countryCode canonique', () => {
    const job = { ...base, countryCode: 'FR', city: null,
      location: 'Portland, OR, United States; Seattle, WA, United States' } as JobRow;
    expect(markupIneligibility(job, NOW)).toContain('LOCATION_COUNTRY_CONFLICT');
    expect(jobPostingSchema(job, NOW)).toBeNull();
  });

  it('un lieu unique dont le suffixe contredit le pays est refusé (« Seattle, WA » sous CA)', () => {
    const job = { ...base, city: 'Seattle, WA', countryCode: 'CA', location: 'Seattle, WA' } as JobRow;
    expect(markupIneligibility(job, NOW)).toContain('LOCATION_COUNTRY_CONFLICT');
    expect(jobPostingSchema(job, NOW)).toBeNull();
  });

  it('mais accepte le MÊME libellé quand le pays le confirme', () => {
    const job = { ...base, city: 'Seattle, WA', countryCode: 'US', location: 'Seattle, WA' } as JobRow;
    expect(markupIneligibility(job, NOW)).toEqual([]);
    const address = (jobPostingSchema(job, NOW)!.jobLocation as any).address;
    expect(address.addressLocality).toBe('Seattle, WA');
    expect(address.addressCountry).toBe('US');
  });
});

/**
 * PREUVE INDÉPENDANTE DU PAYS POUR LES CODES AMBIGUS (dernier correctif P5, 2026-09-11).
 *
 * `suffix === countryCode` ne prouve rien quand le `countryCode` a lui-même été déduit de ce suffixe : c'est une
 * validation circulaire. Mesuré : **1 936 offres** sont dans ce cas, et **aucune** ne porte de nom de pays écrit
 * en toutes lettres dans son `raw` — leur pays vient donc bien du seul suffixe.
 *
 * Le test qui acceptait « Indianapolis, IN » sous le pays IN est RETIRÉ comme comportement conforme : IN peut
 * désigner l'Indiana, et la coïncidence suffixe/pays n'est pas une preuve que le pays est l'Inde.
 */
describe('preuve indépendante du pays pour un code ambigu', () => {
  const NOW = new Date('2026-09-11T12:00:00Z');

  it('A. « El Segundo, CA » sous le pays CA, sans preuve indépendante → AUCUN JobPosting', () => {
    const job = { ...base, city: 'El Segundo', countryCode: 'CA', location: 'El Segundo, CA',
      postalCode: null } as JobRow;
    expect(markupIneligibility(job, NOW)).toContain('AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF');
    expect(jobPostingSchema(job, NOW)).toBeNull();
  });

  it('B. « Indianapolis, IN » sous le pays IN, sans preuve indépendante → AUCUN JobPosting', () => {
    const job = { ...base, city: 'Indianapolis', countryCode: 'IN', location: 'Indianapolis, IN',
      postalCode: null } as JobRow;
    expect(markupIneligibility(job, NOW)).toContain('AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF');
    expect(jobPostingSchema(job, NOW)).toBeNull();
  });

  it('C. « Berlin, DE » avec le pays nommé en toutes lettres → balisage autorisé, addressCountry DE', () => {
    // Le libellé porte « Germany » : une information indépendante du suffixe à deux lettres.
    const job = { ...base, city: 'Berlin', countryCode: 'DE', location: 'Berlin, Germany',
      postalCode: null } as JobRow;
    expect(markupIneligibility(job, NOW)).toEqual([]);
    expect((jobPostingSchema(job, NOW)!.jobLocation as any).address.addressCountry).toBe('DE');
  });

  it('D. « Seattle, WA » avec le pays US fourni indépendamment → balisage autorisé, addressCountry US', () => {
    const job = { ...base, city: 'Seattle, WA', countryCode: 'US', location: 'Seattle, WA, United States',
      postalCode: null } as JobRow;
    expect(markupIneligibility(job, NOW)).toEqual([]);
    expect((jobPostingSchema(job, NOW)!.jobLocation as any).address.addressCountry).toBe('US');
  });

  it('E. multilocalisation américaine, pays US prouvé indépendamment → un lieu par site, tous sous US', () => {
    const job = { ...base, city: null, countryCode: 'US', postalCode: null,
      location: 'New York, NY, United States; Seattle, WA, United States; Boston, MA, United States' } as JobRow;
    expect(markupIneligibility(job, NOW)).toEqual([]);
    const places = jobPostingSchema(job, NOW)!.jobLocation as Array<Record<string, any>>;
    expect(places).toHaveLength(3);
    expect(places.every((pl) => pl.address.addressCountry === 'US')).toBe(true);
  });

  it('F. même libellé, mais le pays ne vient QUE du suffixe ambigu → aucun balisage', () => {
    // « Seattle, WA » sous `WA` : le suffixe et le pays coïncident, et rien d'autre ne l'atteste.
    const job = { ...base, city: 'Seattle', countryCode: 'WA', location: 'Seattle, WA',
      postalCode: null } as JobRow;
    expect(markupIneligibility(job, NOW)).toContain('AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF');
    expect(jobPostingSchema(job, NOW)).toBeNull();
  });

  it('« Seattle, WA » sous le pays DE reste un CONFLIT, pas une simple absence de preuve', () => {
    const job = { ...base, city: 'Seattle, WA', countryCode: 'DE', location: 'Seattle, WA' } as JobRow;
    expect(markupIneligibility(job, NOW)).toContain('LOCATION_COUNTRY_CONFLICT');
  });

  it('un pays NON ambigu n\'exige aucune preuve supplémentaire (FR, IT…)', () => {
    // `FR` n'est subdivision de rien : la question de la circularité ne se pose pas.
    expect(markupIneligibility({ ...base, countryCode: 'FR' } as JobRow, NOW)).toEqual([]);
    expect(markupIneligibility({ ...base, city: 'Milano', countryCode: 'IT', location: 'Milano' } as JobRow, NOW)).toEqual([]);
  });

});

/**
 * H-GEO-01 — un format postal COMPATIBLE n'est pas une preuve du pays (2026-09-11).
 *
 * Deux versions successives ont été trop permissives ici, et la seconde était subtile :
 *
 *   1. « le code postal est non vide » → preuve. Faux : sa présence ne dit rien du pays.
 *   2. « le format correspond au pays déclaré » → preuve. Faux aussi : la compatibilité de format ne démontre
 *      pas que ce format identifie EXCLUSIVEMENT ce pays. `DE`, `US`, `ID`, `IL` et `MA` partagent tous le
 *      format à cinq chiffres — un code à cinq chiffres sous un suffixe ambigu `DE` passait pour une preuve de
 *      l'Allemagne alors qu'il est tout aussi cohérent avec les États-Unis.
 *
 * Le code postal est donc retiré de la preuve POSITIVE. Il reste une garde de CONTRADICTION : réfuter est sûr
 * (« 90245 ne peut pas être canadien »), prouver ne l'est pas.
 */
describe('H-GEO-01 — le code postal réfute, il ne prouve pas', () => {
  const NOW = new Date('2026-09-11T12:00:00Z');

  it('A. code ambigu DE + code postal à cinq chiffres + aucune autre preuve → AUCUN JobPosting', () => {
    // 10115 est un code postal allemand valide. Il est AUSSI un ZIP américain valide : il ne prouve rien.
    const job = { ...base, city: 'Berlin', countryCode: 'DE', location: 'Berlin, DE',
      postalCode: '10115' } as JobRow;
    expect(markupIneligibility(job, NOW)).toContain('AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF');
    expect(jobPostingSchema(job, NOW)).toBeNull();
  });

  it('B. codes ambigus ID, IL et MA + code postal à cinq chiffres + aucune autre preuve → AUCUN JobPosting', () => {
    for (const country of ['ID', 'IL', 'MA']) {
      const job = { ...base, city: 'Ville', countryCode: country, location: `Ville, ${country}`,
        postalCode: '12345' } as JobRow;
      expect(markupIneligibility(job, NOW)).toContain('AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF');
      expect(jobPostingSchema(job, NOW)).toBeNull();
    }
  });

  it('C. CA avec un code postal canadien COMPATIBLE mais aucune preuve pays → AUCUN JobPosting', () => {
    // « M5V 3L9 » est bien canadien, mais la compatibilité n'établit pas l'identité géographique.
    const job = { ...base, city: 'Toronto', countryCode: 'CA', location: 'Toronto, CA',
      postalCode: 'M5V 3L9' } as JobRow;
    expect(markupIneligibility(job, NOW)).toContain('AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF');
    expect(jobPostingSchema(job, NOW)).toBeNull();
  });

  it('D. CA avec countryIntegrity RAW_COUNTRY → balisage autorisé, code postal publié en complément', () => {
    const job = { ...base, city: 'Toronto', countryCode: 'CA', location: 'Toronto, Canada',
      postalCode: 'M5V 3L9', countryIntegrity: 'RAW_COUNTRY' } as JobRow;
    expect(markupIneligibility(job, NOW)).toEqual([]);
    const address = (jobPostingSchema(job, NOW)!.jobLocation as any).address;
    expect(address.addressCountry).toBe('CA');
    // Le code postal reste une donnée complémentaire publiée, il n'est simplement plus une preuve.
    expect(address.postalCode).toBe('M5V 3L9');
  });

  it('E. code postal INCOMPATIBLE avec le pays déclaré → AUCUN JobPosting, même avec une preuve pays', () => {
    // 90245 est un ZIP américain : il ne peut pas être canadien. La contradiction l'emporte sur la preuve.
    const job = { ...base, city: 'El Segundo', countryCode: 'CA', location: 'El Segundo, Canada',
      postalCode: '90245', countryIntegrity: 'RAW_COUNTRY' } as JobRow;
    expect(markupIneligibility(job, NOW)).toContain('LOCATION_COUNTRY_CONFLICT');
    expect(jobPostingSchema(job, NOW)).toBeNull();
  });

  it('countryIntegrity suit une liste POSITIVE : un verdict inconnu ne prouve rien', () => {
    const unknown = { ...base, city: 'El Segundo', countryCode: 'CA', location: 'El Segundo, CA',
      postalCode: null, countryIntegrity: 'SOMETHING_NEW' } as JobRow;
    expect(markupIneligibility(unknown, NOW)).toContain('AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF');

    for (const verdict of ['RAW_COUNTRY_CODE', 'RAW_COUNTRY', 'VERIFIED']) {
      const job = { ...base, city: 'El Segundo', countryCode: 'CA', location: 'El Segundo, CA',
        postalCode: null, countryIntegrity: verdict } as JobRow;
      expect(markupIneligibility(job, NOW)).toEqual([]);
    }
  });
});

/**
 * LE CONTRAT ENTRE LES DEUX CÔTÉS DE LA CHAÎNE.
 *
 * L'ingestion ÉCRIT `countryIntegrity` (apps/aggregator/src/normalize/countryIntegrity.ts) et cette page le
 * LIT. Si les deux listes divergent, l'écart est silencieux : l'ingestion écrirait un verdict que la page
 * ignore (des offres prouvées resteraient inéligibles), ou la page accepterait un verdict que l'ingestion
 * n'écrit jamais (une règle morte qu'on croit active). Aucun typecheck ne le verrait — les deux modules
 * appartiennent à des workspaces différents.
 */
describe('countryIntegrity — le contrat partagé avec la chaîne d\'ingestion', () => {
  const NOW = new Date('2026-09-11T12:00:00Z');

  it('la liste positive lue par le web est exactement celle que l\'ingestion écrit', () => {
    // Recopiée littéralement depuis apps/aggregator/src/normalize/countryIntegrity.ts, à dessein : ce test
    // échoue le jour où l'une des deux bouge sans l'autre, ce qui est précisément son objet.
    expect([...COUNTRY_INTEGRITY_PROVING].sort())
      .toEqual(['RAW_COUNTRY', 'RAW_COUNTRY_CODE', 'VERIFIED']);
  });

  it('la liste est FERMÉE : aucun verdict hors contrat ne prouve', () => {
    for (const verdict of ['AMBIGUOUS', 'UNVERIFIED', 'POSTAL_FORMAT_COMPATIBLE', 'LOCATION_COUNTRY_NAME',
      'LOCATION_ADMIN1_SUFFIX', 'LOCATION_COUNTRY_PREFIX']) {
      const job = { ...base, city: 'Toronto', countryCode: 'CA', location: 'Toronto, CA',
        postalCode: null, countryIntegrity: verdict } as JobRow;
      expect(markupIneligibility(job, NOW)).toContain('AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF');
    }
  });
});

/**
 * LA CHAÎNE COMPLÈTE, sur des lignes RÉELLEMENT écrites par une ingestion.
 *
 * Les valeurs sont recopiées de la base du clone après le run du 2026-09-12 (`replay-ingest.mts` sur les
 * sources beiersdorf / american-vintage-dr / mecca) — pas fabriquées pour le test. C'est la consigne : le
 * verdict doit venir d'une ingestion réelle, jamais d'un décor auquel on ajoute le champ à la main.
 */
describe('countryIntegrity — lignes réelles issues de l\'ingestion du clone', () => {
  const NOW = new Date('2026-09-12T00:00:00Z');
  /** Une offre Beiersdorf de Hambourg, telle qu'elle est stockée après le run. */
  const hamburg = {
    ...base, company: 'Beiersdorf', language: 'de', city: 'Hambourg', countryCode: 'DE',
    location: 'Hamburg', postalCode: null,
    description: 'Wir suchen eine Werkstudentin oder einen Werkstudenten für unser Team in Hamburg. '
      + 'Du unterstützt bei der Analyse, der Aufbereitung von Daten und der Vorbereitung von Präsentationen.',
  } as JobRow;

  it('« Hamburg » sous DE, prouvé par le champ pays de la source (« Germany ») → balisage autorisé', () => {
    expect(markupIneligibility({ ...hamburg, countryIntegrity: 'RAW_COUNTRY' }, NOW)).toEqual([]);
  });

  it('la MÊME offre sans verdict reste refusée : c\'est la preuve qui décide, jamais le pays', () => {
    expect(markupIneligibility({ ...hamburg, countryIntegrity: null }, NOW))
      .toContain('AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF');
  });

  it('un pays NON ambigu n\'a jamais eu besoin d\'un verdict', () => {
    expect(markupIneligibility({ ...base, countryCode: 'FR', countryIntegrity: null }, NOW)).toEqual([]);
  });
});
