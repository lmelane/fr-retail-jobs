import { describe, expect, it } from 'vitest';
import { createObserver, EVALUATOR_VERSION, type Observation } from './contradictions.js';
import { evaluate, precedenceFor, MIN_EVIDENCE, TRUST_LEVELS } from './verdict.js';

/**
 * `sourceFieldTrust` — la fiabilité d'une PREUVE, mesurée puis jugée.
 *
 * Née du cas PVH (2026-09-08) : `employmentType: FULL_TIME` sur 1 372 offres,
 * dont 485 dont le titre dit « Part-Time ». Un champ « structuré » n'est donc
 * pas automatiquement une source de vérité.
 *
 * Règle de méthode (Loïc) : on MESURE d'abord, une règle DÉTERMINISTE décide
 * ensuite. Aucune exception nommée dans un normaliseur, aucun score arbitraire.
 */

const obs = (over: Partial<Observation> = {}): Observation => ({
  source: 's', path: 'employmentType', dimension: 'workTime',
  comparable: 100, agreements: 99, contradictions: 1, contradictionRate: 0.01,
  lastObservedAt: new Date('2026-09-08'), samples: [],
  ...over,
});
const NOW = new Date('2026-09-08T12:00:00Z');

describe('evaluate — quatre états déterministes', () => {
  it('n’expose que les quatre niveaux validés', () => {
    expect([...TRUST_LEVELS]).toEqual(['TRUSTED', 'DEGRADED', 'UNTRUSTED', 'INSUFFICIENT_EVIDENCE']);
  });

  it('un champ presque toujours d’accord est TRUSTED', () => {
    const v = evaluate(obs({ comparable: 500, contradictions: 5, contradictionRate: 0.01 }), EVALUATOR_VERSION, NOW);
    expect(v.level).toBe('TRUSTED');
  });

  it('un champ qui se trompe une fois sur cinq est DEGRADED', () => {
    const v = evaluate(obs({ comparable: 500, contradictions: 100, contradictionRate: 0.2 }), EVALUATOR_VERSION, NOW);
    expect(v.level).toBe('DEGRADED');
  });

  /** Le cas PVH : 485 contradictions sur 485 observations comparables. */
  it('un champ qui se trompe plus d’une fois sur trois est UNTRUSTED', () => {
    const v = evaluate(obs({ comparable: 485, contradictions: 485, contradictionRate: 1 }), EVALUATOR_VERSION, NOW);
    expect(v.level).toBe('UNTRUSTED');
    expect(v.reason).toContain('485 contradictions sur 485');
  });

  /**
   * Sans plancher, une source publiant trois offres serait condamnée par un
   * seul titre mal rédigé. « 20 sur 25 » et « 20 sur 10 000 » diffèrent.
   */
  it('ne juge pas sous le minimum d’observations', () => {
    const v = evaluate(
      obs({ comparable: MIN_EVIDENCE - 1, contradictions: MIN_EVIDENCE - 1, contradictionRate: 1 }),
      EVALUATOR_VERSION, NOW,
    );
    expect(v.level).toBe('INSUFFICIENT_EVIDENCE');
    expect(v.reason).toContain(`minimum ${MIN_EVIDENCE}`);
  });

  /**
   * Une source peut RÉPARER son flux : une anomalie de septembre ne condamne
   * pas à vie. Passé le délai, le verdict retombe faute de preuve fraîche.
   */
  it('oublie une observation trop ancienne plutôt que de condamner à vie', () => {
    const v = evaluate(
      obs({ comparable: 500, contradictions: 500, contradictionRate: 1, lastObservedAt: new Date('2026-05-01') }),
      EVALUATOR_VERSION, NOW,
    );
    expect(v.level).toBe('INSUFFICIENT_EVIDENCE');
    expect(v.reason).toContain('le flux a pu changer');
  });

  it('porte la version de l’évaluateur et la raison', () => {
    const v = evaluate(obs(), EVALUATOR_VERSION, NOW);
    expect(v.evaluatorVersion).toBe(EVALUATOR_VERSION);
    expect(v.reason.length).toBeGreaterThan(10);
    expect(v.evidenceCount).toBe(100);
  });
});

describe('precedenceFor — une preuve démontrée fausse est ÉCARTÉE', () => {
  const DEFAULT_ORDER = ['STRUCTURED', 'TITLE_EXPLICIT', 'TITLE_INFERRED', 'DESCRIPTION'];

  it('par défaut, le champ structuré prime', () => {
    expect(precedenceFor('TRUSTED')).toEqual(DEFAULT_ORDER);
    expect(precedenceFor(undefined)).toEqual(DEFAULT_ORDER);
    expect(precedenceFor('INSUFFICIENT_EVIDENCE')).toEqual(DEFAULT_ORDER);
  });

  /**
   * Écarté, pas pondéré : une preuve connue comme fausse ne doit pas pouvoir
   * l'emporter par accident de configuration.
   */
  it('UNTRUSTED : le champ n’est plus consulté du tout', () => {
    expect(precedenceFor('UNTRUSTED')).toEqual(['TITLE_EXPLICIT', 'TITLE_INFERRED', 'DESCRIPTION']);
    expect(precedenceFor('UNTRUSTED')).not.toContain('STRUCTURED');
  });

  /**
   * LE CAS « 21h » : une inférence ne bat PAS un champ seulement dégradé, alors
   * qu'un « Part-Time » déclaré le bat. C'est la conséquence logique du split.
   */
  it('DEGRADED : un titre EXPLICITE bat le champ, une INFÉRENCE non', () => {
    expect(precedenceFor('DEGRADED')).toEqual(['TITLE_EXPLICIT', 'STRUCTURED', 'TITLE_INFERRED', 'DESCRIPTION']);
    const order = precedenceFor('DEGRADED');
    expect(order.indexOf('TITLE_EXPLICIT')).toBeLessThan(order.indexOf('STRUCTURED'));
    expect(order.indexOf('TITLE_INFERRED')).toBeGreaterThan(order.indexOf('STRUCTURED'));
  });
});

