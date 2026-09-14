/**
 * WORK SCHEDULE — le RYTHME DE TRAVAIL, c'est-à-dire QUAND on travaille.
 *
 * ── POURQUOI CETTE DIMENSION EXISTE ───────────────────────────────────────
 *
 * C'est la dimension la plus publiée des marchés anglo-saxons, et elle
 * n'existait dans aucune colonne. Mesuré en production le 2026-09-15 :
 *
 *   « flexible schedule / flexibility to work »  US 54 % · CA 26 % · GB 6 % · AU 5 % · DE 3 % · FR 0 %
 *   « nights, weekends / evenings and weekends » CA 28 % · US 27 % · GB 15 % · AU 15 % · FR 0 %
 *   « night shift / overnight »                  US 9 % · CA 2 %
 *   « rotating shift / shift work »              sous 2 % PARTOUT
 *
 * `ROTATING` n'est donc PAS une valeur canonique : aucune mesure ne la justifie,
 * et une valeur qu'on n'a pas comptée est une valeur qu'on ne sait pas remplir.
 *
 * ── CE QUE LA DIMENSION DIT, ET CE QU'ELLE NE DIT PAS ─────────────────────
 *
 * Elle ne dit PAS le VOLUME de travail : c'est `workTime` (temps plein /
 * partiel). Le seul champ STRUCTURÉ que les sources publient (`schedule`,
 * 186 offres) contient « full-or-part-time » — donc un temps de travail mal
 * nommé. Le rythme, lui, ne vit que dans les DESCRIPTIONS, et c'est de là
 * qu'il faut le lire.
 *
 * Elle dit une DISPONIBILITÉ EXIGÉE du candidat, pas une catégorie de poste.
 * Le contexte réel vérifié en base :
 *
 *   « Ability to work a flexible schedule to meet business needs—including
 *     nights, weekends, peak busy season »
 *
 * Personne n'est « embauché en soirée » : on exige d'être DISPONIBLE en
 * soirée. C'est ce qui fixe la règle de lecture ci-dessous.
 *
 * ── LE PIÈGE MESURÉ : LES AVANTAGES SOCIAUX ───────────────────────────────
 *
 * « paid holidays », « holiday pay », « weekend discount on all products » ne
 * sont pas des rythmes : ce sont des AVANTAGES, et ils vivent dans la même
 * section « benefits » que le reste. Le mot « weekend » ou « holiday » SEUL ne
 * prouve donc rien — il est au moins aussi souvent un avantage qu'une
 * exigence.
 *
 * D'où l'invariant : un terme de rythme n'écrit une valeur QUE s'il est porté
 * par un MARQUEUR D'EXIGENCE dans la même phrase (« ability to work »,
 * « must be available », « flexibility to… », « doit être disponible »).
 * Sans marqueur, on s'abstient.
 *
 * ── S'ABSTENIR PLUTÔT QU'INVENTER ─────────────────────────────────────────
 *
 * `undefined` est le cas NORMAL et attendu : la grande majorité des offres
 * (100 % des offres françaises sur les termes mesurés) ne dit rien de son
 * rythme. Une case vide se répare ; une valeur fausse ne se voit pas, et
 * enverrait un candidat vers un poste de nuit qu'il n'a pas choisi.
 */

export const WORK_SCHEDULES = ['FLEXIBLE_AVAILABILITY', 'EVENINGS_WEEKENDS', 'NIGHT_SHIFT'] as const;
export type WorkSchedule = (typeof WORK_SCHEDULES)[number];

export type ScheduleReading = {
  schedule: WorkSchedule;
  /** Le libellé SOURCE qui a justifié la valeur, conservé tel quel (`rawSchedule`). */
  raw: string;
};

/**
 * Les MARQUEURS D'EXIGENCE, multilingues — ce qui transforme un mot en règle.
 *
 * Chaque terme est écrit dans SA langue, jamais traduit depuis l'anglais : une
 * annonce allemande dit « Bereitschaft zur », pas « ability to ».
 *
 * `schedule` / `hours` / `horaires` figurent ici parce que « flexible schedule »
 * est lui-même la formulation d'exigence la plus fréquente (54 % US) : le mot
 * « flexible » collé à l'horaire EST l'exigence, il n'a pas besoin d'un verbe.
 */
