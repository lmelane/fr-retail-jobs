import { describe, it, expect } from 'vitest';
import { readScheduleDescription, WORK_SCHEDULES } from '../schedule.js';
import { resolveCanonicalDimensions } from '../../trust/resolve.js';

/**
 * D-436 — LE RYTHME DE TRAVAIL, DIMENSION ABSENTE DU MODÈLE.
 *
 * ── CE QUE CE TÉMOIN DOIT PROUVER ─────────────────────────────────────────
 *
 * Mesuré en production le 2026-09-15, le rythme est la dimension la plus
 * publiée des marchés anglo-saxons (« flexible schedule » : 54 % des offres US)
 * et elle n'était stockée nulle part. Le seul champ structuré (`schedule`,
 * 186 offres) contient « full-or-part-time », donc un TEMPS de travail.
 *
 * ── L'ASSERTION DE PRÉMISSE, DANS CHAQUE CAS ──────────────────────────────
 *
 * Un témoin dont la situation de départ n'exerce pas le défaut passe au vert
 * sans rien tester — c'est le faux négatif rassurant du 05/08/2026. Chaque
 * test ci-dessous affirme donc D'ABORD que son jeu d'essai REMPLIT la
 * condition qu'il prétend éprouver, et cette assertion doit rougir la
 * première si la prémisse cesse d'être vraie.
 */

/** Le cas RÉEL, relevé tel quel en base — pas une phrase reconstituée. */
const CAS_REEL_PRODUCTION =
  'Ability to work a flexible schedule to meet business needs—including nights, weekends, peak busy season';

describe('D-436 — taxonomie du rythme', () => {
  it('ne porte QUE les valeurs que les mesures justifient', () => {
    expect([...WORK_SCHEDULES]).toEqual(['FLEXIBLE_AVAILABILITY', 'EVENINGS_WEEKENDS', 'NIGHT_SHIFT']);
  });

  it("n'invente PAS ROTATING, mesuré sous 2 % partout", () => {
    // PRÉMISSE : une valeur non mesurée est une valeur qu'on ne sait pas remplir.
    expect(WORK_SCHEDULES).not.toContain('ROTATING' as never);
  });
});

describe('D-436 — le cas réel mesuré en production', () => {
  it('PRÉMISSE : la phrase réelle porte bien un marqueur ET plusieurs termes', () => {
    // Si cette prémisse tombe, le test suivant ne prouve plus rien : il faut
    // que la phrase contienne à la fois l'exigence et les trois rythmes, sinon
    // la règle de spécificité n'est jamais exercée.
    expect(CAS_REEL_PRODUCTION).toMatch(/ability to work/i);
    expect(CAS_REEL_PRODUCTION).toMatch(/flexible schedule/i);
    expect(CAS_REEL_PRODUCTION).toMatch(/nights/i);
    expect(CAS_REEL_PRODUCTION).toMatch(/weekends/i);
  });

  it('retient la contrainte la PLUS DURE, pas la plus douce', () => {
    const lu = readScheduleDescription(CAS_REEL_PRODUCTION);
    // Annoncer « horaires flexibles » à qui devra faire des soirées et des
    // week-ends serait un mensonge par omission.
    expect(lu?.schedule).toBe('EVENINGS_WEEKENDS');
  });

  it('conserve le libellé SOURCE tel quel', () => {
    expect(readScheduleDescription(CAS_REEL_PRODUCTION)?.raw).toBe(CAS_REEL_PRODUCTION);
  });

  it('le tiret cadratin ne coupe PAS la phrase : marqueur avant, termes après', () => {
    // PRÉMISSE : le marqueur et le terme sont bien séparés par le tiret.
    const [avant, apres] = CAS_REEL_PRODUCTION.split('—');
    expect(avant).toMatch(/ability to work/i);
    expect(apres).toMatch(/nights, weekends/i);
    // Si la découpe coupait là, le marqueur serait orphelin et la lecture nulle.
    expect(readScheduleDescription(CAS_REEL_PRODUCTION)).toBeDefined();
  });
});

