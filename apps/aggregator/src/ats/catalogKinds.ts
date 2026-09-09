/** One catalogue-to-adapter registry shared by ingestion and qualification. */
export const KIND_TO_ATS: Record<string, string> = {
  successfactors: "SUCCESSFACTORS",
  avature: "AVATURE",
  eightfold: "EIGHTFOLD",
  wttj: "WTTJ",
  /**
   * Balayage sectoriel WTTJ (w1, 2026-09-06) : même AtsType que `wttj` pour
   * que la même offre lue par les deux chemins soit UNE identité
   * (companyId, WTTJ, externalId) — l'adaptateur branche sur la config.
   */
  "wttj-sector": "WTTJ",
  workday: "WORKDAY",
  magnet: "MAGNET",
  teamtailor: "TEAMTAILOR",
  "smartrecruiters-whitelabel": "SMARTRECRUITERS",
  workable: "WORKABLE",
  talentview: "TALENTVIEW",
  phenom: "PHENOM",
  recruitee: "RECRUITEE",
  lvmh_algolia: "LVMH_ALGOLIA",
  ashby: "ASHBY",
  lever: "LEVER",
  pinpoint: "PINPOINT",
  greenhouse: "GREENHOUSE",
  gestmax: "GENERIC_JSONLD",
  radancy: "GENERIC_JSONLD",
  digitalrecruiters: "DIGITALRECRUITERS",
  talentsoft: "TALENTSOFT",
  personio: "PERSONIO",
  eightfold_kering: "EIGHTFOLD",
  wordpress: "WORDPRESS",
  fashionjobs: "FASHIONJOBS",
  "generic-listing": "GENERIC_JSONLD",
  oraclehcm: "ORACLE_HCM",
  taleo: "TALEO",
  altamira: "ALTAMIRA",
  jobylon: "JOBYLON",
  rituals: "RITUALS",
  talentfunnel: "TALENT_FUNNEL",
  bashtalents: "BASH_TALENTS",
  eqwa: "EQWA",
  geodirectory: "GEODIRECTORY",
  typesense: "TYPESENSE",
  jibe: "JIBE",
  volcanic: "VOLCANIC",
  // iCIMS : adaptateur et dispatch existaient, le kind manquait ici — URBN (1 329 + 906) et
  // Aéropostale (17) ACTIVE n'ont jamais tourné, sans aucun signal (audit A2, 2026-09-06).
  icims: "ICIMS",
  swatchgroup: "SWATCH_GROUP",
  flatchr: "FLATCHR",
  "jobaffinity-wordpress": "JOBAFFINITY_WORDPRESS",
};
