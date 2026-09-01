import { normalizeLocation } from './normalize.js';

const frenchSignals = [
  'FRANCE', 'PARIS', 'LYON', 'MARSEILLE', 'TOULOUSE', 'BORDEAUX', 'LILLE', 'NANTES',
  'NICE', 'STRASBOURG', 'RENNES', 'MONTPELLIER', 'GRENOBLE', 'ROUEN', 'TOULON',
  'DIJON', 'ANGERS', 'REIMS', 'CAEN', 'ORLEANS', 'ORLÉANS', 'ANNECY', 'CANNES',
  'AIX-EN-PROVENCE', 'VERSAILLES', 'BOULOGNE-BILLANCOURT', 'NEUILLY', 'SAINT-DENIS',
  'ILE-DE-FRANCE', 'ÎLE-DE-FRANCE', 'ROISSY', 'TREMBLAY', 'LA DEFENSE', 'LA DÉFENSE',
];

export function isFranceJob(country?: string, location?: string): boolean {
  const c = (country ?? '').trim().toUpperCase();
  if (['FR', 'FRA', 'FRANCE'].includes(c)) return true;
  if (c && !['REMOTE', 'EUROPE', 'EU'].includes(c)) return false;
  const loc = normalizeLocation(location ?? '');
  return frenchSignals.some((signal) => loc.includes(normalizeLocation(signal))) || /\b75\d{3}\b/.test(loc);
}
