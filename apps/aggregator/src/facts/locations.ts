import type { Evidence, Fact, FactStatus, SourceLocation } from '@catwalks/db/source-facts';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { at, object } from './types.js';

type Fields = Partial<Record<'label' | 'city' | 'region' | 'postalCode' | 'country' | 'latitude' | 'longitude', string>> &
  { coordinatePair?: string; pairOrder?: 'LAT_LON' | 'LON_LAT' };
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const number = (value: unknown): number | null => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) return null;
  const result = Number(value); return Number.isFinite(result) ? result : null;
};

/** Read every declared place in order. Coordinates always travel as a pair with their own place. */
export function readLocations(type: string, raw: unknown): Fact<SourceLocation[]> {
  if (!object(raw)) return { status: 'INPUT_MISSING', value: null, evidence: [], issues: [] };
  const kind = KIND_TO_ATS[type] ?? type, evidence: Evidence[] = [], issues: string[] = [], locations: SourceLocation[] = [];
  let withheld = false;
  const take = (path: string) => { const value = at(raw, path); if (value !== undefined) evidence.push({ path, value }); return value; };
  const add = (path: string, fields: Fields) => {
    const entry = at(raw, path);
    if (entry == null) return;
    if (typeof entry === 'string') {
      const label = text(entry); if (label) { take(path); locations.push({ path, label, city: null, region: null, postalCode: null,
        country: null, latitude: null, longitude: null, coordinateStatus: 'NOT_OBSERVED', issues: [] }); } return;
    }
    if (!object(entry)) { take(path); issues.push('UNINTERPRETED_LOCATION'); return; }
    if (kind === 'WORKABLE' && at(raw, `${path}/hidden`) === true) { take(`${path}/hidden`); withheld = true; return; }
    if (fields.latitude === 'geo/latitude' && at(raw, `${path}/geo`) == null) {
      fields = { ...fields, latitude: 'latitude', longitude: 'longitude' };
    }
    const read = (key: keyof Fields) => fields[key] ? take(`${path}/${fields[key]}`) : undefined;
    const location: SourceLocation = { path, label: text(read('label')), city: text(read('city')), region: text(read('region')),
      postalCode: text(read('postalCode')), country: text(read('country')), latitude: null, longitude: null, coordinateStatus: 'NOT_OBSERVED', issues: [] };
    if (!location.country && fields.country && object(at(raw, `${path}/${fields.country}`))) {
      location.country = text(take(`${path}/${fields.country}/name`));
    }
    let lat: unknown, lon: unknown;
    if (fields.coordinatePair) {
      const input = read('coordinatePair'); let pair: unknown = input;
      if (typeof input === 'string') pair = input.split(',').map(value => value.trim());
      if (Array.isArray(pair) && pair.length === 1 && Array.isArray(pair[0])) pair = pair[0];
      if (Array.isArray(pair) && pair.length === 2) [lat, lon] = fields.pairOrder === 'LON_LAT' ? [pair[1], pair[0]] : pair;
      else if (input != null) { location.coordinateStatus = 'UNINTERPRETED'; location.issues.push('UNINTERPRETED_COORDINATE_PAIR'); }
    } else { lat = read('latitude'); lon = read('longitude'); }
    if (lat != null || lon != null) {
      const latitude = number(lat), longitude = number(lon);
      let status: FactStatus = 'DECLARED';
      if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        status = 'INVALID'; location.issues.push('INVALID_OR_INCOMPLETE_COORDINATE_PAIR');
      } else if (latitude === 0 && longitude === 0) {
        status = 'UNINTERPRETED'; location.issues.push('ZERO_PAIR_REQUIRES_VERIFICATION');
      } else { location.latitude = latitude; location.longitude = longitude; }
      location.coordinateStatus = status;
    }
    if (location.label || location.city || location.country || location.postalCode || location.region || location.coordinateStatus !== 'NOT_OBSERVED') locations.push(location);
  };
  const many = (path: string, fields: Fields) => {
    const entries = at(raw, path);
    if (Array.isArray(entries)) entries.forEach((_, index) => add(`${path}/${index}`, fields)); else add(path, fields);
  };
  const jsonLd = (path: string) => many(path, { label: 'name', city: 'address/addressLocality', region: 'address/addressRegion',
    postalCode: 'address/postalCode', country: 'address/addressCountry', latitude: 'geo/latitude', longitude: 'geo/longitude' });
  const named: Fields = { label: 'full_location', city: 'city', region: 'state', postalCode: 'postal_code', country: 'country', latitude: 'latitude', longitude: 'longitude' };
  switch (kind) {
    case 'GENERIC_JSONLD': jsonLd('/jobLocation'); break;
    case 'TEAMTAILOR': jsonLd('/_jobposting/jobLocation'); break;
    case 'ICIMS': case 'ALTAMIRA': jsonLd('/postingEvidence/jobPosting/jobLocation'); break;
    case 'SWATCH_GROUP': jsonLd('/jsonLd/jobLocation'); break;
    case 'JOBYLON': jsonLd('/posting/jobLocation'); break;
    case 'PHENOM': case 'JIBE':
      add('', named); many('/additional_locations', named); many('/multi_location_array', { label: 'location', latitude: 'latlong/lat', longitude: 'latlong/lon' }); break;
    case 'SMARTRECRUITERS': add('/location', { ...named, label: 'fullLocation', region: 'region' }); break;
    case 'RECRUITEE': many('/locations', { label: 'name', city: 'city', region: 'state', country: 'country_code', postalCode: 'postal_code' }); break;
    case 'WORKABLE': many('/locations', { city: 'city', region: 'region', country: 'countryCode' }); break;
    case 'RITUALS': add('', { label: 'locationName', city: 'city', country: 'country', postalCode: 'postalCode', latitude: 'lonLat/lat', longitude: 'lonLat/lon' }); break;
    case 'ASHBY': {
      const fields: Fields = { label: 'location', city: 'address/postalAddress/addressLocality', region: 'address/postalAddress/addressRegion',
        country: 'address/postalAddress/addressCountry', postalCode: 'address/postalAddress/postalCode' };
      add('', fields); many('/secondaryLocations', fields); break;
    }
    case 'LEVER': many('/categories/allLocations', {}); if (!locations.length) many('/categories/location', {}); break;
    case 'GREENHOUSE': many('/offices', { label: 'location' }); if (!locations.length) add('/location', { label: 'name' }); break;
    case 'EIGHTFOLD': many('/locations', {}); break;
    case 'DIGITALRECRUITERS': many('/locations', {}); if (!locations.length) add('/location', {}); break;
    case 'WORKDAY': {
      add('/detail/jobPostingInfo', { label: 'location', country: 'country/descriptor' });
      // Additional places do not inherit the primary country's value.
      many('/detail/jobPostingInfo/additionalLocations', {}); break;
    }
    case 'FLATCHR': {
      if (take('/vacancy/show_address') === false) return { status: 'WITHHELD_BY_SOURCE', value: null, evidence, issues: [] };
      add('/vacancy/address', { label: 'formatted_address', city: 'city', country: 'country', postalCode: 'postal_code', latitude: 'location_lat', longitude: 'location_lng' }); break;
    }
    case 'MAGNET': many('/localities', { label: 'city_label', city: 'city_label', region: 'region_label', country: 'country', postalCode: 'postal_code', coordinatePair: 'coordinates', pairOrder: 'LAT_LON' }); break;
    case 'TALENT_FUNNEL': add(object(at(raw, '/detail/positionProfile/location')) ? '/detail/positionProfile/location' : '/vacancy/location',
      { label: 'formattedAddress', city: 'city', country: 'country', postalCode: 'postCode', coordinatePair: 'geoLocation/coordinates', pairOrder: 'LON_LAT' }); break;
    case 'TALENT_RECRUITER':
      add('/position', { label: 'WorkPlace', city: 'PositionLocation/City', country: 'PositionLocation/Country', postalCode: 'PositionLocation/Zip', coordinatePair: 'WorkPlaceCoordinates', pairOrder: 'LAT_LON' });
      many('/position/PositionLocationMultiSelection', { label: 'Name', city: 'City', country: 'Country', postalCode: 'Zip' }); break;
    case 'ORACLE_HCM': {
      const fields: Fields = { label: 'LocationName', city: 'TownOrCity', region: 'Region2', country: 'Country', postalCode: 'PostalCode', latitude: 'Latitude', longitude: 'Longitude' };
      many('/detail/workLocation', fields); many('/detail/otherWorkLocations', fields);
      if (!locations.length) add('/detail', { label: 'PrimaryLocation', country: 'PrimaryLocationCountry' });
      many('/detail/secondaryLocations', { ...fields, label: 'LocationName', country: 'CountryCode' }); break;
    }
    case 'HARRI': many('/listing/locations', { ...named, label: 'formatted_address' }); break;
    case 'GEODIRECTORY': add('', { label: 'address', city: 'city', country: 'country', postalCode: 'zip', latitude: 'latitude', longitude: 'longitude' }); break;
    case 'JOBAFFINITY_WORDPRESS': add('/board/row/attrs', { latitude: 'data-latitude', longitude: 'data-longitude' }); break;
    default: return { status: 'UNINTERPRETED', value: null, evidence: [], issues: ['LOCATION_READER_NOT_QUALIFIED'] };
  }
  return { status: locations.length ? 'DECLARED' : withheld ? 'WITHHELD_BY_SOURCE' : issues.length ? 'UNINTERPRETED' : 'NOT_OBSERVED', value: locations.length ? locations : null, evidence, issues: [...new Set(issues)] };
}
