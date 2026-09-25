import { describe, expect, it } from 'vitest';
import type { AtsType } from '@prisma/client';
import type { SourceFacts } from '@catwalks/db/source-facts';
import { readSourceFacts, projectSourceFacts } from '../facts/index.js';
import { toCandidate } from '../pipeline/ingest.js';
import { parseJibePage } from '../ats/adapters/jibe.js';
import { parsePhenomJob } from '../ats/adapters/phenom.js';
import { parseLeverJob } from '../ats/adapters/lever.js';
import { normalizeCountry, countryFromLocation } from '../normalize/country.js';
import { resolveGeography, US_SUBDIVISION_NAMES } from '../normalize/geography.js';
import { addressFieldsFor, declaredPlacesCountry } from '../normalize/declaredPlaceCountry.js';
import { BOOTSTRAP_TAXONOMY } from '../normalize/taxonomy.js';
import type { NormalizedJob } from '../types.js';
import { publicationJobContent } from './content.js';

/**
 * D-440 POINT 1 — UNE PUBLICATION DONT LES SIGNAUX DE PAYS SE CONTREDISENT N'A PAS DE PAYS CERTAIN (D-435).
 *
 * Mesuré en production le 24/09/2026 (`audits/2026-09-24/scripts/pays-signaux-contradictoires.mts`) :
 * 12 offres Ulta de Cornelius (NC) et d'Indian Land (SC) classées à Porto Rico avec le verdict
 * `RAW_COUNTRY`, et une boutique Foot Locker de Slough classée aux États-Unis. Chaque fois, le code pays
 * retenu par l'adaptateur contredisait le nom de pays que la même publication déclare pour le même lieu.
 *
 * Le témoin passe par le chemin réel de l'ingestion : parseur de l'adaptateur, `toCandidate`, lecteur de
 * faits appliqué comme dans `upsertDeduplicated` (dedup/upsert.ts), puis `publicationJobContent`, la
 * projection que l'ingestion écrit dans `Job`. Les formes RAW sont celles de production, relues en lecture
 * seule, textes d'annonce retirés.
 *
 * D-442 (24/09/2026) a PRÉCISÉ cette règle : trois champs d'adresse concordants l'emportent sur le code (les
 * 12 Ulta et Slough ne s'abstiennent plus), et un territoire qui a son marché l'emporte sur son pays
 * englobant (Hong Kong et Taïwan sous `CN` ; Porto Rico sous `US`, D-450). Ce fichier garde la contradiction
 * et l'abstention qui demeure en dessous de trois champs ; les deux règles de D-442 ont leurs témoins dans
 * `pays-adresse-territoire-d442.test.ts`.
 */

/** careers.ulta.com/api/jobs, offre 488752 (lieu, codes et coordonnées tels que servis ; texte retiré). */
const ULTA_PR = {
  city: 'Cornielius', slug: '488752', state: 'North Carolina', tags1: ['Part Time'], tags2: ['Field'], title: 'Stylist',
  req_id: '488752', country: 'United States', language: 'en-us', latitude: 18.38078, longitude: -65.95739,
  apply_url: 'https://fdcnmcareers-ulta.icims.com/jobs/488752/login', postal_code: '28031', posted_date: '2026-05-08T20:32:00+0000',
  country_code: 'PR', full_location: 'Cornielius, North Carolina', location_name: 'The Shops at the Fresh Market',
  location_type: 'LAT_LNG', short_location: 'Cornielius, North Carolina', multipleLocations: false,
  hiring_organization: 'Ulta Beauty, Inc.', description: '<p>Stylist</p>',
  meta_data: { canonical_url: 'https://careers.ulta.com/jobs/488752?lang=en-us' },
};

/** uk-retail-footlocker (Phenom), offre 64612 : boutique de Slough, code pays et coordonnées américains. */
const FOOT_LOCKER_SLOUGH = {
  city: 'Slough/Berkshire', slug: '64612', state: 'UK', tags2: ['Regular Part-Time'], tags4: ['Foot Locker'], title: 'CX Team Member',
  req_id: '64612', country: 'United Kingdom', language: 'en-us', latitude: 33.836081, longitude: -81.1637245,
  apply_url: 'https://uk-retail-footlocker.icims.com/jobs/64612/login', postal_code: 'SL1--1BX', create_date: '2026-09-07T09:10:23+0000',
  country_code: 'US', full_location: 'Slough/Berkshire, United Kingdom', location_name: 'Slough/Berkshire UK', employment_type: 'PART_TIME',
  multipleLocations: false, hiring_organization: 'Foot Locker',
};

