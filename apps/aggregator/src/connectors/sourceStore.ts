import type { Prisma, PrismaClient, Source, SourceStatus } from '@prisma/client';
import { loadSourceCatalog, tierFor, sourceKeyFor, type CatalogSource } from './sourceCatalog.js';

/**
 * The catalogue, read from the Source table (DEC-3) — the CSV is now only the
 * one-shot import seed, never a runtime dependency.
 *
 * Why a table: a CSV line has no lifecycle. Removing one left its offers
 * orphaned forever (the « Cartier +3 » incident, D27), promotion was a hand
 * edit with no guard, and per-source quality lived in a note string nobody
 * could query. The table carries status, a dated robots verdict, the last run
 * and field-coverage rates as columns.
 */

/** The shape the ingest pipeline consumes — CatalogSource plus its identity. */
export type RuntimeSource = CatalogSource & {
  key: string;
  tier: string;
  status: SourceStatus;
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
  // Vendor account identifiers first — `slug`/`account`/`board`/`company`
  // NAME the tenant (wttj slug, workable account, greenhouse board, SR
  // company). Then the origin: two SuccessFactors rows differing only by a
  // redundant listingUrl still share careers.coty.com, and must collide —
  // that collision is the 17-duplicate catalogue debt this key caught.
  const locator = [
    config.slug, config.account, config.board, config.boardToken,
    config.company, config.subdomain, config.tenant,
    // `site` (Lever), `domainName` (DigitalRecruiters), `siteKey` (Magnet):
    // leur absence écrasait toutes les sources Lever sur « jobs.lever.co »
    // et la contrainte tenant en refusait 17 bonnes (attrapé à la promotion).
    config.site, config.domainName, config.siteKey,
    config.origin, config.host,
    config.listingUrl, config.sitemapUrl, config.feedUrl, config.startUrl, config.url,
  ].find((v): v is string => typeof v === 'string' && v.length > 0);

  const raw = locator ?? careersDomain ?? (maison ? sourceKeyFor({ maison } as CatalogSource) : '');
  const normalized = raw
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  return `${kind}:${normalized}`;
}

/** Source row -> the CatalogSource shape every consumer already reads. */
function toRuntime(row: Source): RuntimeSource {
  const config = row.config as Record<string, unknown>;
  // Symmetric with the import: `{url}` rows were plain-URL CSV lines (sitemap
  // sources read entryUrl directly as a URL); everything else is JSON config.
  const keys = Object.keys(config ?? {});
  const entryUrl =
    keys.length === 1 && keys[0] === 'url' && typeof config.url === 'string'
      ? config.url
      : JSON.stringify(config ?? {});
  return {
    maison: row.maison,
    careersDomain: row.careersDomain ?? '',
    kind: row.kind,
    entryUrl,
    jobUrlPattern: row.jobUrlPattern ?? '',
    robotsVerdict: row.robotsVerdict ?? '',
    jobCount: row.verifiedJobCount ?? 0,
    key: row.key,
    tier: row.tier,
    status: row.status,
  };
}

/**
 * Every ACTIVE source — what the ingest runs.
 *
 * REFUSES to answer on an empty catalogue: an unseeded environment silently
 * ingesting zero sources is exactly the quiet-zero failure mode this whole
 * chantier exists to kill. The fix is one command: `import-sources`.
 */
export async function loadActiveSources(prisma: PrismaClient): Promise<RuntimeSource[]> {
  const total = await prisma.source.count();
  if (total === 0) {
    throw new Error(
      'Source table is empty — the catalogue has not been imported. Run: npm run import-sources -w @catwalks/aggregator',
    );
  }
  const rows = await prisma.source.findMany({ where: { status: 'ACTIVE' }, orderBy: { key: 'asc' } });
  return rows.map(toRuntime);
}

export type ImportStats = {
  imported: number;
  updated: number;
  skippedDuplicateTenant: string[];
};

/**
 * One-shot import of data/sources.csv into the Source table.
 *
 * Idempotent by key: re-running updates config/verdict/count, never duplicates.
 * The 101 verified rows arrive ACTIVE — they ARE the production rotation; new
 * discoveries enter as DRAFT via the promotion path, not through here.
 * A second maison mapping to an already-imported tenant is REFUSED and
 * reported, not silently merged: that conflict is a human arbitration.
 */
export async function importSourcesCsv(prisma: PrismaClient): Promise<ImportStats> {
  const stats: ImportStats = { imported: 0, updated: 0, skippedDuplicateTenant: [] };

  for (const source of loadSourceCatalog()) {
    const key = sourceKeyFor(source);
    const tenantKey = tenantKeyOf(source.kind, source.entryUrl, source.careersDomain, source.maison);
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(source.entryUrl || '{}');
    } catch {
      config = { url: source.entryUrl };
    }

    // A different key already holding this tenant means two catalogue lines
    // point at one board — the exact duplication the unique constraint exists
    // to stop. Surface it; a human decides which line survives.
    const holder = await prisma.source.findUnique({ where: { tenantKey } });
    if (holder && holder.key !== key) {
      stats.skippedDuplicateTenant.push(`${key} -> tenant already held by ${holder.key}`);
      continue;
    }

    const data = {
      maison: source.maison,
      careersDomain: source.careersDomain || null,
      kind: source.kind,
      config: config as Prisma.InputJsonValue,
      jobUrlPattern: source.jobUrlPattern || null,
      tier: tierFor(source),
      tenantKey,
      robotsVerdict: source.robotsVerdict || null,
      // The CSV's verdicts were all read live during the 2026-09 validation.
      robotsCheckedAt: new Date('2026-09-02'),
      verifiedJobCount: source.jobCount || null,
    };
    const existing = await prisma.source.findUnique({ where: { key } });
    if (existing) {
      await prisma.source.update({ where: { key }, data });
      stats.updated++;
    } else {
      await prisma.source.create({ data: { ...data, key, status: 'ACTIVE' } });
      stats.imported++;
    }
  }

  return stats;
}

export type PromoteResult = {
  key: string;
  from: SourceStatus;
  to: 'ACTIVE';
};

/**
 * DRAFT/VALIDATED/PAUSED -> ACTIVE, with the guards a hand-edited CSV never
 * had (règles permanentes du plan) : a promoted source must have a config, a
 * DATED robots verdict, and at least one really-parsed offer behind its count.
 */
export async function promoteSource(prisma: PrismaClient, key: string): Promise<PromoteResult> {
  const row = await prisma.source.findUnique({ where: { key } });
  if (!row) throw new Error(`promote: no source with key "${key}"`);
  if (row.status === 'ACTIVE') throw new Error(`promote: "${key}" is already ACTIVE`);
  if (row.status === 'RETIRED') {
    throw new Error(`promote: "${key}" is RETIRED — re-validate it as a new source instead`);
  }
  const config = row.config as Record<string, unknown> | null;
  if (!config || Object.keys(config).length === 0) {
    throw new Error(`promote: "${key}" has no adapter config`);
  }
  if (!row.robotsVerdict || !row.robotsCheckedAt) {
    throw new Error(`promote: "${key}" has no dated robots verdict — read robots.txt at the source first`);
  }
  if (!row.verifiedJobCount || row.verifiedJobCount < 1) {
    throw new Error(`promote: "${key}" has no proven offer (verifiedJobCount) — run the volume validation first`);
  }

  const from = row.status;
  await prisma.source.update({ where: { key }, data: { status: 'ACTIVE' } });
  return { key, from, to: 'ACTIVE' };
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
