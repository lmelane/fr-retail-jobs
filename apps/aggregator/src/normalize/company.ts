import { canonicalCompanyKey } from '../lib/normalize.js';

/**
 * Company identity resolution.
 *
 * The same employer reaches us under many names — "DIOR", "Christian Dior Couture",
 * "Christian Dior Couture SA". Dedup blocks on the company, so unless these collapse
 * to one identity the same opening is stored three times.
 *
 * Resolution runs in two steps:
 *   1. an explicit alias table (the only way to know DIOR == Christian Dior Couture)
 *   2. otherwise, a normalized key with legal suffixes and group prefixes stripped
 *
 * Deliberately conservative: it never guesses that two unlisted names are the same
 * company. A wrong merge silently destroys a real job, which is worse than a
 * duplicate a human can still see.
 */

export type CompanyIdentity = {
  /** Stable id used as the dedup blocking key. */
  companyId: string;
  /** Preferred display name. */
  displayName: string;
  /** Parent group, when known. */
  group?: string;
};

/**
 * Seeded from names actually observed in the sources on 2026-09-01: the LVMH
 * `criteria` endpoint (76 maisons), the FashionJobs directory (668 companies) and
 * the employer feeds. Extend as new spellings turn up — this is data, not logic.
 */
const ALIASES: ReadonlyArray<readonly [string, CompanyIdentity]> = [
  ['DIOR', { companyId: 'DIOR', displayName: 'Christian Dior Couture', group: 'LVMH' }],
  ['CHRISTIAN DIOR', { companyId: 'DIOR', displayName: 'Christian Dior Couture', group: 'LVMH' }],
  ['CHRISTIAN DIOR COUTURE', { companyId: 'DIOR', displayName: 'Christian Dior Couture', group: 'LVMH' }],
  ['PARFUMS CHRISTIAN DIOR', { companyId: 'PARFUMS_DIOR', displayName: 'Parfums Christian Dior', group: 'LVMH' }],
  ['LOUIS VUITTON', { companyId: 'LOUIS_VUITTON', displayName: 'Louis Vuitton', group: 'LVMH' }],
  ['LV', { companyId: 'LOUIS_VUITTON', displayName: 'Louis Vuitton', group: 'LVMH' }],
  // The legal employer name group feeds use; without it, "Louis Vuitton
  // Malletier" and "Louis Vuitton" split into two companies and the same
  // opening is stored twice (the group-vs-brand collision, J2).
  ['LOUIS VUITTON MALLETIER', { companyId: 'LOUIS_VUITTON', displayName: 'Louis Vuitton', group: 'LVMH' }],
  ['SEPHORA', { companyId: 'SEPHORA', displayName: 'Sephora', group: 'LVMH' }],
  ['CELINE', { companyId: 'CELINE', displayName: 'Celine', group: 'LVMH' }],
  ['GIVENCHY', { companyId: 'GIVENCHY', displayName: 'Givenchy', group: 'LVMH' }],
  ['FENDI', { companyId: 'FENDI', displayName: 'Fendi', group: 'LVMH' }],
  ['LOEWE', { companyId: 'LOEWE', displayName: 'Loewe', group: 'LVMH' }],
  ['BERLUTI', { companyId: 'BERLUTI', displayName: 'Berluti', group: 'LVMH' }],
  ['LORO PIANA', { companyId: 'LORO_PIANA', displayName: 'Loro Piana', group: 'LVMH' }],
  ['GROUPE BON MARCHE', { companyId: 'BON_MARCHE', displayName: 'Le Bon Marché', group: 'LVMH' }],
  ['LE BON MARCHE', { companyId: 'BON_MARCHE', displayName: 'Le Bon Marché', group: 'LVMH' }],
  ['BULGARI', { companyId: 'BULGARI', displayName: 'Bulgari', group: 'LVMH' }],
  ['BVLGARI', { companyId: 'BULGARI', displayName: 'Bulgari', group: 'LVMH' }],
  ['TIFFANY AND CO', { companyId: 'TIFFANY', displayName: 'Tiffany & Co.', group: 'LVMH' }],
  ['TIFFANY', { companyId: 'TIFFANY', displayName: 'Tiffany & Co.', group: 'LVMH' }],

  ['GUCCI', { companyId: 'GUCCI', displayName: 'Gucci', group: 'Kering' }],
  ['SAINT LAURENT', { companyId: 'SAINT_LAURENT', displayName: 'Saint Laurent', group: 'Kering' }],
  ['YVES SAINT LAURENT', { companyId: 'SAINT_LAURENT', displayName: 'Saint Laurent', group: 'Kering' }],
  ['YSL', { companyId: 'SAINT_LAURENT', displayName: 'Saint Laurent', group: 'Kering' }],
  ['BALENCIAGA', { companyId: 'BALENCIAGA', displayName: 'Balenciaga', group: 'Kering' }],
  ['BOTTEGA VENETA', { companyId: 'BOTTEGA_VENETA', displayName: 'Bottega Veneta', group: 'Kering' }],
  ['KERING', { companyId: 'KERING', displayName: 'Kering', group: 'Kering' }],

  ['CARTIER', { companyId: 'CARTIER', displayName: 'Cartier', group: 'Richemont' }],
  ['VAN CLEEF AND ARPELS', { companyId: 'VAN_CLEEF', displayName: 'Van Cleef & Arpels', group: 'Richemont' }],
  ['VAN CLEEF ARPELS', { companyId: 'VAN_CLEEF', displayName: 'Van Cleef & Arpels', group: 'Richemont' }],
  ['RICHEMONT', { companyId: 'RICHEMONT', displayName: 'Richemont', group: 'Richemont' }],

  ['SANDRO', { companyId: 'SANDRO', displayName: 'Sandro', group: 'SMCP' }],
  ['MAJE', { companyId: 'MAJE', displayName: 'Maje', group: 'SMCP' }],
  ['CLAUDIE PIERLOT', { companyId: 'CLAUDIE_PIERLOT', displayName: 'Claudie Pierlot', group: 'SMCP' }],

  ['LOREAL', { companyId: 'LOREAL', displayName: "L'Oréal", group: "L'Oréal" }],
  ['L OREAL', { companyId: 'LOREAL', displayName: "L'Oréal", group: "L'Oréal" }],
  ['HERMES', { companyId: 'HERMES', displayName: 'Hermès' }],
  ['CHANEL', { companyId: 'CHANEL', displayName: 'Chanel' }],
  ['COURIR', { companyId: 'COURIR', displayName: 'Groupe Courir' }],
  ['GROUPE COURIR', { companyId: 'COURIR', displayName: 'Groupe Courir' }],
  ['LACOSTE', { companyId: 'LACOSTE', displayName: 'Lacoste' }],
  ['DECATHLON', { companyId: 'DECATHLON', displayName: 'Decathlon' }],
  ['GALERIES LAFAYETTE', { companyId: 'GALERIES_LAFAYETTE', displayName: 'Galeries Lafayette' }],
  ['PRINTEMPS', { companyId: 'PRINTEMPS', displayName: 'Printemps' }],
  ['PUIG', { companyId: 'PUIG', displayName: 'Puig' }],
];

