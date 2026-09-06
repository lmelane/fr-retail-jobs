import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Tables de données de la ville canonique — lues depuis `data/`, lisibles et
 * modifiables sans toucher au code :
 *
 * - `villes-exonymes.csv` : variante → forme affichée (Milano → Milan, 上海 →
 *   Shanghai, GENEVE → Genève), avec un pays optionnel qui conditionne la
 *   traduction (« Venice » n'est Venise que sous IT : Venice, CA existe).
 * - `villes-non-lieux.csv` : ce qui n'est jamais une ville (état, région, mode
 *   de travail, service) et qui, laissé passer, devenait une ligne du filtre
 *   Ville (« Ch » 110 offres, « Remote » 21, « Western Australia » 17 —
 *   mesuré en prod le 2026-09-06).
 */

const EXONYMS_PATH = fileURLToPath(new URL('../../data/villes-exonymes.csv', import.meta.url));
const NON_PLACES_PATH = fileURLToPath(new URL('../../data/villes-non-lieux.csv', import.meta.url));

export type Exonym = { display: string; onlyForCountry?: string };

/**
 * Clé de comparaison d'un nom de ville : sans accents, sans casse, sans
 * ponctuation ni tirets — « Neuilly-sur-Seine », « NEUILLY SUR SEINE » et
 * « Neuilly sur Seine » partagent une clé. Les lettres non latines (上海, 서울)
 * sont conservées telles quelles.
 */
export function foldCityKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function readRows(path: string, columns: number): string[][] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .slice(1) // en-tête
    .map((line) => {
      const cells = line.split(',').map((cell) => cell.trim());
      if (cells.length < columns - 1) throw new Error(`${path}: ligne illisible « ${line} »`);
      return cells;
    });
}

function loadExonyms(): Map<string, Exonym[]> {
  const map = new Map<string, Exonym[]>();
  for (const [variant, display, country] of readRows(EXONYMS_PATH, 3)) {
    if (!variant || !display) throw new Error(`villes-exonymes.csv: variante ou canonique vide (« ${variant},${display} »)`);
    const key = foldCityKey(variant);
    const entry: Exonym = country ? { display, onlyForCountry: country.toUpperCase() } : { display };
    map.set(key, [...(map.get(key) ?? []), entry]);
    // Une forme canonique est sa propre clé : « Singapour » ne doit pas être
    // relu comme un pays, « Milan » ne doit pas repasser par la casse.
    const canonicalKey = foldCityKey(display);
    if (!map.has(canonicalKey)) map.set(canonicalKey, [{ display }]);
  }
  return map;
}

function loadNonPlaces(): Set<string> {
  return new Set(readRows(NON_PLACES_PATH, 2).map(([label]) => foldCityKey(label)));
}

const EXONYMS: ReadonlyMap<string, Exonym[]> = loadExonyms();
const NON_PLACES: ReadonlySet<string> = loadNonPlaces();

/**
 * La forme canonique d'une variante, ou `undefined` si la table ne la connaît
 * pas. Une entrée conditionnée à un pays ne s'applique que si le libellé de
 * lieu porte ce pays ; sans indice de pays, la variante reste telle quelle.
 */
export function lookupExonym(key: string, countryHint?: string): string | undefined {
  const entries = EXONYMS.get(key);
  if (!entries) return undefined;
  const unconditional = entries.find((entry) => !entry.onlyForCountry);
  if (unconditional) return unconditional.display;
  return entries.find((entry) => entry.onlyForCountry === countryHint)?.display;
}

/** Vrai si le libellé (clé pliée) est un état, une région, un mode ou un service — jamais une ville. */
export function isNonPlace(key: string): boolean {
  return NON_PLACES.has(key);
}
