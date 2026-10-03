import pLimit from 'p-limit';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { APP_ID, INDEX, fetchWttjJobs, wttjSearch } from './wttj.js';

/**
 * Welcome to the Jungle — tout un SECTEUR, pas une société.
 *
 * L'index Algolia public de WTTJ (le même que `wttj.ts`) porte, sur chaque
 * offre, les secteurs de l'organisation : `sectors.reference` (« luxury-1 »,
 * « fashion-1 », « cosmetics », « jewelry-1 »…) et leur parent
 * `sectors.parent_reference` (« fashion-luxury-beauty-lifestyle »). Ces
 * facettes sont posées par WTTJ à l'organisation, pas déduites du titre : une
 * Data Analyst chez Hermès y est autant que le polisseur.
 *
 * Deux limites de l'index, mesurées le 2026-09-06, dictent la forme :
 *  - une requête ne rend jamais plus de 1 000 hits (`paginationLimitedTo`) —
 *    la page 10 sur le seul filtre parent répond « you can only fetch the
 *    1000 hits » (2 357 offres derrière) ;
 *  - une facette ne rend jamais plus de 1 000 valeurs.
 * Donc on ne pagine pas le secteur : on LISTE ses organisations par facette
 * (156 sous le parent mode/luxe/beauté, la plus grosse à 609), puis on lit
 * chaque organisation exactement comme `fetchWttjJobs` — même externalId
 * (`reference`), même URL, même `company` — pour que l'écriture dédoublonne
 * avec les sources `wttj` déjà cataloguées au lieu de les doubler.
 *
 * Config :
 *  - `sectors`        : valeurs de `sectors.reference` à couvrir (défaut :
 *                       les cinq du cœur de périmètre) ;
 *  - `parentSectors`  : valeurs de `sectors.parent_reference` (défaut : aucune —
 *                       le parent « …-lifestyle » embarque hôtels et traiteurs) ;
 *  - `organizations`  : slugs ajoutés d'office (une Maison classée ailleurs par
 *                       WTTJ : Charlotte Tilbury est en « software ») ;
 *  - `excludeOrganizations` : slugs écartés ;
 *  - `withDescriptions`, `detailConcurrency` : comme `wttj.ts`.
 * Une organisation entre si elle porte AU MOINS UN des secteurs demandés.
 */

export const DEFAULT_SECTORS = ['luxury-1', 'fashion-1', 'cosmetics', 'jewelry-1', 'mode'] as const;

/** Plafond Algolia sur le nombre de valeurs d'une facette. */
const FACET_CAP = 1000;
/** Organisations lues de front ; la porte par hôte garde la politesse réelle. */
const DEFAULT_ORGANIZATION_CONCURRENCY = 2;

type FacetResponse = {
  nbHits?: number;
  /** `false` quand Algolia a compté les facettes sur un échantillon : la liste des valeurs n'est alors pas démontrée. */
  exhaustiveFacetsCount?: boolean;
  exhaustive?: { facetsCount?: boolean };
  facets?: Record<string, Record<string, number>>;
  message?: string;
  status?: number;
};

function stringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list.map((v) => String(v).trim()).filter(Boolean);
}

/** `attr:"a" OR attr:"b"` — cité, sinon Algolia rend 0 en silence sur un tiret. */
function anyOf(attribute: string, values: readonly string[]): string {
  return values.map((v) => `${attribute}:"${v}"`).join(' OR ');
}

async function organizationFacet(filters: string): Promise<FacetResponse> {
  return wttjSearch<FacetResponse>({
    query: '',
    filters,
    hitsPerPage: 0,
    facets: ['organization.slug', 'offices.country_code'],
    maxValuesPerFacet: FACET_CAP,
  });
}

/**
 * Les slugs d'organisation qui répondent au filtre.
 *
 * Sous le plafond de 1 000 valeurs, une seule requête. Au-dessus — ce n'est
 * pas le cas aujourd'hui (156), mais un plafond atteint en silence rendrait
 * exactement les 1 000 premières et perdrait le reste sans signal — on
 * redécoupe par pays et on fait l'union.
 */
