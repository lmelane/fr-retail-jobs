import { describe, it, expect } from 'vitest';
import { cityFromLocation, displayCity, isArrondissementCity, normalizeLocationString } from './location.js';

/**
 * Behaviour these tests pin down (BDD): the dedup key rides on `city`, so a
 * parasite city ("ARRONDISSEMENT", "REMOTE -", "RUE DE LA PAIX PARIS") splits one
 * commune into several and inflates the offer count. Each case below is a real
 * misparse observed in the current code, written as the CORRECT expectation.
 */

describe('normalizeLocationString — arrondissements collapse to the parent city', () => {
  it('reads the real city when the arrondissement leads (L-1)', () => {
    // "1er arrondissement" is the FIRST comma segment; the word "arrondissement"
    // must not survive as the city — Paris is the city.
    expect(normalizeLocationString('1er arrondissement, Paris').city).toBe('PARIS');
  });

  it('reads the real city when the arrondissement trails', () => {
    expect(normalizeLocationString('Paris 1er arrondissement').city).toBe('PARIS');
    expect(normalizeLocationString('Marseille 2e arrondissement').city).toBe('MARSEILLE');
    expect(normalizeLocationString('Lyon 3e arrondissement').city).toBe('LYON');
  });

  it('handles the "arr." abbreviation', () => {
    expect(normalizeLocationString('Paris 8e arr.').city).toBe('PARIS');
    expect(normalizeLocationString('2e arr., Paris').city).toBe('PARIS');
  });
});

describe('normalizeLocationString — remote / télétravail is not a place', () => {
  it('produces no parasite city for "Remote - France" (L-2)', () => {
    expect(normalizeLocationString('Remote - France').city).toBeUndefined();
  });

  it('produces no parasite city for other remote tokens', () => {
    expect(normalizeLocationString('Full remote').city).toBeUndefined();
    expect(normalizeLocationString('Télétravail').city).toBeUndefined();
    expect(normalizeLocationString('100% télétravail').city).toBeUndefined();
    expect(normalizeLocationString('Remote').city).toBeUndefined();
  });

  it('keeps the real city when remote is only a prefix on a location', () => {
    // "Remote - Paris" still names Paris: strip the remote token, keep the city.
    expect(normalizeLocationString('Remote - Paris').city).toBe('PARIS');
  });

  it('reads the city from a later segment when the first is only a working mode', () => {
    // "Télétravail partiel, Lyon": the lead segment carries no city, Lyon does.
    expect(normalizeLocationString('Télétravail partiel, Lyon').city).toBe('LYON');
  });
});

describe('normalizeLocationString — a street address is not a city', () => {
  it('extracts the department and never yields a "rue ..." city (L-3)', () => {
    const result = normalizeLocationString('12 rue de la Paix 75002 Paris');
    expect(result.department).toBe('75');
    // The old code returned "RUE DE LA PAIX PARIS"; a street name must never be
    // the city.
    expect(result.city).not.toMatch(/RUE/);
    expect(result.city).toBe('PARIS');
  });

  it('handles avenue / boulevard prefixes the same way', () => {
    const avenue = normalizeLocationString('35 avenue Montaigne 75008 Paris');
    expect(avenue.department).toBe('75');
    expect(avenue.city).toBe('PARIS');

    const boulevard = normalizeLocationString('5 boulevard Haussmann, 75009 Paris');
    expect(boulevard.department).toBe('75');
    expect(boulevard.city).toBe('PARIS');
  });

  it('reads the city from a later segment when the street run has no parent city', () => {
    // "Cours Mirabeau, 13100 Aix-en-Provence": the street segment yields no city,
    // so the town in the next segment must win — never "MIRABEAU".
    const result = normalizeLocationString('Cours Mirabeau, 13100 Aix-en-Provence');
    expect(result.department).toBe('13');
    expect(result.city).toBe('AIX-EN-PROVENCE');
  });
});

