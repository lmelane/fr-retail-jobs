import { createHash } from 'node:crypto';
import { captureObservedAt } from '../../capture/context.js';
import { fetchJson } from '../../lib/http.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Rituals — portail maison `careers.rituals.com`, un Elasticsearch derrière
 * `POST /api/v1/jobs/`. Body et pagination capturés au réseau puis rejoués
 * le 2026-09-06.
 *
 * Trois pièges mesurés :
 *
 * 1. La pagination est CUMULATIVE : `page: N` ne rend pas la N-ième page de
 *    20 mais les N × 20 PREMIERS résultats (page 1 → 20 hits, page 2 → 40,
 *    page 3 → 60, tous en partant du premier). Ni `size` ni `pageSize` ne
 *    sont honorés (toujours 20). Lire page par page et concaténer produirait
 *    donc des doublons massifs ; on lit la page 1 pour le total, puis UNE
 *    page dimensionnée `ceil(total / 20)` (fr-FR : page 13 → 252/252).
 *
 * 2. Un index PAR LOCALE, et chaque locale porte un PAYS : fr-FR → 252 offres
 *    toutes FR, de-DE → 269 DE, nl-NL → 129 NL, es-ES → 66, it-IT → 41,
 *    en-GB → 34. Lire une seule locale, c'est lire un seul pays. Les locales
 *    sont listées dans `config.languages` ; par défaut fr-FR.
 *
 * 3. L'URL publique est `/{locale}/jobs/{slug}/{jobAdId}/`. Le serveur ignore
 *    le slug (mesuré : `/fr-FR/jobs/x/<id>/` → 200 avec le vrai titre) ; on en
 *    génère un lisible depuis le titre, sans prétendre reproduire celui du
 *    sitemap (« & » y devient « et » en français).
 */

const DEFAULT_ORIGIN = 'https://careers.rituals.com';
const DEFAULT_LANGUAGES = ['fr-FR'];
/** Taille de page fixe du serveur, mesurée — aucun paramètre ne la change. */
const SERVER_PAGE_SIZE = 20;
/** Garde contre une pagination qui ne converge plus (forme de réponse changée). */
const MAX_PAGES = 100;

type RitualsSource = {
  title?: string;
  jobAdId?: string;
  jobId?: string;
  refNumber?: string;
  language?: string;
  releasedDate?: number;
  createdDate?: number;
  city?: string;
  postalCode?: string;
  country?: string;
  locationName?: string;
  lonLat?: { lat?: number; lon?: number };
  contractType?: { id?: string; label?: string };
  function?: string;
  jobDescriptionPlain?: string;
  qualificationsPlain?: string;
  additionalInformationPlain?: string;
  languageData?: { code?: string };
};

type RitualsResponse = {
  hits?: { total?: { value?: number }; hits?: Array<{ _id?: string; _source?: RitualsSource }> };
};

function searchBody(language: string, page: number): string {
  // Le body exact envoyé par la page ; les filtres vides = « tout ».
  return JSON.stringify({
    role: [],
    department: [],
    locationType: 'all',
    isInternal: false,
    typeOfShop: [],
    lat: 0,
    lon: 0,
    locationName: [],
    distanceInKm: '',
    textQuery: '',
    careerLevel: [],
    grade: [],
    jobFamily: [],
    language,
    page,
  });
}

export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Un hit Elasticsearch → NormalizedJob. Exporté pour être testé sans réseau. */
export function parseRitualsHit(
  source: RitualsSource,
  origin = DEFAULT_ORIGIN,
  language = DEFAULT_LANGUAGES[0],
): NormalizedJob | null {
  const id = source.jobAdId;
  if (!id || !source.title) return null;

  const description = [source.jobDescriptionPlain, source.qualificationsPlain, source.additionalInformationPlain]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n\n');

  const locale = source.language ?? language;
  const released = source.releasedDate ?? source.createdDate;

  return {
    externalId: id,
    title: source.title.replace(/\s+/g, ' ').trim(),
    location: [source.city, source.country].filter(Boolean).join(', ') || undefined,
    city: source.city,
    postalCode: source.postalCode,
    country: source.country,
    latitude: source.lonLat?.lat,
    longitude: source.lonLat?.lon,
    contract: source.contractType?.label ?? source.contractType?.id,
    department: source.function,
    language: source.languageData?.code,
    description: description || undefined,
    url: `${origin}/${locale}/jobs/${slugify(source.title) || 'job'}/${id}/`,
    // Epoch MILLISECONDES (mesuré : 1788533113973), pas secondes comme LVMH.
    postedAt: typeof released === 'number' ? new Date(released) : undefined,
    raw: source,
  };
}