export async function listOrganizations(filters: string): Promise<Set<string>> {
  return (await readOrganizations(filters)).slugs;
}

/**
 * La liste des organisations ET sa preuve (D-522 §6). Elle n'est démontrée que lue d'une seule requête, sous le plafond
 * de valeurs, sur un compte de facettes exact : c'est alors l'ensemble des organisations qu'Algolia associe au filtre.
 * Redécoupée par pays, une offre sans pays de bureau échapperait à toutes les parts : liste lue, pas démontrée.
 */
export async function readOrganizations(filters: string): Promise<{ slugs: Set<string>; proven: boolean; issue?: string }> {
  const whole = await organizationFacet(filters);
  const slugs = Object.keys(whole.facets?.['organization.slug'] ?? {});
  if (slugs.length < FACET_CAP) {
    const exact = whole.exhaustiveFacetsCount === true || whole.exhaustive?.facetsCount === true;
    return { slugs: new Set(slugs), proven: exact, ...(exact ? {} : { issue: 'ORGANIZATION_LIST_UNPROVEN' }) };
  }

  const union = new Set<string>();
  for (const country of Object.keys(whole.facets?.['offices.country_code'] ?? {})) {
    const part = await organizationFacet(`(${filters}) AND offices.country_code:"${country}"`);
    const partial = Object.keys(part.facets?.['organization.slug'] ?? {});
    if (partial.length >= FACET_CAP) {
      throw new Error(
        `WTTJ sector sweep: ${partial.length} organisations in ${country} for "${filters}" — ` +
          'the facet cap is reached even per country; narrow `sectors` rather than losing the tail.',
      );
    }
    for (const slug of partial) union.add(slug);
  }
  return { slugs: union, proven: false, issue: 'ORGANIZATION_LIST_UNPROVEN' };
}

/**
 * Toutes les offres WTTJ des organisations d'un secteur.
 *
 * `declaredTotal` est la somme de ce que l'index annonce par organisation, et
 * `truncated` dit si une organisation a rendu moins que son annonce. Une
 * organisation injoignable fait échouer la source (pas de silence : un
 * secteur à moitié lu se lirait « ces Maisons ne recrutent plus »).
 */