describe('normalizeLocationString — non-regression: cases that already worked', () => {
  it('collapses arrondissement suffixes to the parent city', () => {
    expect(normalizeLocationString('Paris 08').city).toBe('PARIS');
    expect(normalizeLocationString('Lyon 3e').city).toBe('LYON');
    expect(normalizeLocationString('PARIS CEDEX 08').city).toBe('PARIS');
  });

  it('captures the department from a full postcode', () => {
    const result = normalizeLocationString('75008 Paris');
    expect(result.city).toBe('PARIS');
    expect(result.department).toBe('75');
  });

  it('takes the city from a comma-joined region string', () => {
    expect(normalizeLocationString('Paris, Ile-de-France').city).toBe('PARIS');
  });

  it('captures the department from a "75 - Paris" prefix', () => {
    const result = normalizeLocationString('75 - Paris');
    expect(result.city).toBe('PARIS');
    expect(result.department).toBe('75');
  });

  it('keeps a plain city untouched and preserves the raw string', () => {
    const result = normalizeLocationString('Bordeaux');
    expect(result.city).toBe('BORDEAUX');
    expect(result.department).toBeUndefined();
    expect(result.raw).toBe('Bordeaux');
  });

  it('returns an empty result for blank input', () => {
    expect(normalizeLocationString('').city).toBeUndefined();
    expect(normalizeLocationString(null).city).toBeUndefined();
    expect(normalizeLocationString(undefined).raw).toBe('');
  });
});

describe('normalizeLocationString — la clé de dédup suit la ville canonique', () => {
  /**
   * Deux sources qui écrivent « Milano » et « Milan » décrivent la même ville :
   * la clé de blocage (match.ts) doit les ranger dans le même seau.
   */
  it('une variante et son exonyme partagent une clé', () => {
    expect(normalizeLocationString('Milano, Italy').city).toBe('MILAN');
    expect(normalizeLocationString('Milan, Lombardy, it').city).toBe('MILAN');
    expect(normalizeLocationString('Genève, Genè, CH').city).toBe('GENEVE');
    expect(normalizeLocationString('GENEVA').city).toBe('GENEVE');
  });

  it('une ville non latine garde une clé au lieu de disparaître', () => {
    expect(normalizeLocationString('上海, Chinese Mainland').city).toBe('SHANGHAI');
    expect(normalizeLocationString('서울, 해당사항, KR').city).toBe('SEOUL');
  });

  it('un pays, un état ou un mode ne font pas une clé', () => {
    expect(normalizeLocationString('CH').city).toBeUndefined();
    expect(normalizeLocationString('Germany').city).toBeUndefined();
    expect(normalizeLocationString('France, France').city).toBeUndefined();
    expect(normalizeLocationString('NY, US, CA, US, IL, US - Remote').city).toBeUndefined();
  });

  it('« Pays, Région, Ville » se lit de la fin (Mango)', () => {
    expect(normalizeLocationString('Germany, Baden-Württemberg, Karlsruhe').city).toBe('KARLSRUHE');
    expect(normalizeLocationString('Germany, Bayern, München').city).toBe('MUNICH');
  });
});

describe('isArrondissementCity', () => {
  it('ne connaît que Paris, Lyon et Marseille', () => {
    expect(isArrondissementCity('PARIS')).toBe(true);
    expect(isArrondissementCity('LYON')).toBe(true);
    expect(isArrondissementCity('BORDEAUX')).toBe(false);
    expect(isArrondissementCity(undefined)).toBe(false);
  });
});

