import { normalizeLocation } from './normalize.js';

/**
 * Is this posting located in France?
 *
 * The country field decides when present. Otherwise the location string is read
 * for a French signal — but on WORD BOUNDARIES, not as a substring: "Venice"
 * contains "nice", "Varennes" contains "rennes", and a substring match put both
 * on the French map. A foreign-place signal (a non-FR country or region named in
 * the string) overrides a coincidental French token, so "Caen, Belgium" is not
 * France.
 */

/** French cities/regions that, as whole words, mark a location as French. */
const FRENCH_SIGNALS = [
  'FRANCE', 'PARIS', 'LYON', 'MARSEILLE', 'TOULOUSE', 'BORDEAUX', 'LILLE', 'NANTES',
  'NICE', 'STRASBOURG', 'RENNES', 'MONTPELLIER', 'GRENOBLE', 'ROUEN', 'TOULON',
  'DIJON', 'ANGERS', 'REIMS', 'CAEN', 'ORLEANS', 'ANNECY', 'CANNES', 'METZ', 'NANCY',
  'CLERMONT-FERRAND', 'LE HAVRE', 'BREST', 'TOURS', 'LIMOGES', 'AMIENS', 'PERPIGNAN',
  'AIX-EN-PROVENCE', 'VERSAILLES', 'BOULOGNE-BILLANCOURT', 'NEUILLY', 'SAINT-DENIS',
  'ILE-DE-FRANCE', 'ROISSY', 'TREMBLAY', 'LA DEFENSE', 'NANTERRE', 'PACA',
  'AUVERGNE-RHONE-ALPES', 'NOUVELLE-AQUITAINE', 'OCCITANIE', 'HAUTS-DE-FRANCE',
  'GRAND EST', 'NORMANDIE', 'BRETAGNE', 'PROVENCE',
];

/**
 * Tokens that name a foreign place. If any appears, a coincidental French token
 * in the same string does not make the offer French.
 */
const FOREIGN_SIGNALS = [
  'BELGIUM', 'BELGIQUE', 'BELGIE', 'SWITZERLAND', 'SUISSE', 'SCHWEIZ', 'GENEVA', 'GENEVE', 'ZURICH',
  'GERMANY', 'ALLEMAGNE', 'DEUTSCHLAND', 'BERLIN', 'MUNICH', 'ITALY', 'ITALIA', 'ITALIE',
  'MILAN', 'MILANO', 'ROME', 'ROMA', 'SPAIN', 'ESPANA', 'ESPAGNE', 'MADRID', 'BARCELONA', 'BARCELONE',
  'UNITED KINGDOM', 'UK', 'ENGLAND', 'LONDON', 'LONDRES', 'IRELAND', 'DUBLIN',
  'NETHERLANDS', 'AMSTERDAM', 'PORTUGAL', 'LISBON', 'LISBOA', 'LISBONNE',
  'USA', 'UNITED STATES', 'NEW YORK', 'CALIFORNIA', 'FLORIDA', 'CANADA', 'QUEBEC', 'MONTREAL',
  'CHINA', 'CHINE', 'JAPAN', 'JAPON', 'TOKYO', 'HONG KONG', 'SINGAPORE', 'SINGAPOUR', 'DUBAI', 'UAE',
  'AUSTRIA', 'AUTRICHE', 'VIENNA', 'VIENNE', 'POLAND', 'POLOGNE', 'SWEDEN', 'SUEDE', 'DENMARK', 'DANEMARK',
];

/** Whole-word match of any signal inside the normalized location. */
function matchesAny(loc: string, signals: readonly string[]): boolean {
  return signals.some((signal) => {
    const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?:[^A-Z0-9]|$)`).test(loc);
  });
}

export function isFranceJob(country?: string, location?: string): boolean {
  const c = (country ?? '').trim().toUpperCase();
  if (['FR', 'FRA', 'FRANCE'].includes(c)) return true;
  if (c && !['REMOTE', 'EUROPE', 'EU'].includes(c)) return false;

  const loc = normalizeLocation(location ?? '');
  if (!loc) return false;

  // A named foreign place overrides a coincidental French token.
  if (matchesAny(loc, FOREIGN_SIGNALS)) return false;

  // A Paris postcode (75xxx) or any French signal as a whole word.
  if (/(?:^|[^0-9])75\d{3}(?:[^0-9]|$)/.test(loc)) return true;
  return matchesAny(loc, FRENCH_SIGNALS);
}
