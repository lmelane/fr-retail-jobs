import { normalizeCountry } from '../normalize/country.js';
/** Audit a4 — ce que le normaliseur pays rend pour les libellés trouvés en base (aucun réseau). */
for (const v of ["États-Unis d'Amérique", 'France', 'United States', 'fr', 'gb', 'Royaume-Uni', 'Italie', 'Hong Kong, RAS Chine', 'Singapour', 'Taïwan', 'Taiwan Region', 'Mainland China', 'United States of America', 'Malaisie', 'Allemagne'])
  console.log(JSON.stringify(v), '->', normalizeCountry(v));