describe('displayCity — la casse du filtre Ville', () => {
  /**
   * Mesuré en prod le 2026-09-05 : « Paris » (1 860 offres) et « PARIS » (326)
   * apparaissaient comme deux villes distinctes dans le filtre.
   */
  it('normalise une ville criée', () => {
    expect(displayCity('PARIS')).toBe('Paris');
    expect(displayCity('NEW YORK')).toBe('New York');
    expect(displayCity('LAS VEGAS')).toBe('Las Vegas');
  });

  it('garde les particules en minuscules', () => {
    expect(displayCity('NEUILLY-SUR-SEINE')).toBe('Neuilly-sur-Seine');
    expect(displayCity('AIX-EN-PROVENCE')).toBe('Aix-en-Provence');
    expect(displayCity('King Of Prussia')).toBe('King of Prussia');
    expect(displayCity('Frankfurt Am Main')).toBe('Francfort');
    expect(displayCity('Ciudad de Mexico')).toBe('Mexico City');
    expect(displayCity('Rio de Janeiro')).toBe('Rio de Janeiro');
    expect(displayCity('Lauf An Der Pegnitz')).toBe('Lauf an der Pegnitz');
  });

  it('ne touche pas à une casse mixte déjà correcte', () => {
    expect(displayCity("L'Haÿ-les-Roses")).toBe("L'Haÿ-les-Roses");
    expect(displayCity('McLean')).toBe('McLean');
    expect(displayCity('Mclean')).toBe('McLean');
    expect(displayCity("'s-Hertogenbosch")).toBe('Bois-le-Duc');
    expect(displayCity('Al Khobar')).toBe('Al Khobar');
  });

  it('rend undefined sur du vide', () => {
    expect(displayCity('')).toBeUndefined();
    expect(displayCity(null)).toBeUndefined();
  });
});

/**
 * Quarante cas réels tirés de `Job.city` / `Job.location` en prod le
 * 2026-09-06 (export l4, 70 221 offres actives, 8 047 villes distinctes),
 * écrits avant → après. Le lieu brut reste dans `location` ; seule la ville
 * affichée change.
 */
describe('displayCity — (1) un pays, un état ou un mode de travail ne sont pas une ville', () => {
  it.each([
    ['Ch', 'avolta ×110 — code ISO'],
    ['Nl', 'avolta ×74'],
    ['Us', 'stripe-stare, toast ×90'],
    ['United States', 'quince, dept ×89'],
    ['Germany', 'mango ×67'],
    ['Usa', 'a-derma, toast ×45'],
    ['Italy', 'jd-sports ×43'],
    ['Remote', 'bentley ×21'],
    ['Ny', 'dept, deckers ×26 — état'],
    ['Sf', 'stripe-stare ×19'],
    ['Flexible', 'beiersdorf ×7'],
    ['Emea', 'tulip ×4'],
    ['Tbd', 'reformation ×3'],
    ['International', 'michael-page ×7'],
    ['Western Australia', 'mecca ×17 — état'],
    ['QLD, Other', 'bevilles ×6'],
    ['Us - California', 'deckers ×24 — pays puis état'],
    ['Apac-C1', 'gate ×17'],
    ['Chinese Mainland', 'lvmh ×8'],
    ['France, France', 'michael-page ×13'],
    ['Remote, US', 'stripe-stare'],
    ['Remote - US', 'toast'],
    ['Royaume Uni - Reseau', 'a-derma ×4 — pays puis service'],
    ['Etats-Unis - Texas', 'diptyque ×5'],
    ['Île-de-France', 'michael-page ×3'],
    ['Peru, 🇵🇪 Peru', 'infuse'],
    ['Guernsey, The Channel Islands, GY1', 'white-stuff'],
  ])('« %s » → aucune ville (%s)', (raw) => {
    expect(displayCity(raw)).toBeUndefined();
  });

  it.each([
    ['Germany, Bayern, München', 'Munich'],
    ['Germany, Baden-Württemberg, Karlsruhe', 'Karlsruhe'],
    ['Australia, Bondi', 'Bondi'],
    ['Etats-Unis - New York', 'New York'],
    ['Belgique - Bruxelles - Bureau', 'Bruxelles'],
    ['Onsite - Phoenix', 'Phoenix'],
    ['Metropolitan Area - Miami', 'Miami'],
    ['Royaume Uni - Reading', 'Reading'],
    ['Etats-Unis - Californie - Los Angeles', 'Los Angeles'],
    ['Etats-Unis - Washington', 'Washington'],
    ['Canada - Vancouver', 'Vancouver'],
    ['Allemagne - Berlin', 'Berlin'],
    ['US-NYC; US-San Francisco; US-Seattle', 'New York'],
    ['Germany - Berlin; London, England, United Kingdom', 'Berlin'],
    ['Hong Kong - Hong Kong', 'Hong Kong'],
    ['Luxembourg, Luxembourg, lu', 'Luxembourg'],
  ])('« %s » → la ville derrière le pays : %s', (raw, expected) => {
    expect(displayCity(raw)).toBe(expected);
  });
});

