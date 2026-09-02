/**
 * Rough centroids per country code, for the world map of employer footprint.
 *
 * A country-level bubble (sized by offer volume) needs one point per country,
 * not per city — most foreign offers are not geocoded anyway. These are
 * approximate population centroids, good enough to place a bubble on the right
 * country. Codes match countries.ts.
 */
export const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  FR: [46.6, 2.4],
  US: [39.8, -98.6],
  GB: [54.0, -2.0],
  IT: [42.8, 12.8],
  ES: [40.2, -3.7],
  DE: [51.2, 10.4],
  NL: [52.2, 5.3],
  BE: [50.6, 4.6],
  PT: [39.6, -8.0],
  CA: [56.1, -106.3],
  CH: [46.8, 8.2],
  CN: [35.9, 104.2],
  AU: [-25.3, 133.8],
  DK: [56.0, 10.0],
  NO: [61.0, 8.5],
  SE: [62.0, 15.0],
  KR: [36.5, 127.9],
  JP: [36.2, 138.3],
  MX: [23.6, -102.6],
  MY: [4.2, 101.9],
  AE: [24.0, 54.0],
  HK: [22.3, 114.2],
  SG: [1.35, 103.8],
};
