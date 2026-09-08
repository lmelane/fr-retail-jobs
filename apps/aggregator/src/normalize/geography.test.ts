import { describe, expect, it } from 'vitest';
import { resolveGeography, isValidCityName } from './geography.js';

/**
 * LE MODÈLE GÉOGRAPHIQUE MONDIAL (validé par Loïc, 2026-09-08) :
 *
 *   countryCode · city · adminArea1 · adminArea2 · postalCode · lat/lng
 *
 * `adminArea1` = la première subdivision administrative du pays (California,
 * Île-de-France, Ontario). PAS de colonne `continent` : « Europe » ou « Asia
 * Pacific » sont des macro-régions business, dérivables du pays le jour où le
 * besoin existe.
 *
 * RÈGLE CARDINALE : **une géographie incomplète mais certaine vaut mieux qu'une
 * géographie complète inventée.**
 */

describe('resolveGeography — le piège des codes à deux lettres', () => {
  /**
   * LE CAS MESURÉ : `TN`, `GA`, `SC`, `NE`, `MO`… sont à la fois des états
   * américains et des codes ISO pays valides (Tunisie, Gabon, Seychelles,
   * Niger, Macao). En base, « Nashville, TN » était devenu le pays « TN ».
   *
   * Deux lettres seules ne constituent JAMAIS une preuve de pays.
   */
  it('« Nashville, TN » : TN est le Tennessee, pas la Tunisie', () => {
    const r = resolveGeography({ location: 'Nashville, TN', rawCountryCode: 'US' });
    expect(r.countryCode).toBe('US');
    expect(r.adminArea1).toBe('Tennessee');
    expect(r.city).toBe('Nashville');
    // Le pays vient du champ déclaré ; le suffixe n'apporte que la subdivision.
    expect(r.method).toBe('RAW_COUNTRY_CODE');
  });

  it.each([
    ['Atlanta, GA', 'US', 'Georgia'],
    ['Florence, KY', 'US', 'Kentucky'],
    ['Sioux Falls, SD', 'US', 'South Dakota'],
    ['Charlotte, NC', 'US', 'North Carolina'],
    ['St. Louis, MO', 'US', 'Missouri'],
  ])('%s → %s / %s', (location, country, admin) => {
    const r = resolveGeography({ location, rawCountryCode: 'US' });
    expect(r.countryCode).toBe(country);
    expect(r.adminArea1).toBe(admin);
  });

  /**
   * L'INVERSE doit rester vrai : « Mahé, Seychelles » est bien SC le PAYS.
   * C'est le nom en toutes lettres qui lève l'ambiguïté, jamais le code.
   */
  it('« Mahé, Seychelles » reste le pays SC', () => {
    const r = resolveGeography({ location: 'Mahé, Seychelles' });
    expect(r.countryCode).toBe('SC');
    expect(r.adminArea1).toBeUndefined();
  });

  it('un code à deux lettres inconnu ne produit AUCUN pays', () => {
    expect(resolveGeography({ location: 'Springfield, ZZ' }).countryCode).toBeUndefined();
  });
});

describe('resolveGeography — le préfixe pays-état', () => {
  /** Format mesuré sur 1 237 offres : `US-PA-Philadelphia`. */
  it('« US-PA-Philadelphia » donne les trois niveaux d’un coup', () => {
    const r = resolveGeography({ location: 'US-PA-Philadelphia' });
    expect(r.countryCode).toBe('US');
    expect(r.adminArea1).toBe('Pennsylvania');
    expect(r.city).toBe('Philadelphia');
    expect(r.method).toBe('LOCATION_COUNTRY_PREFIX');
  });

  it('accepte une subdivision non américaine dans le même format', () => {
    const r = resolveGeography({ location: 'CA-ON-Toronto' });
    expect(r.countryCode).toBe('CA');
    expect(r.city).toBe('Toronto');
  });

  /**
   * Le pays est certain (il est en tête), mais on ne possède pas la table des
   * subdivisions de ce pays-là. Écrire le segment brut produirait un
   * `adminArea1` non comparable — exactement ce que la colonne doit éviter.
   */
  /** Cas réel en base : « IN-HR-Gurugram » (Haryana). On n'a pas la table indienne. */
  it('ne pose PAS de subdivision pour un pays dont la table est inconnue', () => {
    const r = resolveGeography({ location: 'IN-HR-Gurugram' });
    expect(r.countryCode).toBe('IN');
    expect(r.city).toBe('Gurugram');
    expect(r.adminArea1).toBeUndefined();
  });
});