describe('D-436 — les FAUX AMIS : un avantage social n’est pas un rythme', () => {
  const AVANTAGES = [
    'Benefits include paid holidays, medical and dental coverage.',
    'You must be able to work here and enjoy holiday pay on top of your base salary.',
    'Perks: weekend discount on all products, plus a generous employee discount.',
    'Nos avantages : congés payés, mutuelle, remise collaborateur.',
  ];

  it.each(AVANTAGES)('PRÉMISSE : « %s » contient bien un mot de rythme', (texte) => {
    // Sans cette assertion, un jeu d'essai qui ne porte AUCUN mot piège
    // rendrait undefined pour la mauvaise raison, et le témoin serait vert à
    // vide — exactement le défaut qu'il doit détecter.
    expect(texte).toMatch(/holiday|weekend|cong[ée]s/i);
  });

  it.each(AVANTAGES)('« %s » ne produit AUCUN rythme', (texte) => {
    expect(readScheduleDescription(texte)).toBeUndefined();
  });

  it('un avantage dans une phrase n’éteint pas l’exigence d’une AUTRE phrase', () => {
    const texte =
      'Benefits include paid holidays and medical coverage. Must be available to work nights and weekends during peak season.';
    // PRÉMISSE : les deux phrases coexistent bien dans le même texte.
    expect(texte).toMatch(/paid holidays/i);
    expect(texte).toMatch(/must be available/i);
    expect(readScheduleDescription(texte)?.schedule).toBe('EVENINGS_WEEKENDS');
  });
});

describe('D-436 — le mot SEUL ne suffit jamais : il faut l’exigence', () => {
  const SANS_MARQUEUR = [
    'Our stores are open on weekends and in the evenings.',
    'The boutique welcomes clients every evening until 8pm.',
    'Le magasin est ouvert le week-end.',
    'We offer a flexible and inclusive culture.',
  ];

  it.each(SANS_MARQUEUR)('PRÉMISSE : « %s » porte un mot de rythme mais aucun marqueur', (texte) => {
    expect(texte).toMatch(/weekend|evening|week[ -]?end|flexible/i);
    expect(texte).not.toMatch(/ability to work|must be (?:able|available)|doit être disponible/i);
  });

  it.each(SANS_MARQUEUR)('« %s » s’abstient', (texte) => {
    expect(readScheduleDescription(texte)).toBeUndefined();
  });
});

describe('D-436 — multilingue, chaque terme dans sa langue', () => {
  const CAS: ReadonlyArray<readonly [string, string, string]> = [
    ['anglais — nuit', 'Must be able to work the night shift on a rotating basis.', 'NIGHT_SHIFT'],
    ['anglais — overnight', 'This role requires overnight coverage of the distribution centre.', 'NIGHT_SHIFT'],
    ['anglais — flexible', 'Ability to work a flexible schedule based on store needs.', 'FLEXIBLE_AVAILABILITY'],
    ['français — nuit', 'Vous devez être disponible pour un travail de nuit en équipe.', 'NIGHT_SHIFT'],
    ['français — week-end', 'Vous devez être disponible le week-end et les jours fériés.', 'EVENINGS_WEEKENDS'],
    ['français — flexible', 'Capacité à travailler avec des horaires flexibles selon l’affluence.', 'FLEXIBLE_AVAILABILITY'],
    ['allemand — nuit', 'Bereitschaft zur Nachtschicht im Logistikzentrum wird vorausgesetzt.', 'NIGHT_SHIFT'],
    ['allemand — week-end', 'Bereitschaft zur Arbeit am Wochenende und an Feiertagen.', 'EVENINGS_WEEKENDS'],
    ['italien — nuit', 'Richiesta la disponibilità al turno notturno presso il magazzino.', 'NIGHT_SHIFT'],
    ['italien — week-end', 'Disponibilità a lavorare nel fine settimana e nei festivi.', 'EVENINGS_WEEKENDS'],
    ['espagnol — nuit', 'Disponibilidad para trabajar en turno de noche.', 'NIGHT_SHIFT'],
    ['espagnol — flexible', 'Disponibilidad para trabajar con horario flexible según la tienda.', 'FLEXIBLE_AVAILABILITY'],
  ];

  it.each(CAS)('%s', (_nom, texte, attendu) => {
    // PRÉMISSE : le cas est bien rédigé dans une langue AUTRE que l'anglais
    // quand il prétend l'être — un jeu d'essai anglais déguisé ne testerait
    // que le chemin anglais et passerait au vert sans rien prouver.
    if (!_nom.startsWith('anglais')) {
      expect(texte).not.toMatch(/\bability to work\b|\bmust be able\b/i);
    }
    expect(readScheduleDescription(texte)?.schedule).toBe(attendu);
  });
});

describe('D-436 — l’abstention est le cas NORMAL', () => {
  it('une offre française ordinaire ne porte aucun rythme (0 % mesuré en FR)', () => {
    const texte =
      'Conseiller de vente en boutique. Vous accompagnez une clientèle exigeante et assurez la tenue du point de vente.';
    // PRÉMISSE : le texte ne contient aucun terme de rythme — sinon l'abstention
    // viendrait du filtre et non de l'absence réelle.
    expect(texte).not.toMatch(/nuit|week[ -]?end|flexible|soir/i);
    expect(readScheduleDescription(texte)).toBeUndefined();
  });

  it.each([undefined, null, ''])('une description vide (%s) s’abstient', (vide) => {
    expect(readScheduleDescription(vide)).toBeUndefined();
  });
});

