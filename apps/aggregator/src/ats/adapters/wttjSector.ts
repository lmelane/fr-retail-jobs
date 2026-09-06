import pLimit from 'p-limit';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { fetchWttjJobs, wttjSearch } from './wttj.js';

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
  const whole = await organizationFacet(filters);
  const slugs = Object.keys(whole.facets?.['organization.slug'] ?? {});
  if (slugs.length < FACET_CAP) return new Set(slugs);

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
  return union;
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

  const found = clauses.length ? await listOrganizations(clauses.join(' OR ')) : new Set<string>();
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
  let declaredTotal = 0;
  let truncated = false;
  for (const result of perOrganization) {
    declaredTotal += result.declaredTotal ?? result.jobs.length;
    if (result.declaredTotal !== undefined && result.jobs.length < result.declaredTotal) truncated = true;
    for (const job of result.jobs) {
      // Une organisation n'est lue qu'une fois ; la garde protège d'un slug
      // passé deux fois par la config (`organizations` + facette).
      if (seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
    }
  }
  return { jobs, declaredTotal, truncated };
}