/**
 * MESURÉ EN PROD après le premier backfill : 702 lignes hors US/CA portaient un
 * `adminArea1` faux ou incomparable. Trois familles distinctes, une par test.
 */
describe('resolveGeography — adminArea1 : jamais un libellé non reconnu', () => {
  /** « Parndorf, Outlet, AUT » → adminArea1 « Outlet » (un centre commercial). */
  it('un segment central inconnu ne devient pas une subdivision', () => {
    const r = resolveGeography({ location: 'Parndorf, Outlet, AUT' });
    expect(r.countryCode).toBe('AT');
    expect(r.city).toBe('Parndorf');
    expect(r.adminArea1).toBeUndefined();
  });

  /** « NSW, Brisbane Airport, AUS » → adminArea1 « Brisbane Airport ». */
  it('un nom de site ne devient pas une subdivision', () => {
    const r = resolveGeography({ location: 'NSW, Macquarie Centre, AUS' });
    expect(r.countryCode).toBe('AU');
    expect(r.adminArea1).toBeUndefined();
  });

  /**
   * « Success, WA » est en AUSTRALIE (Western Australia), pas dans l'état de
   * Washington : la table US ne s'applique que si le pays est US.
   *
   * `legacyCountry` est un ARBITRE, pas une sortie : la fonction ne republie
   * pas le pays déjà stocké, elle s'en sert pour refuser une lecture. Le
   * backfill, lui, conserve la valeur existante.
   */
  it('un code de subdivision US ne s’applique pas quand le pays connu est autre', () => {
    const r = resolveGeography({ location: 'Success, WA', legacyCountry: 'AU' });
    expect(r.countryCode).toBeUndefined();
    expect(r.adminArea1).toBeUndefined();
    expect(r.city).toBe('Success');
  });

  /**
   * LE CAS LE PLUS COÛTEUX : 474 offres d'Amsterdam.
   * « Amsterdam, NH, nl » — NH est la province de Noord-Holland, lue comme
   * Terre-Neuve-et-Labrador. La garde de collision ne couvrait que les états
   * US, jamais les provinces canadiennes.
   */
  it('« Amsterdam, NH, nl » n’est pas Terre-Neuve-et-Labrador', () => {
    const r = resolveGeography({ location: 'Amsterdam, NH, nl', legacyCountry: 'NL' });
    expect(r.adminArea1).toBeUndefined();
    expect(r.city).toBe('Amsterdam');
    // Le pays n'est pas reproduit ici : le legacy `NL` reste en base, intact.
    expect(r.countryCode).toBeUndefined();
  });

  it('une province canadienne ambiguë sans confirmation reste sans subdivision', () => {
    const r = resolveGeography({ location: 'Groningen, NL' });
    expect(r.adminArea1).toBeUndefined();
  });

  /** Le cas légitime doit continuer de passer : le Canada confirmé par le raw. */
  it('« Toronto, ON » avec un pays CA déclaré donne bien Ontario', () => {
    const r = resolveGeography({ location: 'Toronto, ON', rawCountryCode: 'CA' });
    expect(r.countryCode).toBe('CA');
    expect(r.adminArea1).toBe('Ontario');
  });
});

/**
 * MESURÉ EN PROD : 80 offres portaient dans `country` une valeur qui n'est pas
 * un pays. Le code seul ne tranche jamais — seul le LIEU le fait.
 */