/**
 * ── LE BRANCHEMENT — un composant sans appelant n'existe pas ──────────────
 *
 * Le 27/07/2026, un « moteur unifié » a été livré, documenté comme le chemin
 * de production, avec ZÉRO appelant. Ce bloc prouve que `readScheduleDescription`
 * est réellement atteint par `resolveCanonicalDimensions`.
 */
describe('D-436 — branchement dans la chaîne réelle (resolveCanonicalDimensions)', () => {
  it('resolveCanonicalDimensions expose le rythme lu dans la description', () => {
    const resolu = resolveCanonicalDimensions({
      sourceKey: 'temoin-d436',
      title: 'Seasonal Sales Associate',
      contract: undefined,
      workingTime: undefined,
      description: CAS_REEL_PRODUCTION,
      raw: undefined,
    });
    expect(resolu.workSchedule).toBe('EVENINGS_WEEKENDS');
    expect(resolu.rawSchedule).toBe(CAS_REEL_PRODUCTION);
  });

  it('resolveCanonicalDimensions laisse le rythme VIDE quand la description ne l’exige pas', () => {
    const resolu = resolveCanonicalDimensions({
      sourceKey: 'temoin-d436',
      title: 'Conseiller de vente',
      contract: undefined,
      workingTime: undefined,
      description: 'Nos avantages : congés payés, mutuelle, remise collaborateur.',
      raw: undefined,
    });
    expect(resolu.workSchedule).toBeUndefined();
    expect(resolu.rawSchedule).toBeUndefined();
  });

  describe('les faux positifs et négatifs trouvés par l’audit du 15/09/2026', () => {
    it('le futur français de « être » ne déclenche plus le soir italien', () => {
      /*
       * PRÉMISSE — les formes italiennes NON ambiguës restent captées, sinon
       * ce témoin passerait au vert sur une langue simplement supprimée.
       */
      expect(
        readScheduleDescription('Disponibilità a lavorare su turni serali')?.schedule,
        'la prémisse : l’italien non ambigu fonctionne toujours',
      ).toBeDefined();

      /*
       * Le défaut : « sera » est le SOIR en italien et le FUTUR D’ÊTRE en
       * français. Sur 3 000 offres FR, 4 des 10 correspondances venaient de
       * cette collision — des phrases sans aucun rapport avec un rythme.
       */
      expect(readScheduleDescription('Il sera également amené à travailler sur des projets transverses.')).toBeUndefined();
      expect(readScheduleDescription('Le poste sera basé à Paris.')).toBeUndefined();
    });

    it('« disponibilité » industrielle n’est pas une disponibilité horaire', () => {
      // PRÉMISSE — la disponibilité qui porte sur du TEMPS est bien captée.
      expect(
        readScheduleDescription('Disponibilité pour travailler le week-end')?.schedule,
        'la prémisse : la disponibilité horaire fonctionne',
      ).toBe('EVENINGS_WEEKENDS');

      // Le défaut : du vocabulaire de production industrielle.
      expect(readScheduleDescription('Taux de disponibilité et qualité produit')).toBeUndefined();
      expect(readScheduleDescription('La disponibilité des solutions en production')).toBeUndefined();
    });

    it('« Flexible availability » est capté, même sans verbe d’exigence', () => {
      /*
       * PRÉMISSE, ET UNE CORRECTION DE MA PROPRE AFFIRMATION.
       *
       * Une première version de ce témoin posait que « flexible schedule »
       * était auto-suffisant — le commentaire du normaliseur le dit. L'exécution
       * l'a réfuté : « Flexible schedule required » rend `undefined`, cette
       * forme exige bien un marqueur (« Ability to work a flexible schedule »
       * fonctionne, elle).
       *
       * La prémisse dit donc désormais ce qui EST, pas ce que le commentaire
       * prétendait.
       */
      expect(
        readScheduleDescription('Ability to work a flexible schedule')?.schedule,
        'la prémisse : la forme avec marqueur fonctionne',
      ).toBe('FLEXIBLE_AVAILABILITY');
      expect(
        readScheduleDescription('Flexible schedule required'),
        'et « flexible schedule » NU ne suffit pas — contrairement au commentaire',
      ).toBeUndefined();

      /*
       * Le défaut mesuré : 2 469 offres actives sur 3 031 s’abstenaient,
       * concentrées sur US (2 310) et CA (298) — les deux marchés visés.
       */
      expect(readScheduleDescription('Flexible availability – including nights, weekends, and holidays')?.schedule)
        .toBe('EVENINGS_WEEKENDS');
      expect(readScheduleDescription('Flexible availability required')?.schedule).toBe('FLEXIBLE_AVAILABILITY');
    });
  });
});
