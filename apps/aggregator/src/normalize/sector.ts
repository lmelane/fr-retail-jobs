/**
 * Sector classification — decides whether a posting belongs in Catwalks.
 *
 * The filter is deliberately company-first, not title-first: "Carrefour —
 * Développeur Java" is out, "Sephora — Data Analyst" is in. A tech title at a
 * beauty retailer is a Catwalks job; the same title at a supermarket is not.
 * So an in-sector employer keeps its whole job list, and the title is only used
 * as a weak signal when the employer is unknown.
 */

import { findMaison, type MaisonEntry } from './maisons.js';

export type Sector =
  | 'FASHION'
  | 'LUXURY'
  | 'BEAUTY'
  | 'JEWELRY_WATCHES'
  | 'RETAIL'
  /** Façonniers, tanneries, métiers d'art — the luxury supply chain. */
  | 'SUPPLIER'
  /** Fashion media and PR agencies. */
  | 'MEDIA_AGENCY'
  /** Fashion-specialised search firms; they post real Maison roles. */
  | 'RECRUITER'
  | 'OTHER';

/**
 * Sector-scoped SOURCES: a source key whose whole catalogue is in one sector, so
 * an unrecognised employer from it inherits this sector rather than OTHER.
 * FashionJobs is a fashion-only jobboard; the LVMH portal is luxury. Matched by a
 * prefix so per-brand LVMH feed keys ("lvmh", "lvmh-dior"…) all resolve.
 */
const SOURCE_SECTOR_PREFIXES: ReadonlyArray<readonly [string, Sector]> = [
  ['fashionjobs', 'FASHION'],
  ['lvmh', 'LUXURY'],
];

/** The sector a source's catalogue belongs to, or undefined for a generalist. */
export function sectorForSource(sourceKey: string | undefined): Sector | undefined {
  if (!sourceKey) return undefined;
  const key = sourceKey.toLowerCase();
  for (const [prefix, sector] of SOURCE_SECTOR_PREFIXES) {
    if (key === prefix || key.startsWith(prefix + '-')) return sector;
  }
  return undefined;
}

/** Reference-list segments map straight onto sectors; both vocabularies match. */
const MAISON_SEGMENT_SECTORS: Record<MaisonEntry['segment'], Sector> = {
  FASHION: 'FASHION',
  LUXURY: 'LUXURY',
  BEAUTY: 'BEAUTY',
  JEWELRY_WATCHES: 'JEWELRY_WATCHES',
  RETAIL: 'RETAIL',
  SUPPLIER: 'SUPPLIER',
  MEDIA_AGENCY: 'MEDIA_AGENCY',
  RECRUITER: 'RECRUITER',
  OTHER: 'OTHER',
};

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
  // \b around OCCITANE: without it "Banque Populaire Occitane" and "Cerfrance
  // Gascogne Occitane" match L'OCCITANE — measured on real WTTJ data.
  ['BEAUTY', /SEPHORA|NOCIBE|MARIONNAUD|YVES ROCHER|CLARINS|LOREAL|L OREAL|ESTEE LAUDER|GUERLAIN|KIKO|RITUALS|\bL ?OCCITANE\b|PARFUM|COSMETIC|BEAUTY/],
  // Watchmaking is a first-class Catwalks segment, not a footnote to jewellery:
  // Swiss houses (Rolex, Patek, Omega…) and the French chains that retail them.
  [
    'JEWELRY_WATCHES',
    new RegExp(
      [
        /CARTIER|VAN CLEEF|CHAUMET|BOUCHERON|MESSIKA|MAUBOUSSIN|\bFRED\b|REPOSSI|POIRAY|DINH VAN|SWAROVSKI|PANDORA/,
        /HISTOIRE D OR|JULIEN D ORCEL|MARC ORIAN|CLEOR|OCARAT|\bTRESOR\b/,
        /TAG HEUER|HUBLOT|ZENITH|ROLEX|PATEK|\bOMEGA\b|BREITLING|\bIWC\b|JAEGER|LONGINES|TISSOT|SWATCH/,
        /BELL AND ROSS|BREGUET|BLANCPAIN|VACHERON|AUDEMARS|PIAGET|PANERAI|\bTUDOR\b|SEIKO|CITIZEN|FESTINA/,
        /ICE WATCH|BUCHERER|WEMPE|JOAILL|HORLOG|BIJOUTERIE|WATCHMAK/,
      ]
        .map((part) => part.source)
        .join('|'),
    ),
  ],
  ['LUXURY', /LOUIS VUITTON|DIOR|CHANEL|HERMES|GUCCI|PRADA|BALENCIAGA|SAINT LAURENT|CELINE|GIVENCHY|FENDI|LOEWE|LORO PIANA|BERLUTI|KENZO|CHLOE|LANVIN|BALMAIN|JACQUEMUS|RICHEMONT|KERING|LVMH/],
  // \bMODE\b, not bare MODE: without the boundary it matches inside MODERN — a
  // real false positive ("MODErn Solutions") measured on live data.
  ['FASHION', /ZARA|H ?ET ?M|H&M|UNIQLO|\bMANGO\b|PRIMARK|KIABI|CELIO|JULES|SANDRO|MAJE|CLAUDIE PIERLOT|SMCP|LACOSTE|SEZANE|BA ?SH|AMI PARIS|ISABEL MARANT|VEJA|PATOU|ETAM|PIMKIE|\bMODE\b|FASHION|COUTURE|APPAREL|TEXTILE|PRET A PORTER/],
  // Decathlon is RETAIL by decision (2026-09-03): it sells apparel/footwear and
  // is a deliberately-configured high-volume source. INTERSPORT/GO SPORT are NOT
  // here — they remain out-of-sector sporting-goods.
  ['RETAIL', /GALERIES LAFAYETTE|PRINTEMPS|BON MARCHE|BHV|COURIR|FOOT ?LOCKER|DECATHLON|SNEAKER|BOUTIQUE|RETAIL|DEPARTMENT STORE/],
];