describe('resolveGeography — un pays stocké qui n’en est pas un', () => {
  /**
   * `UK` n'est pas un code ISO 3166-1 : le Royaume-Uni est `GB`. 20 offres.
   * Aucune ambiguïté possible, aucune preuve de lieu nécessaire.
   */
  it('« UK » est normalisé en « GB »', () => {
    expect(resolveGeography({ rawCountryCode: 'UK' }).countryCode).toBe('GB');
    expect(resolveGeography({ rawCountry: 'UK' }).countryCode).toBe('GB');
  });

  /**
   * `AR` est À LA FOIS l'Argentine et l'Arkansas, et la base contient les deux :
   * « North Little Rock, AR » (Arkansas) et « Buenos Aires, AR-B, Argentina ».
   * Le lieu tranche, le code jamais.
   */
  it('« North Little Rock, AR » est l’Arkansas, pas l’Argentine', () => {
    const r = resolveGeography({ location: 'North Little Rock, AR', legacyCountry: 'US' });
    expect(r.countryCode).toBe('US');
    expect(r.adminArea1).toBe('Arkansas');
  });

  it('« Buenos Aires, AR-B, Argentina » reste l’Argentine', () => {
    const r = resolveGeography({ location: 'Buenos Aires, AR-B, Argentina', legacyCountry: 'AR' });
    expect(r.countryCode).toBe('AR');
    expect(r.adminArea1).toBeUndefined();
  });
});

/**
 * L'INTÉGRITÉ DU PAYS — décision Loïc du 2026-09-08.
 *
 * *« Valeur legacy conservée ≠ valeur considérée comme prouvée. »* La chaîne
 * refuse de corriger 36 offres dont le `country` stocké est un code qui
 * collisionne avec une subdivision (« Scottsdale, AZ », « North Little Rock,
 * AR »). Elle a raison de refuser — mais l'observatoire ne doit pas compter un
 * `AR` douteux comme une Argentine certaine.
 *
 * On ne corrige pas, on SIGNALE. Le jour où une preuve indépendante apparaît
 * (code postal, coordonnées, champ raw), le moteur tranche tout seul.
 */
describe('resolveGeography — countryIntegrity', () => {
  /**
   * LA CHAÎNE NE MARQUE RIEN PAR ELLE-MÊME, et c'est une décision, pas un oubli.
   *
   * Une première version signalait « le pays stocké est le code du suffixe »
   * (« Scottsdale, AZ » sous le pays AZ). Mesuré en prod : ce critère marquait
   * **1 725 offres**, dont Berlin/Munich sous `DE` (594) et le Canada sous `CA`
   * (307) — tous parfaitement justes. « Berlin, DE » et « Scottsdale, AZ » ont
   * EXACTEMENT la même forme ; seule une table ville→pays les sépare, et on n'en
   * a pas.
   *
   * Le marquage vit donc au niveau de l'INVENTAIRE (`mark-ambiguous-country`),
   * qui peut constater qu'un code n'est attesté nulle part dans la base —
   * une propriété du corpus, pas de l'offre. Le garder ici rendrait
   * `resolveGeography` dépendante de l'état de la base, donc non rejouable.
   */
  it.each([
    ['Scottsdale, AZ', 'AZ'],
    ['Berlin, DE', 'DE'],
    ['Toronto, CA', 'CA'],
    ['North Little Rock, AR', 'AR'],
  ])('%s ne porte jamais de marque : la forme seule ne prouve rien', (location, legacyCountry) => {
    expect(resolveGeography({ location, legacyCountry }).countryIntegrity).toBeUndefined();
  });

  /**
   * Le contre-cas qui reste vrai : « Cordoba, AR-X, Argentina » porte le pays
   * en toutes lettres. 24 des 37 offres « AR » sont dans ce cas — elles sont
   * ATTESTÉES et ne relèvent d'aucun doute.
   */
  it.each([
    'Cordoba, AR-X, Argentina',
    'Buenos Aires, AR-B, Argentina',
    'Rosario, AR-S, Argentina',
  ])('%s est attestée par le pays nommé', (location) => {
    expect(resolveGeography({ location, legacyCountry: 'AR' }).countryCode).toBe('AR');
  });

  /** Une preuve indépendante tranche pour de bon : plus aucun doute. */
  it('un champ pays déclaré par la source résout la collision', () => {
    const r = resolveGeography({ location: 'Scottsdale, AZ', legacyCountry: 'AZ', rawCountryCode: 'US' });
    expect(r.countryCode).toBe('US');
    expect(r.adminArea1).toBe('Arizona');
    expect(r.countryIntegrity).toBeUndefined();
  });
});

/**
 * `adminArea1` sert à AGRÉGER. « FL » et « Florida », « ON » et « Ontario »,
 * « quebec » et « Québec » doivent produire une seule et même clé, sinon la
 * colonne n'est pas exploitable statistiquement — le cap du dataset.
 */