/** jobs.lever.co/arcteryx.com : `country` ISO-2 déclaré par l'employeur, lieux en libellés seuls. */
const ARCTERYX_HONG_KONG = { id: 'ead3e20f-e987-4b77-aea1-152e72068be2', text: 'Product Compliance Specialist 2', country: 'CN',
  hostedUrl: 'https://jobs.lever.co/arcteryx.com/ead3e20f-e987-4b77-aea1-152e72068be2', createdAt: 1786046175314,
  categories: { location: 'Hong Kong', department: 'Supply Chain', allLocations: ['Hong Kong'] }, workplaceType: 'onsite' };
const ARCTERYX_DEUX_LIEUX = { id: 'c89e8279-f15f-473e-8115-ba2ece8fc630', text: 'Senior Demand Planner', country: 'CA',
  hostedUrl: 'https://jobs.lever.co/arcteryx.com/c89e8279-f15f-473e-8115-ba2ece8fc630', createdAt: 1781899424327,
  categories: { location: 'North Vancouver, BC (Corporate)', department: 'Supply Chain',
    allLocations: ['North Vancouver, BC (Corporate)', 'Portland, Oregon'] }, workplaceType: 'hybrid' };

/** Le chemin de l'ingestion : `toCandidate`, puis le lecteur de faits exactement comme `upsertDeduplicated`. */
function projeter(job: NormalizedJob, atsType: AtsType, options: { sansFaits?: boolean } = {}) {
  const candidate = toCandidate(job, { key: `temoin-${atsType.toLowerCase()}`, company: 'Témoin', tier: 'ATS_OFFICIAL' }, 'Témoin', atsType);
  const facts = readSourceFacts(atsType, candidate.raw);
  const withFacts = options.sansFaits ? candidate : { ...candidate, ...projectSourceFacts(facts), sourceFacts: facts };
  return { candidate, facts, content: publicationJobContent(withFacts, BOOTSTRAP_TAXONOMY) };
}
const jibe = (raw: object) => parseJibePage({ jobs: [{ data: raw }] }, 'https://careers.ulta.com')[0];
const phenom = (raw: object) => parsePhenomJob(raw as never, 'https://uk-retail-footlocker.icims.com')!;
const lever = (raw: object) => parseLeverJob(raw as never, {});

describe('D-440 — Ulta : un code « PR » contredit « United States » pour le même lieu', () => {
  it('PRÉMISSE : la publication déclare deux pays, et le défaut entre bien par le code retenu', () => {
    // Les deux champs dédiés au pays désignent deux pays différents.
    expect(normalizeCountry(ULTA_PR.country_code)).toBe('PR');
    expect(normalizeCountry(ULTA_PR.country)).toBe('US');
    expect(US_SUBDIVISION_NAMES.has(ULTA_PR.state), 'l’État déclaré est une subdivision des États-Unis').toBe(true);
    // L'adaptateur retient le code : c'est lui qui entre en premier dans `retainedCountryOf`.
    const job = jibe(ULTA_PR);
    expect(normalizeCountry(job.country)).toBe('PR');
    // Le lecteur de faits déclare UN lieu, sous l'autre pays.
    const { facts } = projeter(job, 'JIBE');
    expect(facts.locations.status).toBe('DECLARED');
    expect(facts.locations.value).toHaveLength(1);
    expect(declaredPlacesCountry(facts.locations)).toBe('US');
    // Le repli par le libellé rendrait les États-Unis : l'abstention doit tenir contre lui.
    expect(resolveGeography({ location: job.location }).countryCode).toBe('US');
  });

  it('ne classe plus l’offre à Porto Rico : son adresse la place aux États-Unis (D-442)', () => {
    expect(projeter(jibe(ULTA_PR), 'JIBE').content).toMatchObject({ countryCode: 'US', countryIntegrity: 'RAW_COUNTRY', adminArea1: 'North Carolina' });
  });

  it('sans adresse concordante (le nom du pays seul), ni Porto Rico ni les États-Unis : aucun pays, aucune preuve, aucun État', () => {
    const raw = { ...ULTA_PR, state: undefined, postal_code: undefined, full_location: 'Cornielius', short_location: 'Cornielius' };
    const { facts, content } = projeter(jibe(raw), 'JIBE');
    // PRÉMISSE : la contradiction demeure, mais un seul champ d'adresse nomme les États-Unis.
    expect(declaredPlacesCountry(facts.locations)).toBe('US');
    expect(addressFieldsFor(facts.locations.value![0], 'US').concordant).toEqual(['COUNTRY_NAME']);
    expect(content.countryCode).toBeNull();
    expect(content.countryIntegrity).toBeNull();
    expect(content.adminArea1).toBeNull();
    // Le lieu lui-même n'est pas contesté : il reste affiché.
    expect(content.city).toBe('Cornielius');
    expect(content.location).toBe('Cornielius');
  });

  it('une offre Ulta cohérente garde son pays, sa preuve et son État', () => {
    const coherente = { ...ULTA_PR, country_code: 'US', latitude: 35.4833, longitude: -80.8601 };
    const { content } = projeter(jibe(coherente), 'JIBE');
    expect(content).toMatchObject({ countryCode: 'US', countryIntegrity: 'RAW_COUNTRY', adminArea1: 'North Carolina', city: 'Cornielius' });
  });

  it('sans lecture de faits, la chaîne historique reste inchangée : la garde exige les lieux déclarés', () => {
    // `upsertDeduplicated` et `dedup/repair.ts` posent toujours `sourceFacts` avant la projection.
    const { content } = projeter(jibe(ULTA_PR), 'JIBE', { sansFaits: true });
    expect(content.countryCode).toBe('PR');
  });
});