/**
 * Employers clearly outside the vertical, whatever the job title.
 *
 * Seeded from what actually showed up in the data: on one Welcome to the Jungle
 * shard, 95.8% of French offers were out of sector, led by Intermarché (839),
 * Carrefour (240), Ministère des Armées (223), Vinci, Thales and EDF. A generalist
 * jobboard is mostly noise for us, so this list earns its keep.
 */
const OUT_OF_SECTOR_RE = new RegExp(
  [
    // Food retail and fast food. Monoprix and Carrefour do sell clothing, but
    // general-purpose distribution is not the Catwalks vertical.
    /CARREFOUR|LECLERC|INTERMARCHE|MOUSQUETAIRES|AUCHAN|LIDL|\bALDI\b|\bCASINO\b|MONOPRIX|FRANPRIX|\bCORA\b|SYSTEME U/,
    /MCDONALD|BURGER KING|\bKFC\b|\bQUICK\b|SUBWAY|DOMINO/,
    // Sports equipment. Fashion footwear stays in scope (Courir, Foot Locker) —
    // pure sporting-goods do not. Decathlon is DELIBERATELY NOT here: Loïc's call
    // (2026-09-03) is that Decathlon is RETAIL (it sells apparel/footwear, like
    // Galeries Lafayette/Courir), and it is a high-volume source we configured on
    // purpose — so it is classified RETAIL below, not excluded.
    /INTERSPORT|GO ?SPORT|SPORT ?2000|\bALLTRICKS\b|COURIR ?SPORT|SPORTS? DIRECT/,
    // Energy, transport, industry.
    /TOTAL ?ENERGIES|ENGIE|\bEDF\b|VEOLIA|\bSUEZ\b|ORANGE|\bSFR\b|BOUYGUES|\bFREE\b|\bSNCF\b|\bRATP\b|AIR FRANCE/,
    /VINCI|EIFFAGE|COLAS|SAFRAN|THALES|DASSAULT|FRAMATOME|ALSTOM|RENAULT|STELLANTIS|MICHELIN/,
    // Banking, insurance, accountancy.
    /\bBNP\b|SOCIETE GENERALE|CREDIT AGRICOLE|BANQUE|CAISSE D EPARGNE|\bAXA\b|ALLIANZ|\bMAIF\b|MACIF|GENERALI|MUTUELLE|CERFRANCE/,
    // IT services, public sector, healthcare, real estate.
    /CAPGEMINI|\bATOS\b|SOPRA|ACCENTURE|MINISTERE|ARMEES|GENDARMERIE|POLICE NATIONALE/,
    /HOPITAL|\bCHU\b|CLINIQUE|EHPAD|\bORPI\b|CENTURY 21|FONCIA|EFFICITY/,
    // Industry markers that disqualify an otherwise-ambiguous brand token: OMEGA,
    // ZENITH, MANGO, TRESOR, BOUTIQUE also name a watch/fashion house, so their
    // signal fires on "Omega Pharma", "Zenith Aircraft", "Mango Airlines" and the
    // "Trésor Public". A verified house is matched earlier by the reference list,
    // so these can be excluded here without touching a real Maison.
    /\bPHARMA|\bAIRCRAFT\b|\bAIRLINES?\b|\bAEROSPACE\b|ENGINEERING|\bTELECOM|TRESOR\s+PUBLIC/,
    // Hospitality (hotels, resorts): a "Boutique Hotel" is not the retail word.
    /\bHOTELS?\b|\bHOSTEL\b|\bRESORT\b|\bSPA RESORT\b/,
  ]
    .map((part) => part.source)
    .join('|'),
);

