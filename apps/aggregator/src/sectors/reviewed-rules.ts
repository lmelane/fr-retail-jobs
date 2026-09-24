import type { SectorRule } from './qualify.js';
// Exact employer identities and inspected official evidence; unknown employers abstain.
export const REVIEWED_SECTOR_TAXONOMY = '6b36cec205b035f681e8f70b667ffd42174e3227e2b5b5d77abaf62eb7f98e72';
export const REVIEWED_SECTOR_RULES: SectorRule[] = [
  {
    "canonicalKey": "MANGO",
    "name": "Mango",
    "domain": "mango.com",
    "codes": [
      "FASHION",
      "RETAIL"
    ],
    "source": "https://mangofashiongroup.com/en/about-us",
    "statement": "Mango conçoit des collections de vêtements et exploite des boutiques physiques ainsi qu’une plateforme de vente en ligne.",
    "checkedAt": "2026-09-24T05:55:00Z",
    "validUntil": "2027-03-24T00:00:00Z"
  },
  {
    "canonicalKey": "SKECHERS",
    "name": "Skechers",
    "domain": "skechers.com",
    "codes": [
      "FOOTWEAR",
      "RETAIL"
    ],
    "source": "https://about.skechers.com/",
    "statement": "Skechers développe des chaussures et commercialise ses produits dans son propre réseau de magasins.",
    "checkedAt": "2026-09-24T05:55:00Z",
    "validUntil": "2027-03-24T00:00:00Z"
  },
  {
    "canonicalKey": "LOVISA",
    "name": "Lovisa",
    "domain": "lovisa.com",
    "codes": [
      "JEWELRY"
    ],
    "source": "https://www.lovisa.com/pages/about",
    "statement": "Lovisa présente ses collections de bijoux de mode et ses équipes de création.",
    "checkedAt": "2026-09-24T05:55:00Z",
    "validUntil": "2027-03-24T00:00:00Z"
  },
  {
    "canonicalKey": "BLOOMINGDALE_S",
    "name": "Bloomingdale's",
    "domain": "bloomingdales.com",
    "codes": [
      "RETAIL"
    ],
    "source": "https://www.macysinc.com/company/bloomingdales/",
    "statement": "Macy’s présente Bloomingdale’s comme son enseigne de grands magasins, avec une sélection de marques et des magasins physiques.",
    "checkedAt": "2026-09-24T05:55:00Z",
    "validUntil": "2027-03-24T00:00:00Z"
  },
  {
    "canonicalKey": "MONOPRIX",
    "name": "Groupe MONOPRIX",
    "domain": "monoprix.fr",
    "codes": [
      "BEAUTY",
      "FASHION",
      "HOME_LIFESTYLE",
      "RETAIL"
    ],
    "source": "https://entreprise.monoprix.fr/entreprise/nos-marques/",
    "statement": "Monoprix distribue des cosmétiques, conçoit des collections de vêtements et propose linge de maison, décoration et arts de la table.",
    "checkedAt": "2026-09-24T05:55:00Z",
    "validUntil": "2027-03-24T00:00:00Z"
  },
  {
    "canonicalKey": "NOCIBE",
    "name": "Nocibé",
    "domain": "nocibe.fr",
    "codes": [
      "BEAUTY",
      "FRAGRANCE",
      "RETAIL"
    ],
    "source": "https://www.nocibe.fr/fr/cp/devenir-franchise/devenir-franchise",
    "statement": "Nocibé distribue parfums et cosmétiques dans son réseau de points de vente et propose des soins en institut.",
    "checkedAt": "2026-09-24T05:55:00Z",
    "validUntil": "2027-03-24T00:00:00Z"
  }
];
