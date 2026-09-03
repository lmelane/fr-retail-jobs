import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Prisma, PrismaClient } from '@prisma/client';
import { fetchText } from '../lib/http.js';
import { loadRows, type Row } from './validateDiscovered.js';
import { tenantKeyOf, promoteSource } from '../connectors/sourceStore.js';
import { sourceKeyFor, tierFor, type CatalogSource } from '../connectors/sourceCatalog.js';

/**
 * Promotion outillée (C-02, DEC-3) : un rapport de validation-volume + le
 * catalogue gated -> des lignes `Source` ACTIVE, une par source PROUVÉE.
 *
 * La barre est celle du plan, pas une déclaration : ≥ 1 offre réellement
 * parsée AVEC un lieu (titre + URL + lieu), un verdict robots lu À LA SOURCE
 * et daté, et l'unicité par tenant. Tout ce qui ne passe pas reste dehors —
 * l'objectif n'est pas 0 refus, c'est 0 source pourrie dans la rotation.
 */

type ReportRow = {
  maison: string;
  kind: string;
  jobs: number;
  withLocation: number;
  error: string;
};

function loadReport(path: string): ReportRow[] {
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  const header = lines[0].split('\t');
  const idx = (name: string) => header.indexOf(name);
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return {
      maison: cells[idx('maison')],
      kind: cells[idx('kind')],
      jobs: Number(cells[idx('jobs')]) || 0,
      withLocation: Number(cells[idx('with_location')]) || 0,
      error: cells[idx('error')] ?? '',
    };
  });
}

/**
 * Verdict robots minimal, lu à la source et daté. Le vrai parseur (Crawl-delay,
 * groupes d'agents, chemins) arrive avec R-01 ; ici on refuse au moins le cas
 * net : `User-agent: *` + `Disallow: /`. Un robots.txt injoignable vaut
 * ALLOWED-BY-DEFAULT (convention robots), noté tel quel.
 */
async function robotsVerdictFor(domainOrUrl: string): Promise<string> {
  const host = domainOrUrl.replace(/^https?:\/\//, '').split('/')[0];
  if (!host) return 'UNKNOWN (no domain)';
  try {
    const text = await fetchText(`https://${host}/robots.txt`);
    const blocks = text.split(/(?=^user-agent:)/im);
    for (const block of blocks) {
      if (!/^user-agent:\s*\*/im.test(block)) continue;
      if (/^disallow:\s*\/\s*$/im.test(block)) return 'BLOCKED (Disallow: / for *)';
    }
    return 'ALLOWED';
  } catch {
    return 'ALLOWED (no robots.txt reachable)';
  }
}

export type PromotionStats = {
  proven: number;
  promoted: number;
  blockedRobots: string[];
  duplicateTenant: string[];
  failed: string[];
};

export async function promoteValidated(
  prisma: PrismaClient,
  reportPath: string,
  inputCsv: string,
): Promise<PromotionStats> {
  const stats: PromotionStats = { proven: 0, promoted: 0, blockedRobots: [], duplicateTenant: [], failed: [] };

  const gated = new Map<string, Row>();
  for (const row of loadRows(fileURLToPath(new URL(`../../${inputCsv}`, import.meta.url)))) {
    gated.set(`${row.maison}|${row.kind}`, row);
  }

  const proven = loadReport(fileURLToPath(new URL(`../../${reportPath}`, import.meta.url))).filter(
    (row) => !row.error && row.jobs >= 1 && row.withLocation >= 1,
  );
  stats.proven = proven.length;

  for (const report of proven) {
    const row = gated.get(`${report.maison}|${report.kind}`);
    if (!row) {
      stats.failed.push(`${report.maison}: absent du catalogue gated`);
      continue;
    }
    const asCatalog: CatalogSource = {
      maison: row.maison,
      careersDomain: row.careersDomain,
      kind: row.kind,
      entryUrl: JSON.stringify(row.config),
      jobUrlPattern: '',
      robotsVerdict: '',
      jobCount: report.jobs,
    };
    const key = sourceKeyFor(asCatalog);
    const tenantKey = tenantKeyOf(row.kind, asCatalog.entryUrl, row.careersDomain, row.maison);

    const verdict = await robotsVerdictFor(
      row.careersDomain ||
        String(
          (row.config.origin ?? row.config.startUrl ?? row.config.listingUrl ?? row.config.sitemapUrl ?? '') as string,
        ),
    );
    if (verdict.startsWith('BLOCKED')) {
      stats.blockedRobots.push(`${key}: ${verdict}`);
      continue;
    }

    const holder = await prisma.source.findUnique({ where: { tenantKey } });
    if (holder && holder.key !== key) {
      stats.duplicateTenant.push(`${key} -> tenant déjà tenu par ${holder.key}`);
      continue;
    }

    try {
      const data = {
        maison: row.maison,
        careersDomain: row.careersDomain || null,
        kind: row.kind,
        config: row.config as Prisma.InputJsonValue,
        tier: tierFor(asCatalog),
        tenantKey,
        robotsVerdict: verdict,
        robotsCheckedAt: new Date(),
        verifiedJobCount: report.jobs,
        note: `promu par validation-volume (${report.jobs} offres, ${report.withLocation} avec lieu)`,
      };
      const existing = await prisma.source.findUnique({ where: { key } });
      if (existing) {
        if (existing.status === 'ACTIVE' || existing.status === 'RETIRED') continue;
        await prisma.source.update({ where: { key }, data });
      } else {
        await prisma.source.create({ data: { ...data, key, status: 'DRAFT' } });
      }
      await promoteSource(prisma, key);
      stats.promoted++;
    } catch (error) {
      stats.failed.push(`${key}: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
    }
  }

  return stats;
}