/**
 * Industry words in the employer name. Weaker than a known-employer match, but it
 * catches the long tail of brands no hand-written list will ever contain.
 */
const SECTOR_KEYWORDS: ReadonlyArray<readonly [Sector, RegExp]> = [
  ['BEAUTY', /\b(PARFUM|COSMETIQUE|COSMETIC|BEAUTE|BEAUTY|SKINCARE|MAQUILLAGE)\b/],
  ['JEWELRY_WATCHES', /\b(JOAILL|BIJOU|HORLOG|WATCH|JEWEL)\w*/],
  ['FASHION', /\b(MODE|FASHION|COUTURE|PRET A PORTER|TEXTILE|MAROQUINERIE|CHAUSSURE|LINGERIE|APPAREL|LUXE|LUXURY)\b/],
  ['RETAIL', /\b(BOUTIQUE|RETAIL|CONCEPT STORE|GRANDS MAGASINS|DEPARTMENT STORE)\b/],
];

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
 *
 * `sourceSector` is the sector of the SOURCE this posting came from — set for a
 * sector-scoped source (a fashion-only jobboard like FashionJobs, or a luxury
 * group portal). When the employer name is unrecognised, the offer inherits its
 * source's sector instead of falling to OTHER: a brand on FashionJobs IS a
 * fashion employer even if our reference list has never heard of it. This is
 * what rescued ~300 real Maisons (Amina Muaddi, A.P.C., Azzedine Alaïa…) that
 * were being mislabelled OTHER. It never OVERRIDES a positive name match — those
 * are more specific — it only replaces the OTHER fallback.
 */
export function classifySector(input: {
  company: string;
  businessGroup?: string;
  title?: string;
  sourceSector?: Sector;
}): SectorVerdict {
  const group = input.businessGroup && LVMH_BUSINESS_GROUP_SECTORS[input.businessGroup];
  if (group) {
    return { sector: group, inScope: true, reason: `business group "${input.businessGroup}"` };
  }

  const company = canonical(input.company);

  // The reference list is the authority, and it is checked BEFORE the exclusions:
  // a verified house always wins over a pattern. Otherwise Clinique matched
  // /CLINIQUE/ (healthcare) and Vanity Fair matched /BANQUE/ — real Maisons
  // dropped by a substring collision.
  //
  // Regexes alone recognised only 20.9% of the 713 verified houses: Alaïa, Acne
  // Studios, agnès b. and Alexander McQueen all slipped through. With the list in
  // front, coverage is 99.6% — the data decides, patterns are the fallback.
  const maison = findMaison(input.company);
  if (maison) {
    const sector = MAISON_SEGMENT_SECTORS[maison.segment] ?? 'OTHER';
    return {
      sector,
      inScope: true,
      reason: `reference list: ${maison.name}${maison.group ? ` (${maison.group})` : ''}`,
    };
  }

  // Not a listed house: exclusions now apply, ahead of the looser patterns.
  if (OUT_OF_SECTOR_RE.test(company)) {
    return { sector: 'OTHER', inScope: false, reason: 'employer outside the vertical' };
  }

  for (const [sector, pattern] of COMPANY_SIGNALS) {
    if (pattern.test(company)) {
      return { sector, inScope: true, reason: `known ${sector} employer` };
    }
  }

  // Long tail: an industry word in the name, for brands no list will ever hold.
  for (const [sector, pattern] of SECTOR_KEYWORDS) {
    if (pattern.test(company)) {
      return { sector, inScope: true, reason: `sector keyword in employer name (${sector})` };
    }
  }

  // Unknown employer, but it came from a sector-scoped source: inherit that
  // sector rather than dropping the brand to OTHER (a FashionJobs employer is a
  // fashion employer). Only in-sector source hints reach here.
  if (input.sourceSector && input.sourceSector !== 'OTHER') {
    return {
      sector: input.sourceSector,
      inScope: true,
      reason: `unrecognised employer, inherited from ${input.sourceSector} source`,
    };
  }

  // Unknown employer with no sector hint: excluded, but flagged so a human can
  // promote it to the reference list. Silence here is what lets a Maison go missing.
  return { sector: 'OTHER', inScope: false, reason: 'employer not recognised; needs review' };
}