describe('createObserver — la mesure', () => {
  const job = (title: string, raw: unknown) => ({
    sourceKey: 'pvh', title, description: null, raw, lastSeenAt: new Date('2026-09-08'),
  });

  /**
   * LE DÉNOMINATEUR. Une offre dont le titre ne dit rien ne prouve RIEN sur le
   * champ : elle ne doit pas gonfler le dénominateur et diluer un taux réel.
   */
  it('ne compte que les offres où les DEUX preuves se prononcent', () => {
    const o = createObserver();
    o.observe(job('Sales Associate - Part-Time', { employmentType: 'FULL_TIME' }));
    o.observe(job('Sales Associate', { employmentType: 'FULL_TIME' })); // titre muet
    const [r] = o.result();
    expect(r.comparable).toBe(1);
    expect(r.contradictions).toBe(1);
    expect(r.contradictionRate).toBe(1);
  });

  it('compte un accord comme un accord', () => {
    const o = createObserver();
    o.observe(job('Sales Associate - Full-Time', { employmentType: 'FULL_TIME' }));
    const [r] = o.result();
    expect(r.agreements).toBe(1);
    expect(r.contradictions).toBe(0);
  });

  /**
   * Le grain : `source × chemin × dimension`. Un champ faux pour le rythme ne
   * dit rien de sa fiabilité pour la durée.
   */
  it('sépare les dimensions d’un même champ', () => {
    const o = createObserver();
    o.observe(job('CDI - Vendeur Part-Time', { employmentType: 'fulltime_permanent' }));
    const dims = o.result().map((r) => r.dimension).sort();
    expect(dims).toContain('workTime');
    // La durée s'accorde (PERMANENT des deux côtés), le rythme se contredit.
    const wt = o.result().find((r) => r.dimension === 'workTime');
    const et = o.result().find((r) => r.dimension === 'employmentTerm');
    expect(wt?.contradictions).toBe(1);
    expect(et?.contradictions).toBe(0);
  });

  it('note le chemin exact, jamais la source seule', () => {
    const o = createObserver();
    o.observe(job('Vendeur Part-Time', { tags1: ['Full Time'] }));
    const [r] = o.result();
    expect(r.source).toBe('pvh');
    expect(r.path).toBe('tags1[0]');
  });

  it('garde des exemples réels pour qu’un humain juge sur pièces', () => {
    const o = createObserver();
    o.observe(job('Sales Associate - Part-Time', { employmentType: 'FULL_TIME' }));
    const [r] = o.result();
    expect(r.samples[0]).toMatchObject({ structured: 'FULL_TIME', fromTitle: 'PART_TIME' });
  });

  it('retient la dernière observation, pour que la confiance puisse vieillir', () => {
    const o = createObserver();
    o.observe({ ...job('Vendeur Part-Time', { employmentType: 'FULL_TIME' }), lastSeenAt: new Date('2026-01-01') });
    o.observe({ ...job('Vendeur Part-Time', { employmentType: 'FULL_TIME' }), lastSeenAt: new Date('2026-09-08') });
    const [r] = o.result();
    expect(r.lastObservedAt).toEqual(new Date('2026-09-08'));
  });
});

/**
 * LES RÈGLES DE PRIORITÉ, verrouillées — chacune vient d'un contrôle exigé par
 * Loïc avant d'autoriser l'écriture (2026-09-08).
 */
describe('garde-fous de la priorité', () => {
  /**
   * RÈGLE ABSOLUE : un triplet sous le seuil ne doit JAMAIS, à lui seul,
   * changer une valeur canonique.
   *
   * Le premier jet du simulateur lisait le verdict du chemin SUIVANT après
   * avoir filtré un chemin UNTRUSTED : un chemin INSUFFICIENT_EVIDENCE pouvait
   * alors influencer la décision. Le dry-run corrigé mesure 0 changement
   * imputable à ce niveau.
   */
  it('INSUFFICIENT_EVIDENCE conserve strictement la priorité par défaut', () => {
    expect(precedenceFor('INSUFFICIENT_EVIDENCE')).toEqual(precedenceFor(undefined));
    expect(precedenceFor('INSUFFICIENT_EVIDENCE')).toEqual(['STRUCTURED', 'TITLE_EXPLICIT', 'TITLE_INFERRED', 'DESCRIPTION']);
  });

  /** Un champ non prouvé faux garde la main : le titre ne le détrône pas. */
  it('TRUSTED n’est jamais détrôné par le titre', () => {
    expect(precedenceFor('TRUSTED')[0]).toBe('STRUCTURED');
  });

  /**
   * Seule une preuve DÉMONTRÉE fausse perd la priorité — et elle est écartée,
   * pas rétrogradée : une valeur connue comme fausse ne doit pas pouvoir
   * l'emporter par accident de configuration.
   */
  it('seul UNTRUSTED perd la priorité, et il est exclu', () => {
    const levels = ['TRUSTED', 'INSUFFICIENT_EVIDENCE'] as const;
    for (const l of levels) expect(precedenceFor(l)[0]).toBe('STRUCTURED');
    expect(precedenceFor('DEGRADED')[0]).toBe('TITLE_EXPLICIT');
    expect(precedenceFor('UNTRUSTED')).not.toContain('STRUCTURED');
  });
});