const REQUIREMENT_MARKER = new RegExp(
  [
    // Anglais — la forme mesurée dominante.
    'ability to work',
    'able to work',
    'willing(?:ness)? to work',
    'must be (?:able|available|willing)',
    'must work',
    'required to work',
    'availability to work',
    'flexibility to work',
    'expected to work',
    'this (?:role|position) requires',
    'schedule (?:may )?includes?',
    'shifts? (?:may )?includes?',
    'work(?:ing)? hours includes?',
    // Français.
    'doit (?:être disponible|pouvoir|travailler)',
    'devez (?:être disponible|pouvoir|travailler)',
    'capacit[ée] [àa] travailler',
    'disponibilit[ée]',
    'disponible pour travailler',
    'amen[ée]e? [àa] travailler',
    // Allemand.
    'bereitschaft zu[rm]?',
    'bereit(?:schaft)? (?:zu )?arbeiten',
    'm[üu]ssen (?:sie )?(?:bereit|verf[üu]gbar)',
    'einsatz (?:am|an)',
    // Italien.
    'disponibilit[àa] a lavorare',
    'disponibile a lavorare',
    'richiesta la disponibilit[àa]',
    // Espagnol.
    'disponibilidad para trabajar',
    'disponible para trabajar',
    'capacidad para trabajar',
    'debe(?:r[áa])? (?:estar disponible|trabajar)',
  ].join('|'),
  'i',
);

/**
 * Les TERMES de rythme, par ordre de SPÉCIFICITÉ décroissante.
 *
 * NIGHT_SHIFT avant EVENINGS_WEEKENDS avant FLEXIBLE_AVAILABILITY : la phrase
 * réelle mesurée (« flexible schedule […] including nights, weekends ») porte
 * les trois, et c'est la contrainte la PLUS DURE qui doit gagner — annoncer
 * « horaires flexibles » à qui devra faire des nuits serait un mensonge par
 * omission.
 *
 * Chaque terme dans sa langue. `\b` partout : « overnight » ne doit pas
 * matcher dans « overnighted », ni « nuit » dans « nuitée ».
 */
const SCHEDULE_TERMS: ReadonlyArray<readonly [WorkSchedule, RegExp]> = [
  [
    'NIGHT_SHIFT',
    new RegExp(
      [
        // Anglais.
        '\\bnight shifts?\\b',
        '\\bovernight\\b',
        '\\bnights? shift\\b',
        '\\bgraveyard shift\\b',
        // Français — « travail de nuit » est la formule légale française.
        '\\btravail de nuit\\b',
        '\\b[ée]quipe de nuit\\b',
        '\\bposte de nuit\\b',
        '\\bhoraires? de nuit\\b',
        // Allemand.
        '\\bnachtschicht\\b',
        '\\bnachtarbeit\\b',
        '\\bnachtdienst\\b',
        // Italien.
        '\\bturno notturno\\b',
        '\\blavoro notturno\\b',
        // Espagnol.
        '\\bturno de noche\\b',
        '\\btrabajo nocturno\\b',
        '\\bturno nocturno\\b',
      ].join('|'),
      'i',
    ),
  ],
  [
    'EVENINGS_WEEKENDS',
    new RegExp(
      [
        // Anglais — les deux formes mesurées (« nights, weekends »,
        // « evenings and weekends ») plus le simple « weekend » SOUS marqueur.
        '\\bnights?\\b[^.]{0,20}\\bweekends?\\b',
        '\\bevenings?\\b[^.]{0,20}\\bweekends?\\b',
        '\\bweekends?\\b[^.]{0,20}\\b(?:nights?|evenings?|holidays?)\\b',
        '\\bweekends?\\b',
        '\\bevenings?\\b',
        // Français.
        '\\bweek[ -]?ends?\\b',
        '\\bfins? de semaine\\b',
        '\\bsoir[ée]es?\\b',
        '\\ben soir[ée]e\\b',
        '\\bsamedis? et dimanches?\\b',
        '\\bjours f[ée]ri[ée]s\\b',
        // Allemand.
        '\\bwochenende?n?\\b',
        '\\bsamstags?\\b',
        '\\bsonntags?\\b',
        '\\babendarbeit\\b',
        '\\babends\\b',
        // Italien.
        '\\bweek[ -]?end\\b',
        '\\bfine settimana\\b',
        '\\bnei festivi\\b',
        '\\bsera(?:li|le)?\\b',
        // Espagnol.
        '\\bfines? de semana\\b',
        '\\bs[áa]bados? y domingos?\\b',
        '\\bpor las tardes\\b',
      ].join('|'),
      'i',
    ),
  ],
  [
    'FLEXIBLE_AVAILABILITY',
    new RegExp(
      [
        // Anglais — la formulation mesurée à 54 % aux US.
        '\\bflexible schedule\\b',
        '\\bflexible work(?:ing)? schedule\\b',
        '\\bflexible hours\\b',
        '\\bflexible availability\\b',
        '\\bvaried schedule\\b',
        '\\bvariable schedule\\b',
        '\\bflexibility to work\\b',
        '\\bflexible shifts?\\b',
        // Français.
        '\\bhoraires? (?:flexibles?|variables?|modulables?)\\b',
        '\\bplanning variable\\b',
        '\\bdisponibilit[ée] flexible\\b',
        // Allemand.
        '\\bflexible(?:n|r)? arbeitszeiten\\b',
        '\\bzeitliche flexibilit[äa]t\\b',
        // Italien.
        '\\borari? flessibil[ei]\\b',
        '\\bflessibilit[àa] oraria\\b',
        // Espagnol.
        '\\bhorario(?:s)? flexible(?:s)?\\b',
        '\\bflexibilidad horaria\\b',
        '\\bdisponibilidad horaria\\b',
      ].join('|'),
      'i',
    ),
  ],
];