describe('displayCity — (2) un libellé de magasin ou de bureau n’est pas une ville', () => {
  it.each([
    ['Bg 0263 Bg Womens Store', 'saks ×48'],
    ['Sg 9001 India', 'saks ×20'],
    ['Sf 0689 Saks Direct', 'saks ×13'],
    ['American Dream Mall', 'levis'],
    ['Ch - Foxtown Ugg Retail Outlet Store', 'deckers'],
    ['Hq-Office', 'levis ×20'],
    ['Office', 'levis ×16'],
    ['US - IN Mooresville Distribution Center', 'deckers'],
    ['Lfo Bataviastad Fashion Outlet', 'levis ×9'],
    ['Retail - la', 'aime-leon-dore ×5'],
  ])('« %s » → aucune ville (%s)', (raw) => {
    expect(displayCity(raw)).toBeUndefined();
  });

  it.each([
    ['Nm 0212 San Francisco', 'San Francisco'],
    ['Sf 0630 Boston Fl', 'Boston'],
    ['Sf 0632 Miami - Dadeland Fl', 'Miami'],
    ['O5 0776 Westbury', 'Westbury'],
    ['Chestnut Hill - Retail', 'Chestnut Hill'],
    ['Houston - Retail', 'Houston'],
    ['Head Office, South Anne Street, Dublin', 'Dublin'],
    ['Berlin Head Office, Expansion', 'Berlin'],
    ['Brisbane Airport, Australia - QLD, 4008', 'Brisbane'],
    ['UGG Newbury Street Pop Up (Boston, MA)', 'Boston'],
    ['HOKA Toronto Eaton Centre (Toronto, ON)', 'Toronto'],
    ['Albertville Premium Outlets, Albertville, MN, USA', 'Albertville'],
    ['LFO BATAVIASTAD FASHION OUTLET, Lelystad, Netherlands', 'Lelystad'],
    ['Hot Topic HQ - City of Industry, California', 'City of Industry'],
    ['DTC Office, Amsterdam', 'Amsterdam'],
    ['Byron Center, Michigan, 49315', 'Byron Center'],
    ['Boutique CAR - RIYADH xxxxxx (SARI0037)', 'Riyad'],
    ['Tysons Corner, VA, USA (2671 - Tysons Corner)', 'Tysons'],
    ['Store 00821 Market Mall, AB-Calgary,AB T3A0E2', 'Calgary'],
  ])('« %s » → %s', (raw, expected) => {
    expect(displayCity(raw)).toBe(expected);
  });
});

describe('displayCity — (3) une ville en chinois, coréen ou japonais s’affiche par son exonyme', () => {
  /** lvmh ×570 : la facette du site affichait « 上海 (127) ». Le nom d'origine reste dans `location`. */
  it.each([
    ['上海', 'Shanghai'],
    ['静安区', 'Shanghai'],
    ['浦东新区', 'Shanghai'],
    ['北京', 'Pékin'],
    ['朝阳区', 'Pékin'],
    ['广州', 'Guangzhou'],
    ['深圳', 'Shenzhen'],
    ['杭州', 'Hangzhou'],
    ['上城区', 'Hangzhou'],
    ['武汉', 'Wuhan'],
    ['南京', 'Nankin'],
    ['서울', 'Séoul'],
    ['부산', 'Busan'],
    ['香港特别行政区', 'Hong Kong'],
    ['東京', 'Tokyo'],
    ['亳州', 'Bozhou'],
  ])('« %s » → %s', (raw, expected) => {
    expect(displayCity(raw)).toBe(expected);
  });

  it('Guangzhou ne devient pas « Canton » : 32 offres américaines s’appellent déjà Canton', () => {
    expect(displayCity('Canton, Ohio')).toBe('Canton');
    expect(displayCity('Guangzhou, China Mainland')).toBe('Guangzhou');
    expect(displayCity('Canton')).not.toBe('Guangzhou');
  });

  it('une province ou un périmètre chinois n’est pas une ville', () => {
    expect(displayCity('海南省')).toBeUndefined();
    expect(displayCity('全国')).toBeUndefined();
    expect(displayCity('开放中')).toBeUndefined();
  });

  it('une ville non latine inconnue de la table est gardée telle quelle plutôt que perdue', () => {
    expect(displayCity('某某市')).toBe('某某市');
  });
});

