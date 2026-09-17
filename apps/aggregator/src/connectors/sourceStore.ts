import type { Prisma, PrismaClient, Source, SourceStatus } from '@prisma/client';
import { tierFor, sourceKeyFor, type CatalogSource } from './sourceCatalog.js';
import { requireSourceAccess } from './sourceAccess.js';
import { requireSourceValidation } from './sourceCertification.js';
import { requireSourceIdentity } from './sourceIdentity.js';
import { lockSourceWrites } from '../lib/writeLocks.js';

/**
 * The catalogue, read from the Source table (DEC-3) — the CSV is now only the
 * one-shot import seed, never a runtime dependency.
 *
 * Why a table: a CSV line has no lifecycle. Removing one left its offers
 * orphaned forever (the « Cartier +3 » incident, D27), promotion was a hand
 * edit with no guard, and per-source quality lived in a note string nobody
 * could query. The table carries status, the last run
 * and field-coverage rates as columns.
 */

/** Registry settings and their exact immutable revision consumed by ingestion. */
export type RuntimeSource = Pick<Source, 'key' | 'maison' | 'kind' | 'careersDomain' | 'tier' | 'status' | 'lastRunJobs'> & {
  config: Record<string, unknown>;
  revisionId: string;
};

/**
 * One row per ATS tenant. Two Maisons resolving to the same board must be
 * arbitrated BEFORE import (the shared-board rule from the gate), so the same
 * tenant can never be catalogued twice under two names.
 *
 * The locator is the config's primary endpoint, normalized: scheme and
 * trailing slash stripped, lowercased. Falls back to the careers domain, then
 * the maison slug (a warning case — a config with no endpoint is suspect).
 */
export function tenantKeyOf(kind: string, entryUrl: string, careersDomain?: string, maison?: string): string {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(entryUrl || '{}');
  } catch {
    config = { url: entryUrl };
  }
  if (kind === 'harri') {
    const portal = typeof config.portalUrl === 'string' ? new URL(config.portalUrl) : undefined;
    const slug = typeof config.slug === 'string' ? config.slug : portal?.pathname.split('/').filter(Boolean)[0];
    if (!slug || !/^[a-z0-9_-]+$/i.test(slug) || (portal && !['harri.com','www.harri.com'].includes(portal.hostname))) throw new Error('Harri tenant requires a native portal slug');
    if (portal && (portal.protocol !== 'https:' || portal.username || portal.password || portal.pathname.split('/').filter(Boolean)[0]?.toLowerCase() !== slug.toLowerCase())) throw new Error('Harri portal and slug must identify the same tenant');
    return `harri:${slug.toLowerCase()}`;
  }
  // Vendor account identifiers first — `slug`/`account`/`board`/`company`
  // NAME the tenant (wttj slug, workable account, greenhouse board, SR
  // company). Then the origin: two SuccessFactors rows differing only by a
  // redundant listingUrl still share careers.coty.com, and must collide —
  // that collision is the 17-duplicate catalogue debt this key caught.
  const locator = [
    config.slug, config.account, config.board, config.boardToken,
    config.company, config.customer, config.subdomain, config.tenant,
    // `site` (Lever), `domainName` (DigitalRecruiters), `siteKey` (Magnet):
    // leur absence écrasait toutes les sources Lever sur « jobs.lever.co »
    // et la contrainte tenant en refusait 17 bonnes (attrapé à la promotion).
    config.site, config.domainName, config.siteKey,
    // `domain` (Eightfold) : c'est le tenant, pas l'hôte. Mesuré le 2026-09-06 :
    // dr-jart-13 (origin careers.elcompanies.com) et estee-lauder-companies
    // (origin elcompanies.eightfold.ai) portent le même domain=elcompanies.com,
    // donc le MÊME feed de 1 441 offres — visité deux fois par run, 10 min
    // chacune. Sans `domain` ici, la clé tombait sur l'origin et les deux
    // passaient pour deux tenants.
    config.domain,
    config.origin, config.host,
    config.listingUrl, config.sitemapUrl, config.feedUrl, config.startUrl, config.url,
  ].find((v): v is string => typeof v === 'string' && v.length > 0);

  /**
   * Workday : le tenant SEUL n'identifie pas un feed — un même tenant sert
   * plusieurs sites, et chaque site est un board distinct avec ses propres
   * offres. Mesuré le 2026-09-04 : les trois boards Uniqlo
   * (headquarters_eu / store_staff_eu / graduates_eu du tenant `fastretailing`)
   * s'écrasaient sur `workday:fastretailing`, et les 107 offres boutiques + 11
   * offres graduate étaient rejetées comme doublons du siège (20 offres). Idem
   * chez Capri : Michael Kors (519) et Jimmy Choo (50) écartés au profit de
   * Versace (52).
   *
   * La clé existe pour empêcher de re-télécharger LE MÊME feed (D26/D28) — pas
   * pour fusionner des feeds différents. Le couple tenant+site est ce qui
   * désigne réellement un feed Workday.
   */
  const workdayPair =
    typeof config.tenant === 'string' && typeof config.site === 'string' && config.tenant && config.site
      ? `${config.tenant}/${config.site}`
      : undefined;

  const raw =
    workdayPair ?? locator ?? careersDomain ?? (maison ? sourceKeyFor({ maison } as CatalogSource) : '');
  const normalized = raw
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  return `${kind}:${normalized}`;
}