/**
 * Les FAUX AMIS — mesurés, et écartés AVANT toute lecture de rythme.
 *
 * Ce sont des AVANTAGES SOCIAUX : ils annoncent ce que l'employeur DONNE, pas
 * ce qu'il EXIGE. « paid holidays » vit dans la même section « benefits » que
 * la mutuelle ; le lire comme un rythme classerait EVENINGS_WEEKENDS une offre
 * de bureau qui offre simplement des congés payés.
 *
 * Écartés phrase par phrase (et non pour toute la description) : une offre
 * peut parfaitement lister « paid holidays » dans ses avantages ET exiger des
 * soirées dans ses conditions — la deuxième phrase doit continuer à parler.
 */
const BENEFIT_FALSE_FRIEND = new RegExp(
  [
    // Anglais.
    '\\bpaid (?:holidays?|time off|vacation|weekends?)\\b',
    '\\bholiday pay\\b',
    '\\bweekend (?:discount|bonus|premium|rate|pay)\\b',
    '\\b(?:employee )?discount\\b',
    '\\bpaid (?:parental|maternity|sick) leave\\b',
    '\\bcompany holidays?\\b',
    '\\bpublic holidays? off\\b',
    // Français.
    '\\bcong[ée]s pay[ée]s\\b',
    '\\bmajoration (?:du |de )?(?:dimanche|week[ -]?end|nuit)\\b',
    '\\bprime de (?:nuit|week[ -]?end|dimanche)\\b',
    '\\bremise (?:collaborateur|salari[ée])\\b',
    // Allemand.
    '\\burlaubstage?\\b',
    '\\bbezahlte(?:r|n)? urlaub\\b',
    '\\bmitarbeiterrabatt\\b',
    // Italien.
    '\\bferie pagate\\b',
    '\\bsconto dipendenti\\b',
    // Espagnol.
    '\\bvacaciones pagadas\\b',
    '\\bdescuento (?:para )?empleados?\\b',
  ].join('|'),
  'i',
);

/**
 * Découpe en PHRASES, parce que l'exigence et son terme doivent cohabiter.
 *
 * Le tiret cadratin compte comme une frontière faible et n'est PAS coupé : la
 * phrase réelle mesurée (« …business needs—including nights, weekends ») porte
 * son marqueur avant le tiret et ses termes après. Couper là romprait
 * précisément le cas le plus fréquent.
 */
function sentences(raw: string): string[] {
  return raw
    .split(/(?<=[.!?;:])\s+|\n+|•|•/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Le rythme EXIGÉ par une description, ou `undefined`.
 *
 * `undefined` est le cas normal : 0 % des offres françaises mesurées portent
 * l'un de ces termes. On ne remplit que ce que la source AFFIRME exiger.
 */
export function readScheduleDescription(raw?: string | null): ScheduleReading | undefined {
  if (!raw) return undefined;

  for (const sentence of sentences(raw)) {
    // L'avantage social l'emporte sur le terme : « weekend discount » n'est
    // pas une exigence, et aucune lecture ne doit s'en servir.
    if (BENEFIT_FALSE_FRIEND.test(sentence)) continue;
    // Sans marqueur d'exigence, le mot seul ne prouve rien.
    if (!REQUIREMENT_MARKER.test(sentence)) continue;

    for (const [schedule, term] of SCHEDULE_TERMS) {
      if (term.test(sentence)) return { schedule, raw: sentence };
    }
  }
  return undefined;
}