describe('displayCity — (4) une seule forme canonique par ville, française quand elle est courante', () => {
  it.each([
    ['Milano', 'Milan'],
    ['Milan', 'Milan'],
    ['MILAN', 'Milan'],
    ['Genève', 'Genève'],
    ['Geneva', 'Genève'],
    ['Geneve', 'Genève'],
    ['GENÈVE', 'Genève'],
    ['Köln', 'Cologne'],
    ['Koln', 'Cologne'],
    ['Cologne', 'Cologne'],
    ['München', 'Munich'],
    ['Munchen', 'Munich'],
    ['Lisboa', 'Lisbonne'],
    ['Lisbon', 'Lisbonne'],
    ['Wien', 'Vienne'],
    ['Roma', 'Rome'],
    ['Firenze', 'Florence'],
    ['Venezia', 'Venise'],
    ['Brussels', 'Bruxelles'],
    ['Brussel', 'Bruxelles'],
    ['BRUXELLES', 'Bruxelles'],
    ['Antwerpen', 'Anvers'],
    ['Antwerp', 'Anvers'],
    ['Praha', 'Prague'],
    ['Praha 1', 'Prague'],
    ['Warszawa', 'Varsovie'],
    ['Kraków', 'Cracovie'],
    ['Krakow', 'Cracovie'],
    ['Sevilla', 'Séville'],
    ['Seville', 'Séville'],
    ['London', 'Londres'],
    ['London, United Kingdom', 'Londres'],
    ['New York City', 'New York'],
    ['NYC', 'New York'],
    ['Frankfurt am Main', 'Francfort'],
    ['Frankfurt', 'Francfort'],
    ['Dusseldorf', 'Düsseldorf'],
    ['Sao Paulo', 'São Paulo'],
    ['Montreal', 'Montréal'],
    ['Bucuresti', 'Bucarest'],
    ['Bucharest', 'Bucarest'],
    ['Torino', 'Turin'],
    ['Napoli', 'Naples'],
    ['Athina', 'Athènes'],
    ['Zürich', 'Zurich'],
    ['Copenhagen', 'Copenhague'],
    ['Dubai', 'Dubaï'],
    ['Beijing', 'Pékin'],
    ['Seoul (DOM)', 'Séoul'],
    ['Biel/Bienne', 'Bienne'],
    ['Hong Kong SAR, China', 'Hong Kong'],
    ['Hong Kong Sar', 'Hong Kong'],
    ['Singapore', 'Singapour'],
    ['Singapour, Sgp (Coach Sg Resorts World Sentosa - Autocar)', 'Singapour'],
    ['Macau SAR', 'Macao'],
    ['Ciudad de México', 'Mexico City'],
    ['Mexico City', 'Mexico City'],
    ['Ho Chi Minh City', 'Hô Chi Minh-Ville'],
    ['Neuilly sur Seine', 'Neuilly-sur-Seine'],
    ['Neuilly Sur Seine', 'Neuilly-sur-Seine'],
    ['NEUILLY-SUR-SEINE', 'Neuilly-sur-Seine'],
    ['Levallois Perret', 'Levallois-Perret'],
    ['Issy les Moulineaux', 'Issy-les-Moulineaux'],
    ['Olonne sur Mer - LES SABLES D’OLONNE', 'Olonne-sur-Mer'],
    ['Orleans', 'Orléans'],
    ['St Louis, Missouri', 'St. Louis'],
    ['Saint Louis, MO', 'St. Louis'],
  ])('« %s » → %s', (raw, expected) => {
    expect(displayCity(raw)).toBe(expected);
  });

  /**
   * Un exonyme anglais qui est AUSSI le nom d'une ville américaine ne se
   * traduit que si le libellé porte le pays : mesuré en prod, « Vienna » =
   * Virginie 14 / Autriche 25, « Athens » = Georgia 12 + Tennessee 7 / Grèce
   * ~30, « Venice » = Californie 12 + Floride 7 / Italie 25, « Moscow » = Idaho
   * 5 / Russie 0, « Warsaw » = Indiana 6 / Pologne 27.
   */
  it.each([
    ['Vienna, Austria', 'Vienne'],
    ['Vienna, AT', 'Vienne'],
    ['Vienna, Virginia', 'Vienna'],
    ['Vienna', 'Vienna'],
    ['Athens, GR', 'Athènes'],
    ['Athens, Georgia', 'Athens'],
    ['Venice, Italy', 'Venise'],
    ['Venice, CA', 'Venice'],
    ['Warsaw, Poland', 'Varsovie'],
    ['Warsaw, Indiana', 'Warsaw'],
    ['Moscow, Idaho', 'Moscow'],
    ['Toledo, Ohio', 'Toledo'],
    ['Toledo, Castile-La Mancha, Spain', 'Tolède'],
  ])('« %s » → %s (exonyme conditionné au pays)', (raw, expected) => {
    expect(displayCity(raw)).toBe(expected);
  });

  it('accepte un indice de pays séparé, pour un adaptateur qui fournit la ville seule', () => {
    expect(displayCity('Venice', 'Venice, Italy')).toBe('Venise');
    expect(displayCity('Venice', 'IT')).toBe('Venise');
    expect(displayCity('Vienna', 'Vienna, Virginia')).toBe('Vienna');
  });
});