describe('resolveGeography — adminArea1 canonique', () => {
  it.each([
    ['US-FL-Miami', 'Florida'],
    ['Miami, FL', 'Florida'],
    ['Miami, Florida', 'Florida'],
    ['Miami, florida', 'Florida'],
  ])('%s → %s', (location, admin) => {
    const r = resolveGeography({ location, rawCountryCode: 'US' });
    expect(r.adminArea1).toBe(admin);
  });

  it.each([
    ['CA-QC-Montreal', 'Quebec'],
    ['Montreal, QC', 'Quebec'],
    ['Montreal, Quebec, CAN', 'Quebec'],
    ['Montreal, quebec, CAN', 'Quebec'],
  ])('%s → %s', (location, admin) => {
    const r = resolveGeography({ location, rawCountryCode: 'CA' });
    expect(r.adminArea1).toBe(admin);
  });
});

describe('resolveGeography — la subdivision en toutes lettres', () => {
  /** Format mesuré sur 2 083 offres : « Columbus, Ohio ». Plus sûr qu'un code. */
  it.each([
    ['Columbus, Ohio', 'US', 'Ohio', 'Columbus'],
    ['West Palm Beach, Florida', 'US', 'Florida', 'West Palm Beach'],
    ['New York City, New York', 'US', 'New York', 'New York City'],
  ])('%s → %s / %s / %s', (location, country, admin, city) => {
    const r = resolveGeography({ location });
    expect(r.countryCode).toBe(country);
    expect(r.adminArea1).toBe(admin);
    expect(r.city).toBe(city);
  });

  /**
   * « Freiburg, Media House » et « Filiale Mühlhausen, Stores » : le suffixe
   * n'est pas toujours géographique. Un mot inconnu ne devient jamais une
   * subdivision.
   */
  it('un suffixe non géographique ne produit rien', () => {
    const r = resolveGeography({ location: 'Freiburg, Media House' });
    expect(r.countryCode).toBeUndefined();
    expect(r.adminArea1).toBeUndefined();
  });
});

describe('resolveGeography — le pays nommé', () => {
  it.each([
    ['Paris, France', 'FR'],
    ['London, United Kingdom', 'GB'],
    ['Tokyo, Japan', 'JP'],
    ['Milano, Italia', 'IT'],
  ])('%s → %s', (location, expected) => {
    expect(resolveGeography({ location }).countryCode).toBe(expected);
  });

  /** Le champ dédié de la source prime sur tout le reste. */
  it('un champ pays explicite bat le texte', () => {
    const r = resolveGeography({ location: 'Paris, France', rawCountry: 'BE' });
    expect(r.countryCode).toBe('BE');
    expect(r.method).toBe('RAW_COUNTRY');
  });
});

/**
 * LE POINT 7 : une ville seule ne prouve JAMAIS un pays. « Paris » existe dans
 * 4 pays en base (BE, ES, FR, US), Manchester dans 4, Cambridge dans 4.
 */
describe('resolveGeography — villes ambiguës', () => {
  it.each(['Paris', 'London', 'Cambridge', 'Melbourne', 'Manchester', 'Springfield', 'San Jose'])(
    '« %s » seule ne produit AUCUN pays',
    (city) => {
      const r = resolveGeography({ location: city });
      expect(r.countryCode).toBeUndefined();
      expect(r.city).toBe(city);
    },
  );

  it('mais la ville est conservée : on perd le pays, pas la localité', () => {
    expect(resolveGeography({ location: 'Paris' }).city).toBe('Paris');
  });
});

/**
 * VALIDATION DE QUALITÉ — deux défauts mesurés : « Brown Thomas » (44 offres,
 * une enseigne) et « /a> » (71 offres, un résidu HTML). Des règles GÉNÉRIQUES,
 * jamais une liste manuelle de mauvaises villes.
 */
describe('isValidCityName', () => {
  it.each(['Paris', 'New York', 'Saint-Étienne', "L'Haÿ-les-Roses", 'Frankfurt am Main', '上海'])(
    '« %s » est une ville valide',
    (city) => expect(isValidCityName(city)).toBe(true),
  );

  it.each([
    '/a>',
    '<div>',
    '&nbsp;',
    '-',
    '',
    '   ',
    'https://example.com',
    '12345',
  ])('« %s » est refusé', (value) => expect(isValidCityName(value)).toBe(false));

  it('un lieu rejeté ne devient pas une ville', () => {
    expect(resolveGeography({ location: '/a>' }).city).toBeUndefined();
  });
});

