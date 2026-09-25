import { describe, expect, it } from 'vitest';
import type { AtsType } from '@prisma/client';
import { CODES_MARCHE } from '@catwalks/db/marches';
import { readSourceFacts, projectSourceFacts } from '../facts/index.js';
import { toCandidate } from '../pipeline/ingest.js';
import { parseJibePage } from '../ats/adapters/jibe.js';
import { parseCareerConnectJob, parsePhenomJob } from '../ats/adapters/phenom.js';
import { parseLeverJob } from '../ats/adapters/lever.js';
import { parseJobPostings } from '../ats/adapters/genericJsonLd.js';
import { parseWorkdayPublication } from '../ats/adapters/workday.js';
import { normalizeCountry, countryFromLocation } from '../normalize/country.js';
import { resolveGeography, subdivisionCountryOf, US_SUBDIVISION_NAMES, CA_SUBDIVISION_NAMES } from '../normalize/geography.js';
import { ADDRESS_CONCORDANCE_THRESHOLD, MARKET_TERRITORIES, addressFieldsFor, declaredPlaceVerdict, declaredPlacesCountry,
  postalCodeFitsCountry } from '../normalize/declaredPlaceCountry.js';
import { BOOTSTRAP_TAXONOMY } from '../normalize/taxonomy.js';
import type { NormalizedJob } from '../types.js';
import { publicationJobContent } from './content.js';

/**
 * D-442 (arbitrage CEO du 24/09/2026, précise D-435, exécute le point 1 de D-440) — LE PAYS D'UNE OFFRE.
 *
 *   1. « L'adresse l'emporte » : au moins TROIS champs d'adresse concordants (nom du pays, État de ce pays,
 *      code postal au format de ce pays, libellé) contre un code pays qui en désigne un autre → le pays de
 *      l'adresse. En dessous de trois, l'abstention de D-440 demeure.
 *   2. « Territoire → HK » : un territoire qui a son propre marché, nommé explicitement dans le lieu déclaré,
 *      l'emporte sur le champ pays qui désigne son pays englobant : Hong Kong et Taïwan sous `CN`, Porto Rico
 *      sous `US` (D-450). Liste fermée ; jamais quand le champ pays désigne un autre pays. Un libellé
 *      hiérarchique (« USA > Puerto Rico > San Juan ») nomme le territoire (D-454 §1) ; un lieu mixte ne passe
 *      pas au territoire (D-454 §2).
 *
 * Mesuré en production le 24/09/2026 (`audits/2026-09-24/scripts/pays-signaux-contradictoires.mts`) : 12 Ulta
 * classées à Porto Rico, 1 boutique Foot Locker de Slough classée aux États-Unis, 6 Arc'teryx de Hong Kong
 * classées en Chine (Hong Kong dans le libellé), 3 LuxExperience de Hong Kong classées en Chine (Hong Kong
 * dans la seule ville, lieu sans libellé), et 28 offres de Porto Rico classées aux États-Unis (Skechers 16,
 * Tapestry 5, VF Corporation 7 dans un libellé hiérarchique), qui le nomment dans chacun de leurs lieux. Les
 * formes RAW ci-dessous sont celles de production,
 * relues en lecture seule, champs de lieu et d'identification de l'offre seulement (aucune donnée personnelle,
 * textes d'annonce retirés).
 *
 * Les témoins de projection passent par le chemin réel de l'ingestion : parseur de l'adaptateur, `toCandidate`,
 * lecteur de faits appliqué comme dans `upsertDeduplicated` (dedup/upsert.ts), puis `publicationJobContent`. Une
 * exception : le lieu schema.org des offres ICIMS (lu en HTML) passe par le lecteur JSON-LD générique, qui en tire
 * le même lieu déclaré. Les lectures fermées, en fin de fichier, appellent `declaredPlaceVerdict` directement.
 */

/** careers.ulta.com, offre 488752 — Cornelius (NC). */
const ULTA_CORNELIUS = {
  city: 'Cornielius', slug: '488752', state: 'North Carolina', tags1: ['Part Time'], tags2: ['Field'], title: 'Stylist',
  req_id: '488752', country: 'United States', language: 'en-us', latitude: 18.38078, longitude: -65.95739,
  apply_url: 'https://fdcnmcareers-ulta.icims.com/jobs/488752/login', postal_code: '28031', posted_date: '2026-05-08T20:32:00+0000',
  country_code: 'PR', full_location: 'Cornielius, North Carolina', location_name: 'The Shops at the Fresh Market',
  location_type: 'LAT_LNG', short_location: 'Cornielius, North Carolina', multipleLocations: false,
  hiring_organization: 'Ulta Beauty, Inc.', additional_locations: null, description: '<p>Stylist</p>',
  meta_data: { canonical_url: 'https://careers.ulta.com/jobs/488752?lang=en-us' },
};

/** careers.ulta.com, offre 479099 — Indian Land (SC) : mêmes coordonnées de Carolina (Porto Rico). */
const ULTA_INDIAN_LAND = {
  city: 'Indian Land', slug: '479099', state: 'South Carolina', tags1: ['Part Time'], tags2: ['Field'], title: 'Beauty Advisor',
  req_id: '479099', country: 'United States', language: 'en-us', latitude: 18.38078, longitude: -65.95739,
  apply_url: 'https://fdcnmcareers-ulta.icims.com/jobs/479099/login', postal_code: '29707', posted_date: '2026-04-04T00:12:00+0000',
  country_code: 'PR', full_location: 'Indian Land, South Carolina', location_name: 'Promenade at Carolina Reserve',
  location_type: 'LAT_LNG', short_location: 'Indian Land, South Carolina', multipleLocations: false,
  hiring_organization: 'Ulta Beauty, Inc.', additional_locations: null, description: '<p>Beauty Advisor</p>',
  meta_data: { canonical_url: 'https://careers.ulta.com/jobs/479099?lang=en-us' },
};

/** uk-retail-footlocker (Phenom), offre 64612 : boutique de Slough, code pays et coordonnées américains. */
const FOOT_LOCKER_SLOUGH = {
  city: 'Slough/Berkshire', slug: '64612', state: 'UK', tags2: ['Regular Part-Time'], tags4: ['Foot Locker'], title: 'CX Team Member',
  req_id: '64612', country: 'United Kingdom', language: 'en-us', latitude: 33.836081, longitude: -81.1637245,
  apply_url: 'https://uk-retail-footlocker.icims.com/jobs/64612/login', postal_code: 'SL1--1BX', create_date: '2026-09-07T09:10:23+0000',
  country_code: 'US', full_location: 'Slough/Berkshire, United Kingdom', location_name: 'Slough/Berkshire UK', employment_type: 'PART_TIME',
  multipleLocations: false, hiring_organization: 'Foot Locker',
};

/** jobs.lever.co/arcteryx.com : `country` ISO-2 déclaré par l'employeur, lieu en libellé seul. */
const ARCTERYX_HONG_KONG = { id: 'ead3e20f-e987-4b77-aea1-152e72068be2', text: 'Product Compliance Specialist 2', country: 'CN',
  hostedUrl: 'https://jobs.lever.co/arcteryx.com/ead3e20f-e987-4b77-aea1-152e72068be2', createdAt: 1786046175314,
  categories: { team: 'Supply Chain Compliance', location: 'Hong Kong', department: 'Supply Chain', allLocations: ['Hong Kong'] },
  workplaceType: 'onsite' };

/**
 * career.luxexperience.com (generic-listing, nœud JSON-LD `JobPosting` retenu), offre R-16687, relue en production le
 * 24/09/2026 (18:06 UTC) comme ses deux voisines R-16367 et R-17014 : le lieu déclaré n'a PAS de nom
 * (`jobLocation.name` absent, donc aucun libellé) et Hong Kong n'est nommé que dans la VILLE, sous le code « CN ».
 */
const LUXEXPERIENCE_HONG_KONG = {
  '@type': 'JobPosting', title: 'Personal Shopper', '@context': 'https://schema.org/', datePosted: '2026-09-24',
  identifier: { name: 'LuxExperience', '@type': 'PropertyValue', value: 'R-16687' }, directApply: true,
  jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressCountry: 'CN', addressLocality: 'Hong Kong SAR, China' } },
  employmentType: 'FULL_TIME', description: '<p>Personal Shopper</p>',
  hiringOrganization: { logo: 'https://career.luxexperience.com/_assets/c2d01029318fb1f9416df5f99b6030cc/Icons/CompanyLogos/LuxExperience.png',
    name: 'LuxExperience', '@type': 'Organization', sameAs: 'https://luxexperience.com/' },
};
const LUXEXPERIENCE_PAGE = 'https://career.luxexperience.com/open-positions/job-detail/personal-shopper-net-a-porter-r-16687-1';