describe('displayCity — (5) un arrondissement se range sous sa ville', () => {
  /** michael-page-france ×202, nocibe-eqwa, naos, eram, element. */
  it.each([
    ['Paris-8e-Arrondissement', 'Paris'],
    ['Paris-1er-Arrondissement', 'Paris'],
    ['Lyon-1er-Arrondissement', 'Lyon'],
    ['Marseille-16e-Arrondissement', 'Marseille'],
    ['Paris 12ème', 'Paris'],
    ['Paris 1er', 'Paris'],
    ['Paris 8e', 'Paris'],
    ['Paris 08', 'Paris'],
    ['PARIS-09', 'Paris'],
    ['Lyon-02', 'Lyon'],
    ['Lyon 03 (69383)', 'Lyon'],
    ['Paris 14 (75114)', 'Paris'],
    ['Nantes Cedex 2', 'Nantes'],
    ['Dublin 2', 'Dublin'],
    ['1er arrondissement, Paris', 'Paris'],
  ])('« %s » → %s', (raw, expected) => {
    expect(displayCity(raw)).toBe(expected);
  });
});

describe('displayCity — (6) code postal, pays collé, parenthèses, majuscules', () => {
  it.each([
    ['75008 Paris', 'Paris'],
    ['Paris, France', 'Paris'],
    ['Paris, FR', 'Paris'],
    ['Milano (MI)', 'Milan'],
    ['PARIS', 'Paris'],
    ['Aix en Provence (13001)', 'Aix-en-Provence'],
    ['AIX EN PROVENCE (13001), FR', 'Aix-en-Provence'],
    ['Toronto Canada', 'Toronto'],
    ['London United Kingdom', 'Londres'],
    ['Berlin Germany', 'Berlin'],
    ['Perth Western Australia', 'Perth'],
    ['Perth (Western Australia)', 'Perth'],
    ['New York, NY, USA', 'New York'],
    ['New York,US-NY,United States', 'New York'],
    ['Stamford, CT', 'Stamford'],
    ['Sanford (NC)', 'Sanford'],
    ['Sulzbach (Taunus)', 'Sulzbach'],
    ['Majadahonda (MADRID)', 'Majadahonda'],
    ['W1B 3BN London, United Kingdom', 'Londres'],
    ['B5 4BG Birmingham, United Kingdom', 'Birmingham'],
    ['Etobicoke On M9c 1b8', 'Etobicoke'],
    ['21010 Ferno VA, IT', 'Ferno'],
    ['Roissy-en-France', 'Roissy-en-France'],
    ['ROISSY-EN-FRANCE, 95700, Île-de-France', 'Roissy-en-France'],
    ['Tremblay En France', 'Tremblay-en-France'],
    ['TREMBLAY EN France, France', 'Tremblay-en-France'],
    ['PARIS, 75000, Île-de-France', 'Paris'],
    ['São Paulo, São Paulo - SP, 04533-012', 'São Paulo'],
    ['Nottingham, Nottingham Support Office', 'Nottingham'],
    ['Columbus,US-OH,United States', 'Columbus'],
    ['Beaverton, Oregon', 'Beaverton'],
    ['Hannover, Marketing', 'Hanovre'],
    ['Genève, Genè, CH', 'Genève'],
    ['Manchester, Trafford, England, United Kingdom, M17', 'Manchester'],
  ])('« %s » → %s', (raw, expected) => {
    expect(displayCity(raw)).toBe(expected);
  });

  it('un nom de ville qui contient un pays reste entier', () => {
    expect(displayCity('Tremblay-en-France')).toBe('Tremblay-en-France');
    expect(displayCity('Roissy-en-France')).toBe('Roissy-en-France');
  });
});