const ALIAS_INDEX = new Map<string, CompanyIdentity>(
  ALIASES.map(([alias, identity]) => [canonicalCompanyKey(alias), identity]),
);

/** Group prefixes that carry no identity of their own ("GROUPE X" -> "X"). */
const GROUP_PREFIX = /^(GROUPE|GROUP|MAISON|LES BOUTIQUES)\s+/;

/**
 * A group ATS feed publishes its whole portfolio under one endpoint and labels
 * every posting "<lead brand> +N" — "Cartier +3", "Helena Rubinstein +8" — where
 * N counts the other maisons on that feed. That counter is not part of any
 * company's name; kept, it forges a phantom employer ("Cartier +3") a candidate
 * sees on thousands of offers, distinct from the real one.
 *
 * The counter is always a space, a plus and digits at the very end, so the plus
 * inside a real name ("Dr. Jart+") is safe: only " +13" is removed, leaving
 * "Dr. Jart+". A trailing "+" with no digits is left alone.
 */
export function stripMultiBrandSuffix(rawName: string): string {
  return rawName.replace(/\s+\+\d+\s*$/, '').trim();
}

export function resolveCompany(rawName: string): CompanyIdentity {
  const name = stripMultiBrandSuffix(rawName);
  const key = canonicalCompanyKey(name);

  const direct = ALIAS_INDEX.get(key);
  if (direct) return direct;

  const withoutPrefix = key.replace(GROUP_PREFIX, '').trim();
  const viaPrefix = ALIAS_INDEX.get(withoutPrefix);
  if (viaPrefix) return viaPrefix;

  // Unknown employer: keep it distinct rather than risk a wrong merge.
  return {
    companyId: withoutPrefix.replace(/\s+/g, '_') || key.replace(/\s+/g, '_'),
    displayName: name,
  };
}