export async function fetchWttjSectorJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const sectors = stringList(config.sectors) ?? [...DEFAULT_SECTORS];
  const parentSectors = stringList(config.parentSectors) ?? [];
  const extra = stringList(config.organizations) ?? [];
  const excluded = new Set(stringList(config.excludeOrganizations) ?? []);

  const clauses = [
    sectors.length ? anyOf('sectors.reference', sectors) : '',
    parentSectors.length ? anyOf('sectors.parent_reference', parentSectors) : '',
  ].filter(Boolean);
  if (!clauses.length && !extra.length) {
    throw new Error('WTTJ sector sweep: no `sectors`, `parentSectors` or `organizations` configured');
  }

  const listing = clauses.length ? await readOrganizations(clauses.join(' OR ')) : { slugs: new Set<string>(), proven: true };
  const found = listing.slugs;
  if (clauses.length && found.size === 0) {
    // Une facette renommée côté WTTJ rendrait zéro sans erreur : on refuse de
    // l'enregistrer comme « secteur vide ».
    throw new Error(`WTTJ sector sweep: no organisation matches "${clauses.join(' OR ')}" — facet values renamed?`);
  }
  for (const slug of extra) found.add(slug);
  const organizations = [...found].filter((slug) => !excluded.has(slug)).sort();

  const limit = pLimit(Number(config.organizationConcurrency ?? DEFAULT_ORGANIZATION_CONCURRENCY));
  const perOrganization = await Promise.all(
    organizations.map((slug) =>
      limit(() =>
        fetchWttjJobs({
          slug,
          withDescriptions: config.withDescriptions,
          detailConcurrency: config.detailConcurrency,
        }),
      ),
    ),
  );

  const seen = new Set<string>();
  const jobs: NormalizedJob[] = [];
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  let declaredTotal = 0;
  let truncated = false;
  let pages = 0, rawCount = 0, absenceProofUsable = true;
  for (const result of perOrganization) {
    declaredTotal += result.declaredTotal ?? result.jobs.length;
    if (result.declaredTotal !== undefined && result.jobs.length < result.declaredTotal) truncated = true;
    /**
     * LE CONTRAT DES IDENTIFIANTS CANONIQUES, HÉRITÉ DE `fetchWttjJobs`.
     *
     * Le balayage sectoriel ne lit rien lui-même : il lit chaque organisation par l'adaptateur `wttj`, avec le
     * même `externalId` (`reference`, sinon `slug`). Ses preuves sont donc CELLES de ces lectures, reprises
     * telles quelles — les recopier serait fabriquer une preuve que ce module n'a pas produite. Une seule
     * organisation sans preuve rendrait le contrat PARTIEL pour tout le secteur, et le normaliseur le
     * refuserait : le contrat tient ici parce qu'il tient à chaque lecture.
     */
    pageEvidence.push(...(result.enumeration?.pageEvidence ?? []));
    rejectedRows.push(...(result.rejectedRows ?? []));
    pages += result.enumeration?.pages ?? 0;
    rawCount += result.enumeration?.rawCount ?? 0;
    // Une organisation dont un hit est anonyme retire le droit d'attester pour le SECTEUR entier.
    if (result.enumeration?.canonicalAbsenceProofUsable === false) absenceProofUsable = false;
    for (const job of result.jobs) {
      // Une organisation n'est lue qu'une fois ; la garde protège d'un slug
      // passé deux fois par la config (`organizations` + facette).
      if (seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
    }
  }
  /**
   * D-522 §6 : le secteur est prouvé quand la liste de ses organisations l'est (`readOrganizations`) et que CHAQUE
   * organisation a prouvé sa propre liste (`fetchWttjJobs`, `listProof`). Une seule qui manque : énumération INCONNUE,
   * comme avant. 2 144 offres lues sur 2 144 au RUN du 02/10 restaient sans attestation d'absence.
   */
  const unproven = organizations.filter((_, i) => perOrganization[i]!.complete !== true);
  const issues = [...(listing.issue ? [listing.issue] : []), ...(unproven.length ? [`ORGANIZATIONS_UNPROVEN=${unproven.length}:${unproven.slice(0, 5).join(',')}`] : [])];
  const complete = !truncated && listing.proven && unproven.length === 0;
  return { jobs, declaredTotal, truncated, rejectedRows, ...(complete ? { complete: true } : {}),
    enumeration: { method: 'FACETED_ORGANIZATION_SWEEP_OF_ALGOLIA_INDEX',
      endpoint: `https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`, issues, enumerationTraversalComplete: complete,
      // `ORGANIZATIONS_RECONCILED` n'est PAS une terminaison probante pour le refresh (`refreshPlan.ts`,
      // `DECLARED_BUT_NOT_PROVING`) : la promouvoir est une lecture à écrire, pas un effet de bord de ce lecteur.
      pages, rawCount, termination: truncated ? 'ORGANIZATION_SHORT_OF_DECLARED_TOTAL' : complete ? 'ORGANIZATIONS_RECONCILED' : 'EVERY_ORGANIZATION_READ',
      canonicalAbsenceProofUsable: absenceProofUsable,
      scopes: organizations.map((slug, i) => ({ scope: slug,
        declaredTotal: perOrganization[i].declaredTotal ?? -1,
        uniqueIds: perOrganization[i].jobs.length,
        pages: perOrganization[i].enumeration?.pages ?? 0,
        complete: perOrganization[i].complete === true })),
      pageEvidence } };
}