describe('D-440 — Foot Locker : un code « US » contredit « United Kingdom » pour Slough', () => {
  it('PRÉMISSE : deux pays déclarés pour un seul lieu', () => {
    expect(normalizeCountry(FOOT_LOCKER_SLOUGH.country_code)).toBe('US');
    expect(normalizeCountry(FOOT_LOCKER_SLOUGH.country)).toBe('GB');
    const job = phenom(FOOT_LOCKER_SLOUGH);
    expect(normalizeCountry(job.country)).toBe('US');
    expect(declaredPlacesCountry(projeter(job, 'PHENOM').facts.locations)).toBe('GB');
  });

  it('prend le pays de son adresse (D-442), et une boutique cohérente garde son pays', () => {
    expect(projeter(phenom(FOOT_LOCKER_SLOUGH), 'PHENOM').content).toMatchObject({ countryCode: 'GB', countryIntegrity: 'RAW_COUNTRY', adminArea1: null });
    const coherente = { ...FOOT_LOCKER_SLOUGH, country_code: 'GB' };
    expect(projeter(phenom(coherente), 'PHENOM').content).toMatchObject({ countryCode: 'GB', countryIntegrity: 'RAW_COUNTRY' });
  });
});

describe('D-440 — aucune subdivision ne survit à l’abstention', () => {
  it('un code « US » contredit par « Canada » ne laisse pas l’Ontario sous un pays absent', () => {
    // Ni champ État ni code postal : deux champs d'adresse seulement (nom du pays, libellé), donc abstention.
    const raw = { ...ULTA_PR, country_code: 'US', country: 'Canada', state: undefined, city: 'Toronto',
      full_location: 'Toronto, Ontario', postal_code: undefined, latitude: 43.6426, longitude: -79.3871 };
    const job = jibe(raw);
    // PRÉMISSE : sous le pays « US » retenu par l'adaptateur, la lecture du libellé produit bien une subdivision…
    expect(resolveGeography({ rawCountry: job.country, location: job.location, city: job.city }).adminArea1).toBe('Ontario');
    // … et l'adresse reste sous le seuil de D-442.
    const { facts, content } = projeter(job, 'JIBE');
    expect(addressFieldsFor(facts.locations.value![0], 'CA').concordant).toEqual(['COUNTRY_NAME', 'LABEL']);
    expect(content).toMatchObject({ countryCode: null, countryIntegrity: null, adminArea1: null });
  });
});