describe('resolveGeography — provenance et cohérence', () => {
  it('porte la méthode et le chemin de la preuve', () => {
    const r = resolveGeography({ rawCountryCode: 'FR', location: 'Lyon' });
    expect(r.method).toBe('RAW_COUNTRY_CODE');
    expect(r.sourcePath).toBe('country_code');
    expect(r.confidence).toBe(1);
  });

  /** Une inférence depuis un suffixe est moins sûre qu'un champ déclaré. */
  it('une inférence porte une confiance moindre qu’un champ déclaré', () => {
    const declared = resolveGeography({ rawCountryCode: 'US' });
    const inferred = resolveGeography({ location: 'Nashville, TN', legacyCountry: 'US' });
    expect(inferred.confidence).toBeLessThan(declared.confidence ?? 1);
  });

  it('sans aucune preuve, tout reste vide', () => {
    const r = resolveGeography({});
    expect(r.countryCode).toBeUndefined();
    expect(r.city).toBeUndefined();
    expect(r.adminArea1).toBeUndefined();
  });
});

/**
 * LE FORMAT ISO À TROIS LETTRES, trouvé par le dry-run : Workday écrit
 * « Montreal, Quebec, CAN » — trois niveaux, avec un code pays alpha-3.
 *
 * C'est aussi ce qui SÉPARE le Canada de la Californie : les vraies offres
 * canadiennes finissent par `CAN`, les californiennes par `CA`. Sans ce format,
 * 988 offres canadiennes restaient sans pays.
 */
describe('resolveGeography — suffixe pays ISO alpha-3', () => {
  it.each([
    ['Montreal, Quebec, CAN', 'CA', 'Quebec', 'Montreal'],
    ['Toronto, Ontario, CAN', 'CA', 'Ontario', 'Toronto'],
    ['Vancouver, British Columbia, CAN', 'CA', 'British Columbia', 'Vancouver'],
  ])('%s → %s / %s / %s', (location, country, admin, city) => {
    const r = resolveGeography({ location });
    expect(r.countryCode).toBe(country);
    expect(r.adminArea1).toBe(admin);
    expect(r.city).toBe(city);
  });

  it.each([
    ['Paris, Ile-de-France, FRA', 'FR'],
    ['Tokyo, Tokyo, JPN', 'JP'],
    ['Berlin, Berlin, DEU', 'DE'],
  ])('%s → %s', (location, expected) => {
    expect(resolveGeography({ location }).countryCode).toBe(expected);
  });

  /** « El Segundo, CA » reste la Californie : le code à 2 lettres n'est pas CAN. */
  it('ne confond jamais CA (Californie) et CAN (Canada)', () => {
    expect(resolveGeography({ location: 'El Segundo, CA', rawCountryCode: 'US' }).countryCode).toBe('US');
    expect(resolveGeography({ location: 'Montreal, Quebec, CAN' }).countryCode).toBe('CA');
  });
});

/**
 * CORRUPTIONS ATTRAPÉES PAR L'AUDIT DES CORRECTIONS (2026-09-08).
 *
 * Le moteur appliquait la table des états US dès qu'un suffixe à deux lettres
 * y figurait, SANS vérifier que le reste du libellé était cohérent. Résultat
 * mesuré sur de vraies offres :
 *
 *   « Berlin, DE »      → États-Unis / Delaware   (567 offres allemandes)
 *   « Jakarta, ID »     → États-Unis / Idaho      (Indonésie)
 *   « Hamburg, HH, de » → Delaware
 *
 * La règle qui en sort : un suffixe à deux lettres n'est une subdivision US que
 * si RIEN dans le libellé ne contredit ce pays. Un code qui est aussi un pays
 * doit être confirmé, jamais présumé.
 */