/**
 * careers.skechers.com (Phenom CareerConnect), offre SRJSVUUSJR102834EXTERNALENUS, relue dans l'instantané de production du
 * 24/09/2026 (18:06 UTC) comme ses 15 voisines de `skechers-phenom` : champ pays « United States of America », Porto Rico nommé
 * par son NOM dans la région (`state`) du premier lieu et dans le libellé du second (`multi_location_array`). L'adresse de la
 * boutique porte aussi le CODE « PR » (« Carolina, PR 00983 ») : aucun lieu déclaré ne la lit.
 */
const SKECHERS_CAROLINA = {
  jobSeqNo: 'SRJSVUUSJR102834EXTERNALENUS', jobId: 'JR102834', reqId: 'JR102834', title: 'Retail Sales Associate', type: 'Part time',
  category: 'Retail', locale: 'en_US', siteType: 'external', city: 'Carolina', state: 'Puerto Rico', country: 'United States of America',
  cityState: 'Carolina, Puerto Rico', cityStateCountry: 'Carolina, Puerto Rico, United States of America',
  location: 'Carolina, Puerto Rico, United States of America', address: 'Avenida Jesus M. Fragoso, Carolina, PR 00983, United States of America',
  latitude: '18.38078', longitude: '-65.95739', isMultiLocation: true, multi_location: ['Carolina, Puerto Rico, United States of America'],
  multi_location_array: [{ latlong: { lat: 18.38078, lon: -65.95739 }, location: 'Carolina, Puerto Rico, United States of America' }],
  postedDate: '2025-09-17T00:00:00.000+0000', dateCreated: '2025-09-08T16:04:07.164+0000',
};

/**
 * tapestry.wd108.myworkdayjobs.com (Workday, site `Tapestry_Careers`), offre Lead-Supervisor-1_JR15765 de l'instantané du 24/09/2026 :
 * le détail porte le lieu « San Juan, Puerto Rico, USA (Coach 6102 San Juan-Coach) » et le pays « United States of America », les deux
 * seuls champs que le lecteur de faits Workday garde. Le chemin est celui de l'URL de la publication, la facette « Coach » celle de la
 * fixture Tapestry du 10/09 ; l'intitulé est reconstruit, le RAW Workday n'étant pas dans l'instantané.
 */
const TAPESTRY_SAN_JUAN = {
  title: 'Lead Supervisor', externalPath: '/job/San-Juan-Puerto-Rico-USA-Coach-6102-San-Juan-Coach/Lead-Supervisor-1_JR15765',
  facet: { parameter: 'Brand', value: 'Coach', id: '528f8d9e5d1b1000f6f7b03080aa0000' },
  detail: { jobPostingInfo: {
    externalUrl: 'https://tapestry.wd108.myworkdayjobs.com/Tapestry_Careers/job/San-Juan-Puerto-Rico-USA-Coach-6102-San-Juan-Coach/Lead-Supervisor-1_JR15765',
    location: 'San Juan, Puerto Rico, USA (Coach 6102 San Juan-Coach)', country: { descriptor: 'United States of America' } } },
};
const TAPESTRY = { origin: 'https://tapestry.wd108.myworkdayjobs.com', site: 'Tapestry_Careers' };

/**
 * vfc.wd5.myworkdayjobs.com (Workday, site `vfc_careers`), offre Kipling--Seasonal-Sales-Associate---Plaza-Las-Americas_R-20260909-0005-1
 * de l'instantané du 24/09/2026, comme ses 6 voisines de `vf-corporation` : le détail porte le lieu HIÉRARCHIQUE « USCA > USA > Puerto
 * Rico > San Juan 5008 - KIP » et le pays « United States of America », les deux seuls champs que le lecteur de faits Workday garde.
 * Le chemin est celui de l'URL de la publication ; l'intitulé et l'employeur (logo « Kipling ») sont reconstruits, le RAW Workday
 * n'étant pas dans l'instantané : ils n'entrent pas dans le pays.
 */
const VF = { origin: 'https://vfc.wd5.myworkdayjobs.com', site: 'vfc_careers' };
const VF_SAN_JUAN = {
  title: 'Kipling - Seasonal Sales Associate - Plaza Las Americas',
  externalPath: '/job/USCA--USA--Puerto-Rico--San-Juan-5008---KIP/Kipling--Seasonal-Sales-Associate---Plaza-Las-Americas_R-20260909-0005-1',
  detail: { jobPostingInfo: {
    externalUrl: 'https://vfc.wd5.myworkdayjobs.com/vfc_careers/job/USCA--USA--Puerto-Rico--San-Juan-5008---KIP/Kipling--Seasonal-Sales-Associate---Plaza-Las-Americas_R-20260909-0005-1',
    location: 'USCA > USA > Puerto Rico > San Juan 5008 - KIP', country: { descriptor: 'United States of America' }, logoImage: { alt: 'Kipling' } } },
};

function projeter(job: NormalizedJob, atsType: AtsType) {
  const candidate = toCandidate(job, { key: `temoin-${atsType.toLowerCase()}`, company: 'Témoin', tier: 'ATS_OFFICIAL' }, 'Témoin', atsType);
  const facts = readSourceFacts(atsType, candidate.raw);
  return { facts, content: publicationJobContent({ ...candidate, ...projectSourceFacts(facts), sourceFacts: facts }, BOOTSTRAP_TAXONOMY) };
}
const jibe = (raw: object) => parseJibePage({ jobs: [{ data: raw }] }, 'https://careers.ulta.com')[0];
const phenom = (raw: object) => parsePhenomJob(raw as never, 'https://uk-retail-footlocker.icims.com')!;
const lever = (raw: object) => parseLeverJob(raw as never, {});
/** La page de détail telle que l'adaptateur générique la lit : un bloc JSON-LD, puis `parseJobPostings`. */
const jsonLd = (node: object) => parseJobPostings(
  `<html><head><script type="application/ld+json">${JSON.stringify(node)}</script></head><body></body></html>`, LUXEXPERIENCE_PAGE)[0];