describe('cityFromLocation — la ville que porte un libellé libre', () => {
  /**
   * Mesuré en prod le 2026-09-05 : 30 716 offres actives (61 %) sans aucune
   * ville, dont 24 681 portaient pourtant un `location` exploitable. Le champ
   * n'était jamais dérivé — il ne venait que des adaptateurs qui le
   * renseignent. Sans ville, l'offre est infiltrable et absente de la carte.
   *
   * Depuis l4 : la valeur rendue est la ville AFFICHABLE (accents et casse
   * conservés, exonyme appliqué), plus la clé majuscule sans accents — sinon
   * « Genève, Genè, CH » donnait « Geneve » (48 offres à côté des 151 « Genève »).
   */
  it.each([
    ['Paris', 'Paris'],
    ['Beaverton, Oregon', 'Beaverton'],
    ['New York,US-NY,United States', 'New York'],
    ['London, England, gb', 'Londres'],
    ['Genève, Genè, CH', 'Genève'],
    ['Montréal, QC, ca', 'Montréal'],
  ])('%s -> %s', (raw, city) => {
    expect(cityFromLocation(raw)).toBe(city);
  });

  it('saute un segment de voirie au lieu d’abandonner le libellé', () => {
    // Rejeter tout perdrait New York ; le garder donnerait « World Trade Center ».
    expect(cityFromLocation('1 World Trade Center, New York, NY')).toBe('New York');
    expect(cityFromLocation('12 rue de la Paix, Paris')).toBe('Paris');
    expect(cityFromLocation('400 Oxford St, London, W1A 1AB')).toBe('Londres');
  });

  it('un mode de travail n’est pas un lieu', () => {
    expect(cityFromLocation('Remote')).toBeUndefined();
    expect(cityFromLocation('Télétravail')).toBeUndefined();
    expect(cityFromLocation('US - California Remote')).toBeUndefined();
  });

  it('rend undefined sur du vide', () => {
    expect(cityFromLocation('')).toBeUndefined();
    expect(cityFromLocation(null)).toBeUndefined();
  });

  it('est idempotent : re-passer une ville déjà canonique ne la change pas', () => {
    for (const city of ['Paris', 'Genève', 'Londres', 'Neuilly-sur-Seine', 'St. Louis', 'Hô Chi Minh-Ville', 'Shanghai', 'Mexico City']) {
      expect(displayCity(city)).toBe(city);
    }
  });
});
