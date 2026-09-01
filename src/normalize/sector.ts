/**
 * Sector classification — decides whether a posting belongs in Catwalks.
 *
 * The filter is deliberately company-first, not title-first: "Carrefour —
 * Développeur Java" is out, "Sephora — Data Analyst" is in. A tech title at a
 * beauty retailer is a Catwalks job; the same title at a supermarket is not.
 * So an in-sector employer keeps its whole job list, and the title is only used
 * as a weak signal when the employer is unknown.
 */

export type Sector =
  | 'FASHION'
  | 'LUXURY'
  | 'BEAUTY'
  | 'JEWELRY_WATCHES'
  | 'RETAIL'
  | 'OTHER';

export type SectorVerdict = {
  sector: Sector;
  /** True when the posting should enter the Catwalks database. */
  inScope: boolean;
  reason: string;
};

/**
 * LVMH business groups, from the live `criteria` endpoint (2026-09-01).
 * "Vins & Spiritueux" and "Autres activités" (hotels, media) are intentionally
 * NOT mapped in-scope: a Moët logistics role is not a Catwalks job.
 */
const LVMH_BUSINESS_GROUP_SECTORS: Record<string, Sector> = {
  'Mode & Maroquinerie': 'FASHION',
  'Parfums & Cosmétiques': 'BEAUTY',
  'Montres & Joaillerie': 'JEWELRY_WATCHES',
  'Distribution Sélective': 'RETAIL',
};

/** Employer-name signals, checked against the canonical (accent-free) name. */
const COMPANY_SIGNALS: ReadonlyArray<readonly [Sector, RegExp]> = [
  ['BEAUTY', /SEPHORA|NOCIBE|MARIONNAUD|YVES ROCHER|CLARINS|LOREAL|L OREAL|ESTEE LAUDER|GUERLAIN|KIKO|RITUALS|OCCITANE|PARFUM|COSMETIC|BEAUTY/],
  ['JEWELRY_WATCHES', /CARTIER|VAN CLEEF|CHAUMET|BOUCHERON|MESSIKA|SWAROVSKI|PANDORA|HISTOIRE D OR|TAG HEUER|HUBLOT|ZENITH|ROLEX|JOAILLERIE|HORLOGERIE/],
  ['LUXURY', /LOUIS VUITTON|DIOR|CHANEL|HERMES|GUCCI|PRADA|BALENCIAGA|SAINT LAURENT|CELINE|GIVENCHY|FENDI|LOEWE|LORO PIANA|BERLUTI|KENZO|CHLOE|LANVIN|BALMAIN|JACQUEMUS|RICHEMONT|KERING|LVMH/],
  ['FASHION', /ZARA|H ?ET ?M|H&M|UNIQLO|MANGO|PRIMARK|KIABI|CELIO|JULES|SANDRO|MAJE|CLAUDIE PIERLOT|SMCP|LACOSTE|SEZANE|BA ?SH|AMI PARIS|ISABEL MARANT|VEJA|PATOU|ETAM|PIMKIE|MODE|FASHION|COUTURE|APPAREL|TEXTILE|PRET A PORTER/],
  ['RETAIL', /GALERIES LAFAYETTE|PRINTEMPS|BON MARCHE|BHV|COURIR|FOOT ?LOCKER|INTERSPORT|DECATHLON|GO SPORT|SNEAKER|BOUTIQUE|RETAIL|DEPARTMENT STORE/],
];

/** Employers that are clearly outside the vertical, whatever the job title. */
const OUT_OF_SECTOR = /CARREFOUR|LECLERC|INTERMARCHE|AUCHAN|LIDL|CASINO|MONOPRIX|FRANPRIX|MCDONALD|BURGER KING|KFC|TOTAL ?ENERGIES|ORANGE|SFR|BOUYGUES|SNCF|RATP|AIR FRANCE|BNP|SOCIETE GENERALE|CREDIT AGRICOLE|AXA|CAPGEMINI|ATOS|SOPRA/;

function canonical(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Classifies a posting. `businessGroup` is an authoritative sector label when the
 * source provides one (LVMH does); it wins over name matching.
 */
export function classifySector(input: {
  company: string;
  businessGroup?: string;
  title?: string;
}): SectorVerdict {
  const group = input.businessGroup && LVMH_BUSINESS_GROUP_SECTORS[input.businessGroup];
  if (group) {
    return { sector: group, inScope: true, reason: `business group "${input.businessGroup}"` };
  }

  const company = canonical(input.company);

  if (OUT_OF_SECTOR.test(company)) {
    return { sector: 'OTHER', inScope: false, reason: 'employer outside the vertical' };
  }

  for (const [sector, pattern] of COMPANY_SIGNALS) {
    if (pattern.test(company)) {
      return { sector, inScope: true, reason: `employer matches ${sector}` };
    }
  }

  // Unknown employer: needs a human decision rather than a silent guess.
  return { sector: 'OTHER', inScope: false, reason: 'employer not recognised; needs review' };
}