/**
 * Every ACTIVE source — what the ingest runs.
 *
 * REFUSES to answer on an empty catalogue: an unseeded environment silently
 * ingesting zero sources is exactly the quiet-zero failure mode this whole
 * chantier exists to kill. Le registre se restaure par `reimporter-registre-sources.mts`.
 */
export async function loadActiveSources(prisma: PrismaClient): Promise<RuntimeSource[]> {
  return prisma.$transaction(async tx => {
    if (await tx.source.count() === 0) throw new Error(
      'Source table is empty — le registre n’a pas été réimporté. Lancer : npx tsx scripts/ops/reimporter-registre-sources.mts <registre.json> --ecrire');
    // JSONB text avoids the driver's lossy JSON-number conversion and keeps
    // the loaded settings and revision in one coherent database snapshot.
    const rows = await tx.$queryRaw<(Omit<RuntimeSource, 'config'> & { configText: string })[]>`
      SELECT key, maison, kind, "careersDomain", tier, status, "lastRunJobs", "currentRevisionId" AS "revisionId",
        config::text AS "configText" FROM "Source" WHERE status='ACTIVE' ORDER BY key`;
    return rows.map(({ configText, ...row }) => ({ ...row, config: JSON.parse(configText) as Record<string, unknown> }));
  }, { isolationLevel: 'RepeatableRead' });
}

/**
 * ⚠️ `importSourcesCsv` A ÉTÉ SUPPRIMÉE LE 2026-09-17 — ne pas la recréer.
 *
 * Elle réensemençait la table depuis `data/seeds/sources.csv`. Mesuré avant suppression : ce CSV
 * portait 83 lignes quand la table en portait 536, sans statut, sans révision, avec des
 * configurations périmées. Sur une base vide il aurait recréé 83 sources en DRAFT sans rapport
 * avec le registre réel, en conflit de `tenantKey` avec les vraies.
 *
 * Le réensemencement passe par l'export du registre lui-même — `exporter-registre-sources.mts`
 * puis `reimporter-registre-sources.mts` (voir `scripts/ops/`). Il restaure les 536 sources avec
 * leur `config`, leur révision courante et leur statut réel, sans en inventer aucun.
 */

export type PromoteResult = {
  key: string;
  from: SourceStatus;
  to: 'ACTIVE';
};

/** Promotion consumes current independent native, identity and access decisions. */
export class SourcePromotionGateError extends Error {
  constructor(readonly code: 'SOURCE_MISSING' | 'REVISION_MISMATCH' | 'RETIRED' | 'CONFIG_EMPTY' | 'CONCURRENT_CHANGE', message: string) {
    super(message); this.name = 'SourcePromotionGateError';
  }
}

export async function promoteSource(prisma: PrismaClient, key: string, expectedRevisionId: string): Promise<PromoteResult> {
  return prisma.$transaction(async tx => {
    await lockSourceWrites(tx, key, true);
    // A direct configuration update must also wait; advisory lifecycle locks
    // alone cannot serialize every SQL writer of this registry row.
    const [stored] = await tx.$queryRaw<(Source & { configText: string })[]>`
      SELECT *, config::text AS "configText" FROM "Source" WHERE key=${key} FOR UPDATE`;
    const row = stored ? { ...stored, config: JSON.parse(stored.configText) } : undefined;
    if (!row) throw new SourcePromotionGateError('SOURCE_MISSING', `promote: no source with key "${key}"`);
    if (!expectedRevisionId || row.currentRevisionId !== expectedRevisionId) {
      throw new SourcePromotionGateError('REVISION_MISMATCH', 'Promotion requires the exact reviewed source revision');
    }
    if (row.status === 'RETIRED') {
      throw new SourcePromotionGateError('RETIRED', `promote: "${key}" is RETIRED; reopening requires a separate reviewed registry transition`);
    }
    const config = row.config as Record<string, unknown> | null;
    if (!config || Object.keys(config).length === 0) {
      throw new SourcePromotionGateError('CONFIG_EMPTY', `promote: "${key}" has no adapter config`);
    }
    const from = row.status;
    await requireSourceIdentity(tx, row);
    await requireSourceValidation(tx, row.currentRevisionId);
    await requireSourceAccess(tx, row);
    if (from === 'ACTIVE') return { key, from, to: 'ACTIVE' };
    const changed = await tx.source.updateMany({ where: { key, currentRevisionId: row.currentRevisionId, status: from }, data: { status: 'ACTIVE' } });
    if (changed.count !== 1) throw new SourcePromotionGateError('CONCURRENT_CHANGE', 'promote: source changed while its identity was checked');
    return { key, from, to: 'ACTIVE' };
  });
}

/**
 * Denormalized last-run summary + coverage rates, written by the health pass
 * after every run so the catalogue answers "how is this source doing" in one
 * query. Missing row is fine: registry-only sources (hand-written flow B)
 * predate the table.
 */
export async function recordSourceRunSummary(
  prisma: PrismaClient,
  key: string,
  summary: {
    status: string;
    jobs: number;
    descriptionRate?: number;
    dateRate?: number;
    countryRate?: number;
    urlRate?: number;
  },
): Promise<void> {
  await prisma.source.updateMany({
    where: { key },
    data: {
      lastRunAt: new Date(),
      lastRunStatus: summary.status,
      lastRunJobs: summary.jobs,
      descriptionRate: summary.descriptionRate ?? null,
      dateRate: summary.dateRate ?? null,
      countryRate: summary.countryRate ?? null,
      urlRate: summary.urlRate ?? null,
    },
  });
}