async function readLocale(origin: string, language: string): Promise<{ sources: RitualsSource[]; total?: number; endpoint: string; payload: unknown }> {
  const endpoint = `${origin}/api/v1/jobs/`;
  const request = (page: number) =>
    fetchJson<RitualsResponse>(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: searchBody(language, page),
    });

  const first = await request(1);
  const total = first.hits?.total?.value;
  let hits = first.hits?.hits ?? [];
  // La réponse RETENUE est celle dont les hits sont scellés dans la preuve : son empreinte doit porter sur ce
  // qui a été réellement lu, pas sur la première page quand une seconde l'a remplacée.
  let payload: unknown = first;

  // Une seule requête dimensionnée au total : la pagination cumulative rend
  // tout d'un coup, et une lecture page à page ne ferait que répéter le début.
  if (total !== undefined && hits.length < total) {
    let page = Math.ceil(total / SERVER_PAGE_SIZE);
    for (let guard = 0; guard < MAX_PAGES; guard += 1) {
      const response = await request(page);
      const batch = response.hits?.hits ?? [];
      if (batch.length <= hits.length) break; // plus de croissance : on s'arrête
      hits = batch;
      payload = response;
      if (hits.length >= total) break;
      page += 1;
    }
  }

  return { sources: hits.map((hit) => hit._source).filter((s): s is RitualsSource => Boolean(s)), total, endpoint, payload };
}

export async function fetchRitualsJobs(config: Record<string, unknown> = {}): Promise<AdapterResult> {
  const origin = String(config.origin ?? DEFAULT_ORIGIN).replace(/\/$/, '');
  const languages = Array.isArray(config.languages)
    ? config.languages.map(String)
    : config.language
      ? [String(config.language)]
      : DEFAULT_LANGUAGES;

  const jobs: NormalizedJob[] = [];
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const seen = new Set<string>();
  const scopes: NonNullable<NonNullable<AdapterResult['enumeration']>['scopes']> = [];
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  /** Un hit qu'aucun `jobAdId` ne nomme : compté, jamais inventé — il interdit de déclarer une absence. */
  let anonymousRows = 0;
  let representations = 0;
  let truncated = false;

  for (const language of languages) {
    const { sources, total, endpoint, payload } = await readLocale(origin, language);
    if (total !== undefined) representations += total;
    const localeComplete = total !== undefined && sources.length >= total;
    if (!localeComplete) truncated = true;
    const before = seen.size;
    /**
     * LE CONTRAT DES IDENTIFIANTS CANONIQUES, une page de preuve par locale.
     *
     * `jobAdId` est l'identifiant NATIF servi par l'index, et `parseRitualsHit` le publie tel quel comme
     * `externalId` : les deux ensembles sont comparables à la base. Chaque locale sert le MÊME catalogue dans
     * sa langue, donc un même identifiant est légitimement observé dans plusieurs pages — il n'est écrit
     * qu'une fois, et reste couvert par la première locale qui l'a publié.
     */
    const localeCanonicalIds: string[] = [];
    for (const source of sources) {
      const canonicalId = typeof source.jobAdId === 'string' && source.jobAdId.trim() ? source.jobAdId : null;
      if (canonicalId) localeCanonicalIds.push(canonicalId); else anonymousRows++;
      const job = parseRitualsHit(source, origin, language);
      // Un hit vu puis écarté faute de titre porte sa cause et son identifiant : sans cette disposition, son
      // identifiant observé resterait orphelin dans la preuve et le contrat tomberait.
      if (!job) { rejectedRows.push({ reason: `MISSING_JOB_AD_ID_OR_TITLE:${language}`, raw: source, ...(canonicalId ? { canonicalId } : {}) }); continue; }
      if (seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
    }
    pageEvidence.push({ url: endpoint, checkedAt: captureObservedAt().toISOString(),
      sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      offset: 0, pagination: null, ids: localeCanonicalIds, canonicalIds: localeCanonicalIds,
      publisherCounter: total === undefined ? '' : `total=${total}`,
      componentCounters: [`locale=${language}`, `hits=${sources.length}`, `anonymous=${anonymousRows}`] });
    scopes.push({ scope: `locale:${language}`, declaredTotal: total ?? -1, uniqueIds: seen.size - before, pages: 1, complete: localeComplete });
  }
  /**
   * Chaque locale sert le MÊME catalogue dans sa langue : les 1 250 « hits »
   * déclarés en 2026-09-09 (fr 252 + …) sont 1 122 postes uniques, un même
   * `_id` revenant dans plusieurs locales. Le total déclaré est donc un total de
   * REPRÉSENTATIONS ; le nombre d'offres est l'union. Les deux sont énoncés,
   * aucun n'est ajusté : `declaredTotal` porte l'union quand chaque locale a été
   * lue en entier (elle est alors prouvée), la somme sinon.
   */
  const complete = !truncated && scopes.every((s) => s.complete);
  return { jobs, declaredTotal: complete ? seen.size : representations, truncated, complete, rejectedRows,
    enumeration: { method: 'ELASTIC_TOTAL_PER_LOCALE_UNION', endpoint: `${origin}`, pages: scopes.length, rawCount: representations, termination: complete ? 'ALL_LOCALES_COMPLETE' : 'LOCALE_INCOMPLETE', issues: complete ? [] : ['ENUMERATION_NOT_PROVEN'],
      // Un hit sans `jobAdId` ne peut pas être nommé : aucun identifiant historique ne peut alors être déclaré absent.
      canonicalAbsenceProofUsable: anonymousRows === 0, pageEvidence,
      scopes: [...scopes, { scope: 'union', declaredTotal: representations, uniqueIds: seen.size, pages: scopes.length, complete }] } };
}