describe('corrections de pays — cohérence ville/pays obligatoire', () => {
  it.each([
    ['Berlin, DE', 'Berlin est allemande, pas le Delaware'],
    ['Hamburg, HH, de', 'Hambourg est allemande'],
    ['Jakarta, ID', 'Jakarta est indonésienne, pas l’Idaho'],
    ['Wertheim, DE', 'Wertheim est allemande'],
  ])('« %s » ne devient PAS américaine (%s)', (location) => {
    expect(resolveGeography({ location }).countryCode).not.toBe('US');
  });

  /** Les vrais cas américains restent reconnus : la ville est américaine. */
  it.each([
    ['El Segundo, CA', 'California'],
    ['Indianapolis, IN', 'Indiana'],
    ['Idaho Falls, ID', 'Idaho'],
    ['Birmingham, AL', 'Alabama'],
    ['Nashville, TN', 'Tennessee'],
  ])('« %s » avec preuve US indépendante → %s', (location, admin) => {
    const r = resolveGeography({ location, rawCountryCode: 'US' });
    expect(r.countryCode).toBe('US');
    expect(r.adminArea1).toBe(admin);
  });
});

/**
 * L'ARBITRAGE PAR LE LEGACY : quand le pays déjà stocké nomme un AUTRE pays que
 * les États-Unis, la lecture « subdivision US » n'est qu'une hypothèse et perd.
 */
describe('collision code pays / code état — le legacy arbitre', () => {
  it('« Berlin, DE » avec legacy=DE reste allemande', () => {
    expect(resolveGeography({ location: 'Berlin, DE', legacyCountry: 'DE' }).countryCode).not.toBe('US');
  });

  it('« Jakarta, ID » avec legacy=ID reste indonésienne', () => {
    expect(resolveGeography({ location: 'Jakarta, ID', legacyCountry: 'ID' }).countryCode).not.toBe('US');
  });

  /**
   * Mais « El Segundo, CA » avec legacy=CA DOIT être corrigé : le legacy `CA`
   * est justement la valeur fausse (le code de l'état a été pris pour un pays).
   * Ce qui distingue les deux cas : le legacy est ici IDENTIQUE au suffixe, donc
   * il n'apporte aucune information indépendante.
   */
  /**
   * Le discriminant mesuré en base : les offres californiennes portent
   * `country_code: US` dans leur raw (112 cas), les allemandes portent `DE`.
   * C'est cette preuve INDÉPENDANTE qui autorise la correction.
   */
  it('« El Segundo, CA » avec country_code=US dans le raw est corrigé', () => {
    const r = resolveGeography({ location: 'El Segundo, CA', rawCountryCode: 'US' });
    expect(r.countryCode).toBe('US');
    expect(r.adminArea1).toBe('California');
  });

  it('sans preuve indépendante, on ne corrige RIEN', () => {
    expect(resolveGeography({ location: 'El Segundo, CA', legacyCountry: 'CA' }).countryCode).toBeUndefined();
  });
});

/**
 * LA LISTE DES COLLISIONS doit être EXACTE : trop large, elle bloque des cas
 * certains.
 *
 * Mesuré au backfill : `NY`, `TX`, `WA`, `FL`, `OH`, `NJ`, `DC` ne sont PAS des
 * codes pays ISO — aucune ambiguïté possible. Les avoir inclus par excès de
 * prudence bloquait 607 ajouts pourtant sûrs (« New York, NY » 158 offres,
 * « Dallas, TX » 57…).
 */
describe('collisions — seulement les codes réellement ambigus', () => {
  it.each([
    ['New York, NY', 'New York'],
    ['Dallas, TX', 'Texas'],
    ['Seattle, WA', 'Washington'],
    ['Miami, FL', 'Florida'],
    ['Columbus, OH', 'Ohio'],
    ['Secaucus, NJ', 'New Jersey'],
    ['Washington, DC', 'District of Columbia'],
  ])('« %s » est résolu sans preuve supplémentaire → US / %s', (location, admin) => {
    const r = resolveGeography({ location });
    expect(r.countryCode).toBe('US');
    expect(r.adminArea1).toBe(admin);
  });

  /** Les vraies collisions restent gardées. */
  it.each(['Berlin, DE', 'Jakarta, ID', 'El Segundo, CA', 'Nashville, TN'])(
    '« %s » exige toujours une preuve indépendante',
    (location) => expect(resolveGeography({ location }).countryCode).toBeUndefined(),
  );
});