describe('D-440 — ce que la règle NE touche PAS', () => {
  it('Arc’teryx « Hong Kong » sous `CN` : la contradiction ne le lit pas ; seule la règle du territoire (D-442) le déplace', () => {
    // PRÉMISSE : le repli `countryFromLocation` lirait bien Hong Kong ; la contradiction ne l'emploie pas pour contredire un champ.
    expect(countryFromLocation('Hong Kong')).toBe('HK');
    const { facts, content } = projeter(lever(ARCTERYX_HONG_KONG), 'LEVER');
    expect(declaredPlacesCountry(facts.locations)).toBeUndefined();
    // Ce n'est donc pas une abstention : c'est le territoire, sans preuve persistée (lu dans le libellé).
    expect(content).toMatchObject({ countryCode: 'HK', countryIntegrity: null });
  });

  it('Arc’teryx à deux lieux sous `CA` le reste : le lieu canadien sans pays lisible peut être celui du champ', () => {
    const { facts, content } = projeter(lever(ARCTERYX_DEUX_LIEUX), 'LEVER');
    // PRÉMISSE : le second lieu nomme bien un autre pays que le champ.
    expect(facts.locations.value).toHaveLength(2);
    expect(resolveGeography({ location: 'Portland, Oregon' }).countryCode).toBe('US');
    expect(content.countryCode).toBe('CA');
  });
});

describe('declaredPlacesCountry — le témoin ne lit que ce qui nomme un pays', () => {
  const lieux = (...values: Array<{ country?: string | null; label?: string | null }>): SourceFacts['locations'] => ({
    status: 'DECLARED', evidence: [], issues: [],
    value: values.map((v, i) => ({ path: `/${i}`, label: v.label ?? null, city: null, region: null, postalCode: null,
      country: v.country ?? null, latitude: null, longitude: null, coordinateStatus: 'NOT_OBSERVED', issues: [] })),
  });

  it('un libellé d’un seul nom ne nomme pas de pays, même homonyme d’un territoire (Macau, Gironde)', () => {
    // PRÉMISSE : le piège existe, `countryFromLocation` lit Macao.
    expect(countryFromLocation('Macau')).toBe('MO');
    expect(declaredPlacesCountry(lieux({ label: 'Macau' }))).toBeUndefined();
    expect(declaredPlacesCountry(lieux({ country: 'France', label: 'Macau' }))).toBe('FR');
  });

  it('le champ pays prime sur le libellé ; le libellé ne compte que par sa structure', () => {
    expect(declaredPlacesCountry(lieux({ country: 'United Kingdom', label: 'Slough/Berkshire, United Kingdom' }))).toBe('GB');
    expect(declaredPlacesCountry(lieux({ label: 'Slough/Berkshire, United Kingdom' }))).toBe('GB');
    // Même priorité que `retainedCountryOf` : le champ déclaré d'un lieu passe avant la lecture de son libellé.
    expect(declaredPlacesCountry(lieux({ country: 'United States', label: 'Toronto, Ontario' }))).toBe('US');
    expect(declaredPlacesCountry(lieux({ label: 'Montreal, Quebec, CAN' }))).toBe('CA');
    // Un code collisionnant sans preuve indépendante ne nomme rien.
    expect(declaredPlacesCountry(lieux({ label: 'Berlin, DE' }))).toBeUndefined();
  });

  it('plusieurs lieux : un seul pays si TOUS le nomment ; sinon aucun', () => {
    expect(declaredPlacesCountry(lieux({ country: 'US' }, { label: 'Portland, Oregon' }))).toBe('US');
    expect(declaredPlacesCountry(lieux({ country: 'US' }, { country: 'Canada' }))).toBeUndefined();
    expect(declaredPlacesCountry(lieux({ country: 'US' }, { label: 'Paris' }))).toBeUndefined();
  });

  it('des lieux non déclarés ne témoignent de rien', () => {
    expect(declaredPlacesCountry(undefined)).toBeUndefined();
    expect(declaredPlacesCountry({ status: 'UNINTERPRETED', value: null, evidence: [], issues: [] })).toBeUndefined();
    expect(declaredPlacesCountry({ status: 'DECLARED', value: [], evidence: [], issues: [] })).toBeUndefined();
    // Même contrat que `scalarSourceFacts` : seules des valeurs DÉCLARÉES témoignent, quel que soit leur contenu.
    expect(declaredPlacesCountry({ ...lieux({ country: 'United States' }), status: 'CONFLICT' })).toBeUndefined();
  });
});