const adresseLux = (address: object) => ({ ...LUXEXPERIENCE_HONG_KONG, jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', ...address } } });
/** Phenom CareerConnect, avec le préfixe de locale du portail Skechers (`/us/en/job/…`, l'URL de la publication). */
const careerConnect = (raw: object) => parseCareerConnectJob(raw as never, 'https://careers.skechers.com', { localePath: 'us/en' })!;
/** Workday, par la même reconstruction que la reprise d'un RAW retenu (`parseWorkdayPublication`). */
const workday = (raw: object, site: { origin: string; site: string } = TAPESTRY) =>
  parseWorkdayPublication(raw as never, site, new Date('2026-09-24T18:06:11Z'))!;
const US_ZIP = /^\d{5}$/;

describe('D-442 §1 — Ulta : l’adresse américaine l’emporte sur le code « PR »', () => {
  for (const [nom, raw, etat] of [['Cornelius', ULTA_CORNELIUS, 'North Carolina'], ['Indian Land', ULTA_INDIAN_LAND, 'South Carolina']] as const) {
    it(`PRÉMISSE (${nom}) : le code dit Porto Rico, quatre champs d’adresse disent les États-Unis`, () => {
      expect(normalizeCountry(raw.country_code)).toBe('PR');
      // Les quatre champs d'adresse, chacun lu par la connaissance que le code possède déjà.
      expect(normalizeCountry(raw.country)).toBe('US');
      expect(US_SUBDIVISION_NAMES.has(raw.state)).toBe(true);
      expect(raw.postal_code).toMatch(US_ZIP);
      expect(resolveGeography({ location: raw.full_location }).countryCode).toBe('US');
      // L'adaptateur retient le code : c'est lui que la projection trouve en premier.
      const job = jibe(raw);
      expect(normalizeCountry(job.country)).toBe('PR');
      const { facts } = projeter(job, 'JIBE');
      expect(facts.locations.value).toHaveLength(1);
      expect(facts.locations.value![0]).toMatchObject({ country: 'United States', region: etat, label: raw.full_location });
      expect(declaredPlacesCountry(facts.locations)).toBe('US');
    });

    it(`classe l’offre de ${nom} aux États-Unis, avec la preuve du champ pays et son État`, () => {
      expect(projeter(jibe(raw), 'JIBE').content).toMatchObject({
        countryCode: 'US', countryIntegrity: 'RAW_COUNTRY', adminArea1: etat, city: raw.city, location: raw.full_location,
      });
    });
  }
});

describe('D-442 §1 — Foot Locker : l’adresse de Slough l’emporte sur le code « US »', () => {
  it('PRÉMISSE : trois champs concordants exactement — le code postal est le troisième', () => {
    expect(normalizeCountry(FOOT_LOCKER_SLOUGH.country_code)).toBe('US');
    expect(normalizeCountry(FOOT_LOCKER_SLOUGH.country)).toBe('GB');
    expect(resolveGeography({ location: FOOT_LOCKER_SLOUGH.full_location }).countryCode).toBe('GB');
    // « UK » dans le champ État n'est la subdivision d'aucun pays connu du code : ce champ ne compte pas.
    expect(US_SUBDIVISION_NAMES.has(FOOT_LOCKER_SLOUGH.state) || CA_SUBDIVISION_NAMES.has(FOOT_LOCKER_SLOUGH.state)).toBe(false);
    // Le code postal est britannique, mais la source l'écrit avec un double tiret.
    expect(FOOT_LOCKER_SLOUGH.postal_code).toBe('SL1--1BX');
    const job = phenom(FOOT_LOCKER_SLOUGH);
    expect(normalizeCountry(job.country)).toBe('US');
    expect(declaredPlacesCountry(projeter(job, 'PHENOM').facts.locations)).toBe('GB');
  });

  it('classe la boutique au Royaume-Uni, avec la preuve du champ pays', () => {
    expect(projeter(phenom(FOOT_LOCKER_SLOUGH), 'PHENOM').content).toMatchObject({ countryCode: 'GB', countryIntegrity: 'RAW_COUNTRY', adminArea1: null });
  });

  it('sans son code postal, Slough n’a plus que deux champs concordants : l’abstention de D-440 demeure', () => {
    const { content } = projeter(phenom({ ...FOOT_LOCKER_SLOUGH, postal_code: undefined }), 'PHENOM');
    expect(content).toMatchObject({ countryCode: null, countryIntegrity: null, adminArea1: null });
  });
});

describe('D-442 §1 — en dessous de trois champs concordants, ou avec un champ dissident, on s’abstient', () => {
  it('le nom du pays seul contre le code : abstention', () => {
    const raw = { ...ULTA_CORNELIUS, state: undefined, postal_code: undefined, full_location: 'Cornielius', short_location: 'Cornielius' };
    const job = jibe(raw);
    // PRÉMISSE : la contradiction existe bien (le lieu déclaré nomme les États-Unis, le code Porto Rico).
    expect(declaredPlacesCountry(projeter(job, 'JIBE').facts.locations)).toBe('US');
    expect(normalizeCountry(job.country)).toBe('PR');
    expect(projeter(job, 'JIBE').content).toMatchObject({ countryCode: null, countryIntegrity: null, adminArea1: null });
  });

  it('trois champs pour les États-Unis mais un libellé qui nomme Porto Rico : ce n’est pas une concordance', () => {
    const raw = { ...ULTA_CORNELIUS, full_location: 'Cornielius, Puerto Rico', short_location: 'Cornielius, Puerto Rico' };
    // PRÉMISSE : nom du pays, État et code postal disent bien les États-Unis ; le libellé dit l'autre pays.
    expect(resolveGeography({ location: raw.full_location }).countryCode).toBe('PR');
    expect(normalizeCountry(raw.country)).toBe('US');
    expect(declaredPlacesCountry(projeter(jibe(raw), 'JIBE').facts.locations)).toBe('US');
    expect(projeter(jibe(raw), 'JIBE').content).toMatchObject({ countryCode: null, countryIntegrity: null });
  });

  it('Toronto sous un code « US » : nom du pays, province et libellé suffisent, et l’Ontario suit le Canada', () => {
    const raw = { ...ULTA_CORNELIUS, country_code: 'US', country: 'Canada', state: 'Ontario', city: 'Toronto',
      full_location: 'Toronto, Ontario', short_location: 'Toronto, Ontario', postal_code: 'M5V 3L9' };
    // PRÉMISSE : trois champs nomment le Canada, le code dit les États-Unis.
    expect(CA_SUBDIVISION_NAMES.has(raw.state)).toBe(true);
    expect(resolveGeography({ location: raw.full_location }).countryCode).toBe('CA');
    expect(projeter(jibe(raw), 'JIBE').content).toMatchObject({ countryCode: 'CA', countryIntegrity: 'RAW_COUNTRY', adminArea1: 'Ontario' });
  });
});

describe('D-442 §2 — un territoire qui a son marché l’emporte sur son pays englobant', () => {
  it('PRÉMISSE : Arc’teryx déclare `CN`, son lieu nomme Hong Kong, et Hong Kong a son marché', () => {
    expect(CODES_MARCHE).toContain('HK');
    expect(countryFromLocation(ARCTERYX_HONG_KONG.categories.location)).toBe('HK');
    const job = lever(ARCTERYX_HONG_KONG);
    expect(normalizeCountry(job.country)).toBe('CN');
    const { facts } = projeter(job, 'LEVER');
    expect(facts.locations.value).toEqual([expect.objectContaining({ label: 'Hong Kong', country: null })]);
  });

  it('classe l’offre à Hong Kong ; le libellé ne produit aucune preuve persistée', () => {
    expect(projeter(lever(ARCTERYX_HONG_KONG), 'LEVER').content).toMatchObject({ countryCode: 'HK', countryIntegrity: null, adminArea1: null });
  });

  it('« Kowloon, Hong Kong » et « Taipei, Taiwan » sous `CN` rejoignent leur marché', () => {
    expect(CODES_MARCHE).toContain('TW');
    const kowloon = { ...ARCTERYX_HONG_KONG, categories: { ...ARCTERYX_HONG_KONG.categories, location: 'Kowloon, Hong Kong', allLocations: ['Kowloon, Hong Kong'] } };
    const taipei = { ...ARCTERYX_HONG_KONG, categories: { ...ARCTERYX_HONG_KONG.categories, location: 'Taipei, Taiwan', allLocations: ['Taipei, Taiwan'] } };
    expect(projeter(lever(kowloon), 'LEVER').content).toMatchObject({ countryCode: 'HK', countryIntegrity: null });
    expect(projeter(lever(taipei), 'LEVER').content).toMatchObject({ countryCode: 'TW', countryIntegrity: null });
  });
});

describe('D-442 §2 — ce que la règle du territoire NE touche PAS', () => {
  const avecLieux = (country: string, lieux: string[]) =>
    ({ ...ARCTERYX_HONG_KONG, country, categories: { ...ARCTERYX_HONG_KONG.categories, location: lieux[0], allLocations: lieux } });

  it('« Macau » sous `CN` reste en Chine : Macao n’a pas de marché', () => {
    // PRÉMISSE : le libellé nomme bien Macao, mais la liste des marchés ne le contient pas.
    expect(countryFromLocation('Macau')).toBe('MO');
    expect(CODES_MARCHE).not.toContain('MO');
    expect(projeter(lever(avecLieux('CN', ['Macau'])), 'LEVER').content).toMatchObject({ countryCode: 'CN', countryIntegrity: 'RAW_COUNTRY' });
  });

  it('« Hong Kong » sous un champ pays qui n’est pas `CN` ne change pas de pays', () => {
    expect(projeter(lever(avecLieux('FR', ['Hong Kong'])), 'LEVER').content).toMatchObject({ countryCode: 'FR', countryIntegrity: 'RAW_COUNTRY' });
    expect(projeter(lever(avecLieux('GB', ['Hong Kong'])), 'LEVER').content).toMatchObject({ countryCode: 'GB', countryIntegrity: 'RAW_COUNTRY' });
  });

  it('une offre `CN` à Shanghai, ou à Hong Kong ET Shanghai, reste en Chine', () => {
    expect(projeter(lever(avecLieux('CN', ['Shanghai'])), 'LEVER').content).toMatchObject({ countryCode: 'CN', countryIntegrity: 'RAW_COUNTRY' });
    expect(projeter(lever(avecLieux('CN', ['Hong Kong', 'Shanghai'])), 'LEVER').content).toMatchObject({ countryCode: 'CN', countryIntegrity: 'RAW_COUNTRY' });
  });
});

describe('D-442 §2 — le territoire nommé dans la VILLE ou la RÉGION du lieu déclaré (LuxExperience, JSON-LD)', () => {
  it('PRÉMISSE : champ pays « CN », lieu sans libellé, Hong Kong nommé par son NOM dans la seule ville, et Hong Kong a son marché', () => {
    expect(CODES_MARCHE).toContain('HK');
    const job = jsonLd(LUXEXPERIENCE_HONG_KONG);
    // Le champ pays de l'offre désigne le pays englobant, et la chaîne d'avant D-442 retient la Chine.
    expect(job.country).toBe('CN');
    expect(resolveGeography({ rawCountry: job.country, location: job.location, city: job.city }).countryCode).toBe('CN');
    // Le lieu déclaré n'a AUCUN libellé : une lecture du seul libellé ne voit pas le territoire.
    const { facts } = projeter(job, 'GENERIC_JSONLD');
    expect(facts.locations.value).toEqual([expect.objectContaining({ label: null, city: 'Hong Kong SAR, China', region: null, country: 'CN' })]);
    // La ville nomme Hong Kong par son NOM, puis le pays englobant ; aucun des deux n'est un code.
    const [territoire, englobant] = 'Hong Kong SAR, China'.split(',').map((segment) => segment.trim());
    expect(territoire).not.toMatch(/^[A-Za-z]{2,3}$/);
    expect(normalizeCountry(territoire)).toBe('HK');
    expect(normalizeCountry(englobant)).toBe('CN');
  });

  it('classe l’offre à Hong Kong ; un nom de lieu ne produit aucune preuve persistée', () => {
    expect(projeter(jsonLd(LUXEXPERIENCE_HONG_KONG), 'GENERIC_JSONLD').content).toMatchObject({ countryCode: 'HK', countryIntegrity: null, adminArea1: null });
  });

  it('la RÉGION nomme le territoire : Kowloon / Hong Kong rejoint Hong Kong, Taipei / Taiwan rejoint Taïwan', () => {
    const kowloon = adresseLux({ addressCountry: 'CN', addressLocality: 'Kowloon', addressRegion: 'Hong Kong' });
    const taipei = adresseLux({ addressCountry: 'CN', addressLocality: 'Taipei', addressRegion: 'Taiwan' });
    // PRÉMISSE : la ville seule ne nomme aucun pays ; seule la région nomme le territoire, et Taïwan a son marché.
    expect(normalizeCountry('Kowloon')).toBeUndefined();
    expect(normalizeCountry('Taipei')).toBeUndefined();
    expect(CODES_MARCHE).toContain('TW');
    expect(projeter(jsonLd(kowloon), 'GENERIC_JSONLD').facts.locations.value)
      .toEqual([expect.objectContaining({ label: null, city: 'Kowloon', region: 'Hong Kong', country: 'CN' })]);
    expect(projeter(jsonLd(kowloon), 'GENERIC_JSONLD').content).toMatchObject({ countryCode: 'HK', countryIntegrity: null });
    expect(projeter(jsonLd(taipei), 'GENERIC_JSONLD').content).toMatchObject({ countryCode: 'TW', countryIntegrity: null });
  });
});

describe('D-442 §2 — ce que la ville et la région NE déplacent PAS', () => {
  it('« Macau SAR, China » sous « CN » reste en Chine : Macao n’a pas de marché', () => {
    // PRÉMISSE : la ville nomme bien Macao par son nom, et Macao n'est pas un marché.
    expect(normalizeCountry('Macau SAR')).toBe('MO');
    expect(CODES_MARCHE).not.toContain('MO');
    expect(projeter(jsonLd(adresseLux({ addressCountry: 'CN', addressLocality: 'Macau SAR, China' })), 'GENERIC_JSONLD').content)
      .toMatchObject({ countryCode: 'CN', countryIntegrity: 'RAW_COUNTRY' });
  });

  it('un CODE n’est pas un nom : « HK » ou « Central, HK » dans la ville laisse l’offre en Chine', () => {
    // PRÉMISSE : le code désigne bien Hong Kong ; seule l'exigence du NOM l'écarte.
    expect(normalizeCountry('HK')).toBe('HK');
    for (const ville of ['HK', 'Central, HK']) {
      expect(projeter(jsonLd(adresseLux({ addressCountry: 'CN', addressLocality: ville })), 'GENERIC_JSONLD').content, ville)
        .toMatchObject({ countryCode: 'CN', countryIntegrity: 'RAW_COUNTRY' });
    }
  });

  it('sans champ pays, la ville ne déplace rien : la Chine lue dans le lieu n’est pas le champ pays qu’exige la règle', () => {
    const job = jsonLd(adresseLux({ addressLocality: 'Hong Kong SAR, China' }));
    // PRÉMISSE : aucun champ pays, et la chaîne retient pourtant la Chine, par le dernier segment du lieu.
    expect(job.country).toBeUndefined();
    expect(resolveGeography({ rawCountry: job.country, location: job.location, city: job.city }).countryCode).toBe('CN');
    expect(projeter(job, 'GENERIC_JSONLD').content.countryCode).toBe('CN');
  });

  it('chaque lieu doit nommer le territoire : Hong Kong ET Shanghai sous « CN » reste en Chine', () => {
    const deuxLieux = { ...LUXEXPERIENCE_HONG_KONG, jobLocation: [LUXEXPERIENCE_HONG_KONG.jobLocation,
      { '@type': 'Place', address: { '@type': 'PostalAddress', addressCountry: 'CN', addressLocality: 'Shanghai' } }] };
    const { facts, content } = projeter(jsonLd(deuxLieux), 'GENERIC_JSONLD');
    expect(facts.locations.value).toHaveLength(2);
    expect(content).toMatchObject({ countryCode: 'CN', countryIntegrity: 'RAW_COUNTRY' });
  });
});

describe('D-450 / D-442 §2 — Porto Rico, nommé dans chaque lieu sous le champ `US`, rejoint son marché', () => {
  it('PRÉMISSE (Skechers) : champ pays des États-Unis, chacun des deux lieux nomme Porto Rico par son NOM, et Porto Rico a son marché', () => {
    expect(CODES_MARCHE).toEqual(expect.arrayContaining(['PR', 'US']));
    const job = careerConnect(SKECHERS_CAROLINA);
    // Le champ pays de l'offre désigne le pays englobant, et la chaîne d'avant la règle retient les États-Unis.
    expect(normalizeCountry(job.country)).toBe('US');
    expect(resolveGeography({ rawCountry: job.country, location: job.location, city: job.city }).countryCode).toBe('US');
    const { facts } = projeter(job, 'PHENOM');
    expect(facts.locations.value).toEqual([
      expect.objectContaining({ path: '', label: null, city: 'Carolina', region: 'Puerto Rico', postalCode: null, country: 'United States of America' }),
      expect.objectContaining({ path: '/multi_location_array/0', label: 'Carolina, Puerto Rico, United States of America', city: null, region: null, country: null }),
    ]);
    // Aucune contradiction : chaque lieu nomme les États-Unis. Ni D-440 ni l'adresse de D-442 §1 ne peuvent le déplacer.
    expect(declaredPlacesCountry(facts.locations)).toBe('US');
    // Porto Rico est nommé par son nom ; le code « PR » de l'adresse de la boutique n'entre dans aucun lieu déclaré.
    expect(normalizeCountry('Puerto Rico')).toBe('PR');
    expect(SKECHERS_CAROLINA.address).toMatch(/, PR \d{5},/);
    expect(facts.locations.evidence.map((e) => e.path)).not.toContain('/address');
  });

  it('classe l’offre de Skechers à Porto Rico ; un nom de lieu ne produit aucune preuve persistée', () => {
    expect(projeter(careerConnect(SKECHERS_CAROLINA), 'PHENOM').content)
      .toMatchObject({ countryCode: 'PR', countryIntegrity: null, adminArea1: null, city: 'Carolina' });
  });

  it('PRÉMISSE (Tapestry) : champ pays des États-Unis, l’unique lieu déclaré est celui de l’instantané et nomme Porto Rico dans son libellé', () => {
    const job = workday(TAPESTRY_SAN_JUAN);
    expect(normalizeCountry(job.country)).toBe('US');
    expect(resolveGeography({ rawCountry: job.country, location: job.location, city: job.city }).countryCode).toBe('US');
    const { facts } = projeter(job, 'WORKDAY');
    expect(facts.locations.value).toEqual([expect.objectContaining({ path: '/detail/jobPostingInfo',
      label: 'San Juan, Puerto Rico, USA (Coach 6102 San Juan-Coach)', city: null, region: null, postalCode: null, country: 'United States of America' })]);
    expect(declaredPlacesCountry(facts.locations)).toBe('US');
  });

  it('classe l’offre de Tapestry à Porto Rico', () => {
    expect(projeter(workday(TAPESTRY_SAN_JUAN), 'WORKDAY').content).toMatchObject({ countryCode: 'PR', countryIntegrity: null, adminArea1: null });
  });

  it('PRÉMISSE (VF Corporation) : champ pays des États-Unis, l’unique lieu ne nomme Porto Rico qu’entre deux « > »', () => {
    const job = workday(VF_SAN_JUAN, VF);
    expect(normalizeCountry(job.country)).toBe('US');
    expect(resolveGeography({ rawCountry: job.country, location: job.location, city: job.city }).countryCode).toBe('US');
    const { facts } = projeter(job, 'WORKDAY');
    expect(facts.locations.value).toEqual([expect.objectContaining({ path: '/detail/jobPostingInfo',
      label: 'USCA > USA > Puerto Rico > San Juan 5008 - KIP', city: null, region: null, postalCode: null, country: 'United States of America' })]);
    expect(declaredPlacesCountry(facts.locations)).toBe('US');
    // Aux séparateurs de la lecture des libellés, le lieu n'est qu'un segment, qui ne nomme aucun pays : seul « > » le découpe.
    const label = facts.locations.value![0].label!;
    expect(label.split(/[,|/·;]/)).toHaveLength(1);
    expect(normalizeCountry(label)).toBeUndefined();
    expect(label.split('>').map((niveau) => niveau.trim())).toContain('Puerto Rico');
  });

  it('classe l’offre de VF Corporation à Porto Rico : le libellé hiérarchique nomme le territoire (D-454 §1)', () => {
    expect(projeter(workday(VF_SAN_JUAN, VF), 'WORKDAY').content).toMatchObject({ countryCode: 'PR', countryIntegrity: null, adminArea1: null });
  });
});

describe('D-450 / D-442 §2 — ce que la règle de Porto Rico NE déplace PAS', () => {
  it('un CODE n’est pas un nom : la région « PR » sous le champ « US » (lieu schema.org des offres ICIMS) reste aux États-Unis', () => {
    // Le lieu JSON-LD d'urbn-hub 32217 (instantané du 24/09/2026), porté ici par le lecteur JSON-LD générique.
    const job = jsonLd(adresseLux({ addressCountry: 'US', addressLocality: 'San Juan', addressRegion: 'PR', postalCode: '00925' }));
    // PRÉMISSE : le code désigne bien Porto Rico ; le lieu déclaré est celui de l'instantané ; seule l'exigence du NOM l'écarte.
    expect(normalizeCountry('PR')).toBe('PR');
    expect(normalizeCountry(job.country)).toBe('US');
    const { facts, content } = projeter(job, 'GENERIC_JSONLD');
    expect(facts.locations.value).toEqual([expect.objectContaining({ label: null, city: 'San Juan', region: 'PR', postalCode: '00925', country: 'US' })]);
    expect(content).toMatchObject({ countryCode: 'US' });
  });

  it('chaque lieu doit nommer Porto Rico : Skechers avec un second lieu en Californie reste aux États-Unis', () => {
    const californie = { latlong: { lat: 34.05223, lon: -118.24368 }, location: 'Los Angeles, California, United States of America' };
    const raw = { ...SKECHERS_CAROLINA, multi_location: [...SKECHERS_CAROLINA.multi_location, californie.location],
      multi_location_array: [...SKECHERS_CAROLINA.multi_location_array, californie] };
    const { facts, content } = projeter(careerConnect(raw), 'PHENOM');
    // PRÉMISSE : trois lieux déclarés, dont un seul qui ne nomme pas Porto Rico.
    expect(facts.locations.value).toHaveLength(3);
    expect(facts.locations.value![2]).toMatchObject({ label: californie.location });
    expect(content).toMatchObject({ countryCode: 'US', countryIntegrity: 'RAW_COUNTRY' });
  });
});

describe('D-442 — les lectures fermées dont les deux règles dépendent', () => {
  const lieu = (v: { country?: string | null; label?: string | null; city?: string | null; region?: string | null; postalCode?: string | null }) => ({
    country: v.country ?? null, label: v.label ?? null, city: v.city ?? null, region: v.region ?? null, postalCode: v.postalCode ?? null });
  const declares = (...values: Array<Parameters<typeof lieu>[0]>) => ({ status: 'DECLARED' as const, evidence: [], issues: [],
    value: values.map((v, i) => ({ ...lieu(v), path: `/${i}`, latitude: null, longitude: null, coordinateStatus: 'NOT_OBSERVED' as const, issues: [] })) });

  it('les champs d’adresse comptés pour Ulta (4) et pour Slough (3, dont le code postal)', () => {
    expect(addressFieldsFor(lieu({ country: 'United States', region: 'North Carolina', postalCode: '28031', label: 'Cornielius, North Carolina' }), 'US'))
      .toEqual({ concordant: ['COUNTRY_NAME', 'REGION', 'POSTAL_CODE', 'LABEL'], dissident: [] });
    expect(addressFieldsFor(lieu({ country: 'United Kingdom', region: 'UK', postalCode: 'SL1--1BX', label: 'Slough/Berkshire, United Kingdom' }), 'GB'))
      .toEqual({ concordant: ['COUNTRY_NAME', 'POSTAL_CODE', 'LABEL'], dissident: [] });
    expect(ADDRESS_CONCORDANCE_THRESHOLD).toBe(3);
  });

  it('un code pays dans le champ pays n’est pas un nom : c’est le signal que l’adresse contredit', () => {
    expect(addressFieldsFor(lieu({ country: 'US', region: 'TX', postalCode: '78701', label: 'Austin, TX' }), 'US').concordant)
      .toEqual(['REGION', 'POSTAL_CODE', 'LABEL']);
    // Un suffixe qui est aussi un code pays (NC, Nouvelle-Calédonie) garde sa garde de collision dans le libellé.
    expect(addressFieldsFor(lieu({ country: 'US', region: 'NC', postalCode: '28031', label: 'Cornelius, NC' }), 'US').concordant)
      .toEqual(['REGION', 'POSTAL_CODE']);
    expect(addressFieldsFor(lieu({ country: 'PR' }), 'US')).toEqual({ concordant: [], dissident: [] });
  });

  it('code postal : ZIP américain, code britannique quels que soient ses séparateurs ; un autre format ne compte pas', () => {
    for (const code of ['28031', '29707', '28031-1234']) expect(postalCodeFitsCountry(code, 'US'), code).toBe(true);
    for (const code of ['SL1 1BX', 'SL1--1BX', 'sl11bx', 'EC1A 1BB', 'W1A 0AX', 'M1 1AE', 'B33 8TH']) expect(postalCodeFitsCountry(code, 'GB'), code).toBe(true);
    // Canada, Pays-Bas, France, Malte : aucun ne passe pour britannique ; un format inconnu ne nomme rien.
    for (const code of ['M5V 3L9', '1012 AB', '75008', 'VLT 1117', '28031']) expect(postalCodeFitsCountry(code, 'GB'), code).toBe(false);
    for (const code of ['2803', '280311', 'SL1 1BX', '']) expect(postalCodeFitsCountry(code, 'US'), code).toBe(false);
    expect(postalCodeFitsCountry('75008', 'FR')).toBe(false);
  });

  it('le champ État ne désigne que les subdivisions des tables US et CA', () => {
    expect(subdivisionCountryOf('North Carolina')).toBe('US');
    expect(subdivisionCountryOf('SC')).toBe('US');
    expect(subdivisionCountryOf('Ontario')).toBe('CA');
    expect(subdivisionCountryOf('QC')).toBe('CA');
    for (const autre of ['UK', 'Berkshire', 'Gironde', 'Nouvelle-Aquitaine', '', null]) expect(subdivisionCountryOf(autre), String(autre)).toBeUndefined();
  });

  it('les territoires : une liste fermée, dont chaque entrée et son pays englobant sont des marchés ; Macao n’en est pas', () => {
    expect(MARKET_TERRITORIES).toEqual({ HK: 'CN', TW: 'CN', PR: 'US' });
    for (const [territoire, englobant] of Object.entries(MARKET_TERRITORIES)) {
      expect(CODES_MARCHE, territoire).toContain(territoire);
      expect(CODES_MARCHE, englobant).toContain(englobant);
    }
    expect(CODES_MARCHE).not.toContain('MO');
    expect(CODES_MARCHE).toHaveLength(41);
  });

  it('Porto Rico sous le champ `US` : par son NOM, dans le libellé, la ville ou la région, et dans chaque lieu', () => {
    const sousUS = (...lieux: Array<Parameters<typeof lieu>[0]>) => declaredPlaceVerdict({ retained: 'US', countryField: 'US', locations: declares(...lieux) });
    // Les deux formes de l'instantané : Tapestry (libellé) et Skechers (région, puis libellé).
    expect(sousUS({ label: 'San Juan, Puerto Rico, USA (Coach 6102 San Juan-Coach)', country: 'United States of America' }))
      .toEqual({ basis: 'TERRITORY', countryCode: 'PR' });
    expect(sousUS({ city: 'Carolina', region: 'Puerto Rico', country: 'United States of America' }, { label: 'Carolina, Puerto Rico, United States of America' }))
      .toEqual({ basis: 'TERRITORY', countryCode: 'PR' });
    // Le champ pays de l'offre peut être écrit en toutes lettres : « United States of America » désigne `US`.
    expect(declaredPlaceVerdict({ retained: 'US', countryField: 'United States of America', locations: declares({ city: 'Ponce', region: 'Puerto Rico' }) }))
      .toEqual({ basis: 'TERRITORY', countryCode: 'PR' });
    // Le champ pays du lieu peut dire le territoire lui-même.
    expect(sousUS({ label: 'Aguadilla, Puerto Rico', country: 'Puerto Rico' })).toEqual({ basis: 'TERRITORY', countryCode: 'PR' });
  });

  it('un CODE n’est jamais un nom : « PR », en région, en ville ou en segment de libellé, laisse l’offre hors de la règle', () => {
    const sousUS = (...lieux: Array<Parameters<typeof lieu>[0]>) => declaredPlaceVerdict({ retained: 'US', countryField: 'US', locations: declares(...lieux) });
    // PRÉMISSE : « PR » désigne bien Porto Rico pour `normalizeCountry` ; seule l'exigence du nom l'écarte.
    expect(normalizeCountry('PR')).toBe('PR');
    // Les trois lieux réels de l'instantané (urbn-hub 32217, aeropostale 9533 et 9577, ICIMS) : San Juan, Bayamón, Isabela.
    for (const [city, postalCode] of [['San Juan', '00925'], ['Bayamon', '00961'], ['Isabela', '00662']]) {
      expect(sousUS({ city, region: 'PR', postalCode, country: 'US' }), city).toEqual({ basis: 'RETAINED', countryCode: 'US' });
    }
    for (const code of [{ label: 'San Juan, PR' }, { label: 'San Juan, PR, United States' }, { city: 'PR' }]) {
      expect(sousUS(code).basis, JSON.stringify(code)).not.toBe('TERRITORY');
    }
  });

  it('le lieu doit être TOUT ENTIER dans le territoire : un État continental ou un second lieu énuméré l’en écarte', () => {
    const sousUS = (...lieux: Array<Parameters<typeof lieu>[0]>) => declaredPlaceVerdict({ retained: 'US', countryField: 'US', locations: declares(...lieux) });
    const sousCN = (...lieux: Array<Parameters<typeof lieu>[0]>) => declaredPlaceVerdict({ retained: 'CN', countryField: 'CN', locations: declares(...lieux) });
    // PRÉMISSE : chacun de ces lieux nomme bien le territoire par son nom, et aucun autre pays que l'englobant.
    expect(normalizeCountry('Puerto Rico')).toBe('PR');
    expect(normalizeCountry('Hong Kong')).toBe('HK');
    for (const autre of ['Miami', 'Florida', 'FL', 'Orlando', 'Los Angeles', 'Shanghai', 'Greater China']) expect(normalizeCountry(autre), autre).toBeUndefined();
    // Un segment qui est une subdivision du pays englobant : le lieu est (aussi) sur le continent.
    for (const mixte of [{ label: 'Miami, FL / Puerto Rico' }, { label: 'Puerto Rico', region: 'Florida' }]) {
      expect(sousUS(mixte).basis, JSON.stringify(mixte)).not.toBe('TERRITORY');
    }
    // Un champ qui énumère plusieurs lieux, dont un hors du territoire, même sans État nommé.
    for (const liste of [{ label: 'Los Angeles / San Juan, Puerto Rico' }, { label: 'Orlando, FL, USA | San Juan, Puerto Rico' }]) {
      expect(sousUS(liste).basis, JSON.stringify(liste)).not.toBe('TERRITORY');
    }
    for (const liste of [{ label: 'Shanghai / Hong Kong' }, { label: 'Greater China | Hong Kong' }, { city: 'Shenzhen; Hong Kong' }, { label: 'Shanghai · Hong Kong' }]) {
      expect(sousCN(liste), JSON.stringify(liste)).toEqual({ basis: 'RETAINED', countryCode: 'CN' });
    }
    // Plusieurs lieux énumérés, tous dans le territoire : la règle s'applique.
    expect(sousUS({ label: 'San Juan, Puerto Rico / Bayamón, Puerto Rico' })).toEqual({ basis: 'TERRITORY', countryCode: 'PR' });
    expect(sousCN({ label: 'Kowloon, Hong Kong / Central, Hong Kong' })).toEqual({ basis: 'TERRITORY', countryCode: 'HK' });
    // Le prix assumé par D-454 §2 : « Florida, Puerto Rico », commune de l'île homonyme d'un État, garde le verdict des
    // règles 1 à 3 — l'abstention pour un libellé seul, les États-Unis quand le lieu dit aussi « United States ».
    expect(subdivisionCountryOf('Florida')).toBe('US');
    expect(sousUS({ label: 'Florida, Puerto Rico' })).toEqual({ basis: 'ABSTAINED', countryCode: undefined, declared: 'PR' });
    expect(sousUS({ label: 'Florida, Puerto Rico', country: 'United States' })).toEqual({ basis: 'RETAINED', countryCode: 'US' });
    // Conséquence du texte de R-125 §4 (« un lieu qui ne nomme pas le territoire »), non présentée au CEO comme telle.
    expect(sousCN({ label: 'Central | Hong Kong' })).toEqual({ basis: 'RETAINED', countryCode: 'CN' });
  });

  it('l’Ulta inversé : « Carolina, Puerto Rico » sous une adresse de Caroline du Nord reste aux États-Unis', () => {
    // Forme Jibe d'Ulta (ULTA_CORNELIUS), code « US », libellé « Carolina, Puerto Rico ».
    const raw = { ...ULTA_CORNELIUS, country_code: 'US', full_location: 'Carolina, Puerto Rico', short_location: 'Carolina, Puerto Rico' };
    const job = jibe(raw);
    const { facts, content } = projeter(job, 'JIBE');
    // PRÉMISSE : le libellé nomme Porto Rico par son nom ; le nom du pays, l'État et le code postal disent les États-Unis.
    expect(normalizeCountry(job.country)).toBe('US');
    expect(facts.locations.value).toEqual([expect.objectContaining({ label: 'Carolina, Puerto Rico', region: 'North Carolina', postalCode: '28031', country: 'United States' })]);
    expect(addressFieldsFor(facts.locations.value![0], 'US').concordant).toEqual(expect.arrayContaining(['COUNTRY_NAME', 'REGION', 'POSTAL_CODE']));
    expect(content).toMatchObject({ countryCode: 'US', countryIntegrity: 'RAW_COUNTRY' });
  });

  it('un champ pays du lieu rempli mais illisible (« MEX », « U.K. ») empêche la règle du territoire ; « N/A » ou « - » disent l’absence', () => {
    const sanJuan = (country: string) => declaredPlaceVerdict({ retained: 'US', countryField: 'US', locations: declares({ label: 'San Juan, Puerto Rico', country }) });
    for (const pays of ['MEX', 'U.K.', 'Dominican Rep.']) {
      // PRÉMISSE : la valeur existe et aucune lecture ne la rend lisible.
      expect(normalizeCountry(pays), pays).toBeUndefined();
      expect(sanJuan(pays).basis, pays).not.toBe('TERRITORY');
    }
    for (const absent of ['N/A', '-']) {
      // PRÉMISSE : `normalizeCountry` lit ces valeurs comme une absence, pas comme un pays illisible.
      expect(normalizeCountry(absent), absent).toBeUndefined();
      expect(sanJuan(absent), absent).toEqual({ basis: 'TERRITORY', countryCode: 'PR' });
    }
  });

  it('LIMITE CONNUE, PAS UN SUCCÈS : les gardes du lieu entier sont des heuristiques, sans répertoire de villes', () => {
    /*
     * Ce témoin grave des angles morts, pas une règle. Une ville du pays englobant qui n'est pas une subdivision, une
     * énumération par conjonction, ou un lieu sous `CN` (aucune table de provinces) passent encore au territoire.
     * Aucune offre dans ces cas le 24/09/2026. S'il passe au rouge parce que ces lieux sont écartés, c'est que les
     * gardes ont été renforcées : mettre ce témoin à jour.
     */
    // PRÉMISSE : ces lieux nomment une ville du pays englobant qu'aucune table ne connaît.
    for (const ville of ['Orlando', 'FL and San Juan', 'Shenzhen']) {
      expect(normalizeCountry(ville), ville).toBeUndefined();
      expect(subdivisionCountryOf(ville), ville).toBeUndefined();
    }
    const sousUS = (label: string) => declaredPlaceVerdict({ retained: 'US', countryField: 'US', locations: declares({ label }) });
    const sousCN = (label: string) => declaredPlaceVerdict({ retained: 'CN', countryField: 'CN', locations: declares({ label }) });
    expect(sousUS('Orlando, San Juan, Puerto Rico')).toEqual({ basis: 'TERRITORY', countryCode: 'PR' });
    expect(sousUS('Miami, FL and San Juan, Puerto Rico')).toEqual({ basis: 'TERRITORY', countryCode: 'PR' });
    expect(sousCN('Hong Kong, Shenzhen')).toEqual({ basis: 'TERRITORY', countryCode: 'HK' });
    // Un libellé hiérarchique est cru tel quel (D-454 §1) : une ville du pays englobant sous le territoire ne se voit pas.
    expect(sousCN('APAC > Hong Kong > Shenzhen')).toEqual({ basis: 'TERRITORY', countryCode: 'HK' });
    expect(sousUS('USCA > USA > Puerto Rico > Miami 12')).toEqual({ basis: 'TERRITORY', countryCode: 'PR' });
  });

  it('Porto Rico : chaque lieu, le veto du champ pays du lieu, un seul territoire, et un appariement fermé', () => {
    const sousUS = (...lieux: Array<Parameters<typeof lieu>[0]>) => declaredPlaceVerdict({ retained: 'US', countryField: 'US', locations: declares(...lieux) });
    // Chaque lieu doit nommer Porto Rico.
    expect(sousUS({ label: 'San Juan, Puerto Rico' }, { label: 'Miami, Florida, United States' })).toEqual({ basis: 'RETAINED', countryCode: 'US' });
    // Le champ pays du lieu garde son veto : il doit dire les États-Unis ou Porto Rico.
    expect(sousUS({ label: 'San Juan, Puerto Rico', country: 'Mexico' }).basis).not.toBe('TERRITORY');
    // Un autre pays, ou un second territoire, nommé dans le même lieu : aucun territoire.
    expect(sousUS({ label: 'San Juan, Puerto Rico, Mexico' }).basis).not.toBe('TERRITORY');
    expect(sousUS({ label: 'San Juan, Puerto Rico / Kowloon, Hong Kong' }).basis).not.toBe('TERRITORY');
    // L'appariement est fermé : Porto Rico ne se lit que sous `US`, Hong Kong et Taïwan que sous `CN`.
    expect(declaredPlaceVerdict({ retained: 'CN', countryField: 'CN', locations: declares({ label: 'San Juan, Puerto Rico' }) }).basis).not.toBe('TERRITORY');
    expect(sousUS({ label: 'Kowloon, Hong Kong' }).basis).not.toBe('TERRITORY');
    expect(sousUS({ city: 'Taipei', region: 'Taiwan' }).basis).not.toBe('TERRITORY');
  });

  it('Porto Rico ne se lit jamais sous un autre champ pays, ni sans champ pays : les États-Unis lus dans le libellé ne sont pas ce champ', () => {
    const lieux = declares({ label: 'San Juan, Puerto Rico, United States' });
    // PRÉMISSE : ce lieu nomme bien Porto Rico par son nom, et son libellé se termine par les États-Unis.
    expect(normalizeCountry('Puerto Rico')).toBe('PR');
    expect(resolveGeography({ location: 'San Juan, Puerto Rico, United States' }).countryCode).toBe('US');
    expect(declaredPlaceVerdict({ retained: 'US', countryField: undefined, locations: lieux })).toEqual({ basis: 'RETAINED', countryCode: 'US' });
    for (const autre of ['FR', 'MX', 'ES']) {
      expect(declaredPlaceVerdict({ retained: autre, countryField: autre, locations: declares({ city: 'Carolina', region: 'Puerto Rico' }) }), autre)
        .toEqual({ basis: 'RETAINED', countryCode: autre });
    }
  });

  it('D-454 §1 : un libellé hiérarchique « … > Puerto Rico > … » nomme le territoire ; « > » n’énumère pas de lieux', () => {
    const sousUS = (label: string) => declaredPlaceVerdict({ retained: 'US', countryField: 'United States of America',
      locations: declares({ label, country: 'United States of America' }) });
    // PRÉMISSE : les niveaux codés de la hiérarchie (« USCA », « USA ») ne nomment aucun autre pays par leur nom.
    expect(normalizeCountry('USCA')).toBeUndefined();
    expect(sousUS('USCA > USA > Puerto Rico > San Juan 5008 - KIP')).toEqual({ basis: 'TERRITORY', countryCode: 'PR' });
    expect(sousUS('USCA > USA > Puerto Rico > Barceloneta 455 - VAN')).toEqual({ basis: 'TERRITORY', countryCode: 'PR' });
    // Un niveau qui est un État du pays englobant rend le lieu mixte (D-454 §2) ; un autre État reste aux États-Unis.
    expect(sousUS('USCA > USA > Florida > Puerto Rico').basis).not.toBe('TERRITORY');
    expect(sousUS('USCA > USA > Georgia > Atlanta 101 - VAN')).toEqual({ basis: 'RETAINED', countryCode: 'US' });
  });

  it('D-454 §1 ne vise que le LIBELLÉ : un « > » dans la ville ou la région ne se lit pas, ni hors de la règle du territoire', () => {
    const hierarchie = 'USA > Puerto Rico > San Juan';
    // PRÉMISSE : ce texte nomme bien Porto Rico entre deux « > », et le même texte en libellé passe au territoire.
    expect(hierarchie.split('>').map((niveau) => niveau.trim())).toContain('Puerto Rico');
    const sousUS = (lieu: Parameters<typeof declares>[0]) => declaredPlaceVerdict({ retained: 'US', countryField: 'US', locations: declares(lieu) });
    expect(sousUS({ label: hierarchie })).toEqual({ basis: 'TERRITORY', countryCode: 'PR' });
    expect(sousUS({ city: hierarchie }).basis).not.toBe('TERRITORY');
    expect(sousUS({ region: hierarchie }).basis).not.toBe('TERRITORY');
    // La lecture ordinaire des libellés et la contradiction ne lisent pas « > » : le libellé VF ne nomme aucun pays.
    const vf = 'USCA > USA > Puerto Rico > San Juan 5008 - KIP';
    expect(countryFromLocation(vf)).toBeUndefined();
    expect(resolveGeography({ location: vf }).countryCode).toBeUndefined();
    expect(declaredPlacesCountry(declares({ label: vf }))).toBeUndefined();
  });

  it('LIMITE DOCUMENTÉE (D-454), PAS UN SUCCÈS : un nom de boutique qui contient « Puerto Rico » ne déplace rien', () => {
    /*
     * Ce témoin grave une limite consignée par D-454, pas une règle : 1 offre Puma écrit « Outlet Puerto Rico Prime », un nom de
     * boutique qui n'est pas un segment de lieu. Elle reste aux États-Unis. S'il passe un jour au rouge parce qu'elle rejoint Porto
     * Rico, c'est qu'une nouvelle décision a été rendue : mettre ce témoin à jour.
     */
    const label = 'Outlet Puerto Rico Prime';
    // PRÉMISSE : le libellé mentionne bien Porto Rico, sous le champ pays « United States of America ».
    expect(label).toMatch(/Puerto Rico/);
    expect(declaredPlaceVerdict({ retained: 'US', countryField: 'United States of America', locations: declares({ label, country: 'United States of America' }) }))
      .toEqual({ basis: 'RETAINED', countryCode: 'US' });
  });

  it('le « Macau » de Gironde (WTTJ, champ `FR`) reste français, même si le lecteur WTTJ le déclarait un jour', () => {
    // Forme de production : office { city: 'Macau', country: 'France', country_code: 'FR', zip_code: '33460' }.
    const places = declares({ country: 'France', label: 'Macau', postalCode: '33460' });
    expect(declaredPlaceVerdict({ retained: 'FR', countryField: 'FR', locations: places })).toEqual({ basis: 'RETAINED', countryCode: 'FR' });
  });

  it('la règle du territoire exige le champ `CN` et, dans le lieu, aucun autre pays que `CN` ou le territoire', () => {
    const hk = declares({ label: 'Hong Kong' });
    expect(declaredPlaceVerdict({ retained: 'CN', countryField: 'CN', locations: hk })).toEqual({ basis: 'TERRITORY', countryCode: 'HK' });
    // Le pays retenu vient du libellé, pas d'un champ : hors de la règle.
    expect(declaredPlaceVerdict({ retained: 'CN', countryField: undefined, locations: hk }).basis).toBe('RETAINED');
    expect(declaredPlaceVerdict({ retained: 'CN', countryField: 'CN', locations: declares({ label: 'Hong Kong', country: 'France' }) }).basis).not.toBe('TERRITORY');
    expect(declaredPlaceVerdict({ retained: 'CN', countryField: 'CN', locations: declares({ label: 'Hong Kong, China', country: 'China' }) }))
      .toEqual({ basis: 'TERRITORY', countryCode: 'HK' });
    expect(declaredPlaceVerdict({ retained: 'CN', countryField: 'CN', locations: declares({ label: 'Hong Kong / Taipei, Taiwan' }) }).basis).not.toBe('TERRITORY');
    // Un code n'est pas un nom explicite.
    expect(declaredPlaceVerdict({ retained: 'CN', countryField: 'CN', locations: declares({ label: 'Central, HK' }) }).basis).toBe('RETAINED');
  });

  it('le territoire se lit dans le libellé, la VILLE ou la RÉGION du lieu, par son nom — jamais par un code', () => {
    const sousCN = (...lieux: Array<Parameters<typeof lieu>[0]>) => declaredPlaceVerdict({ retained: 'CN', countryField: 'CN', locations: declares(...lieux) });
    expect(sousCN({ city: 'Hong Kong SAR, China', country: 'CN' })).toEqual({ basis: 'TERRITORY', countryCode: 'HK' });
    expect(sousCN({ city: 'Kowloon', region: 'Hong Kong' })).toEqual({ basis: 'TERRITORY', countryCode: 'HK' });
    expect(sousCN({ city: 'Taipei', region: 'Taiwan' })).toEqual({ basis: 'TERRITORY', countryCode: 'TW' });
    // Chacun de ces codes désigne bien un territoire (`normalizeCountry`) : seule l'exigence du nom les écarte.
    for (const code of [{ city: 'HK' }, { city: 'Central, HK' }, { region: 'TW' }]) expect(sousCN(code).basis, JSON.stringify(code)).toBe('RETAINED');
    // Macao n'a pas de marché ; deux territoires nommés dans un même lieu n'en désignent aucun ; le champ pays du lieu garde son veto.
    expect(sousCN({ city: 'Macau SAR, China' })).toEqual({ basis: 'RETAINED', countryCode: 'CN' });
    expect(sousCN({ label: 'Taipei, Taiwan', city: 'Hong Kong' }).basis).not.toBe('TERRITORY');
    expect(sousCN({ city: 'Hong Kong', country: 'France' }).basis).not.toBe('TERRITORY');
    // Chaque lieu doit nommer le même territoire.
    expect(sousCN({ city: 'Hong Kong SAR, China' }, { city: 'Shanghai' }).basis).toBe('RETAINED');
  });

  it('la ville ne déplace rien sous un champ pays qui n’est pas `CN`, ni sans champ pays', () => {
    const hk = declares({ city: 'Hong Kong SAR, China' });
    expect(declaredPlaceVerdict({ retained: 'FR', countryField: 'FR', locations: hk })).toEqual({ basis: 'RETAINED', countryCode: 'FR' });
    expect(declaredPlaceVerdict({ retained: 'GB', countryField: 'United Kingdom', locations: hk })).toEqual({ basis: 'RETAINED', countryCode: 'GB' });
    expect(declaredPlaceVerdict({ retained: 'CN', countryField: undefined, locations: hk })).toEqual({ basis: 'RETAINED', countryCode: 'CN' });
    // Le « Macau » de Gironde porté par la VILLE d'un bureau WTTJ (city, country, zip_code), si ce lecteur le déclarait un jour.
    expect(declaredPlaceVerdict({ retained: 'FR', countryField: 'FR', locations: declares({ country: 'France', city: 'Macau', postalCode: '33460' }) }))
      .toEqual({ basis: 'RETAINED', countryCode: 'FR' });
  });

  it('LIMITE CONNUE, PAS UN SUCCÈS : un territoire nommé SEULEMENT dans le champ pays du lieu, sous `CN`, mène à l’abstention', () => {
    /*
     * Ce témoin grave un état non tranché, pas une règle. Le texte de D-442 (« nommé explicitement dans le lieu
     * déclaré ») ne dit pas si le champ pays du lieu compte ; le code ne lit que libellé, ville et région, et ce
     * lieu tombe dans la contradiction (1 champ d'adresse sur 3), donc sans marché. Mesuré le 24/09/2026 : 0 offre
     * publiable dans ce cas. S'il passe un jour au rouge parce que ce lieu rejoint Hong Kong, c'est que
     * l'arbitrage a été rendu : mettre ce témoin à jour.
     */
    expect(declaredPlaceVerdict({ retained: 'CN', countryField: 'CN', locations: declares({ country: 'Hong Kong', city: 'Central' }) }))
      .toEqual({ basis: 'ABSTAINED', countryCode: undefined, declared: 'HK' });
    // Dès qu'un champ de nom de lieu le nomme aussi, la règle du territoire s'applique.
    expect(declaredPlaceVerdict({ retained: 'CN', countryField: 'CN', locations: declares({ country: 'Hong Kong', label: 'Central, Hong Kong' }) }))
      .toEqual({ basis: 'TERRITORY', countryCode: 'HK' });
  });

  it('sans lieux déclarés, aucune règle : le pays retenu reste', () => {
    expect(declaredPlaceVerdict({ retained: 'PR', countryField: 'PR', locations: undefined })).toEqual({ basis: 'RETAINED', countryCode: 'PR' });
    expect(declaredPlaceVerdict({ retained: 'PR', countryField: 'PR', locations: { status: 'UNINTERPRETED', value: null, evidence: [], issues: [] } }).basis).toBe('RETAINED');
  });
});

describe('D-442 §1 — l’adresse ne l’emporte que sur un CODE pays', () => {
  const adresseUlta = { status: 'DECLARED' as const, evidence: [], issues: [], value: [{ path: '/0', label: 'Cornielius, North Carolina', city: null,
    region: 'North Carolina', postalCode: '28031', country: 'United States', latitude: null, longitude: null, coordinateStatus: 'NOT_OBSERVED' as const, issues: [] }] };

  it('le code « PR », quelle que soit sa casse, cède devant quatre champs concordants', () => {
    expect(declaredPlaceVerdict({ retained: 'PR', countryField: 'PR', locations: adresseUlta })).toEqual({ basis: 'ADDRESS', countryCode: 'US', countryName: 'United States' });
    expect(declaredPlaceVerdict({ retained: 'PR', countryField: ' pr ', locations: adresseUlta }).basis).toBe('ADDRESS');
  });

  it('un pays retenu par un NOM, ou lu dans un libellé, n’est pas un code : D-442 ne tranche pas, l’abstention demeure', () => {
    expect(declaredPlaceVerdict({ retained: 'PR', countryField: 'Puerto Rico', locations: adresseUlta })).toEqual({ basis: 'ABSTAINED', countryCode: undefined, declared: 'US' });
    expect(declaredPlaceVerdict({ retained: 'PR', countryField: undefined, locations: adresseUlta }).basis).toBe('ABSTAINED');
    // Un code qui n'est pas celui du pays retenu n'a pas produit ce pays.
    expect(declaredPlaceVerdict({ retained: 'PR', countryField: 'CA', locations: adresseUlta }).basis).toBe('ABSTAINED');
  });
});
