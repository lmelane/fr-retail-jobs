import type { PrismaClient } from '@prisma/client';
import {
  resolveCompanyDomain,
  wikidataClient,
  type DomainSource,
  type EmployerSourceLike,
  type WikidataClient,
} from '../normalize/companyDomain.js';

/**
 * `resolve-domains` — pose Company.domain sur les Maisons qui n'en ont pas.
 *
 * Le site construit le logo d'une Maison depuis son domaine ; ce domaine
 * vient d'une source qui la NOMME — le catalogue (chemin (i), posé aussi à
 * l'ingest) ou Wikidata (chemin (ii), réseau, une requête par seconde) — ou
 * reste vide, et le site montre l'initiale. Jamais deviné depuis le nom.
 *
 * Idempotente : ne parcourt que les Company actives sans `domain`, dans
 * l'ordre des offres actives (les Maisons les plus visibles d'abord, utile
 * avec `--limit`). Une Maison non résolue est re-tentée au run suivant : rien
 * n'est gravé pour un « non », Wikidata se complète.
 */

export type ResolveDomainsOptions = {
  /** Au plus N Maisons ce run (0 = toutes). */
  limit?: number;
  /** Résout et imprime, n'écrit rien. */
  dryRun?: boolean;
  /** Client Wikidata injectable (les tests rejouent des fixtures). */
  wikidata?: WikidataClient;
};

export type ResolveDomainsStats = {
  scanned: number;
  resolved: Record<DomainSource, number>;
  unresolved: number;
  written: number;
  examples: {
    'source-careers': string[];
    wikidata: string[];
    unresolved: string[];
  };
};

const EXAMPLES_PER_BUCKET = 12;

export async function resolveDomains(prisma: PrismaClient, options: ResolveDomainsOptions = {}): Promise<ResolveDomainsStats> {
  const wikidata = options.wikidata ?? wikidataClient();
  const limit = options.limit && options.limit > 0 ? options.limit : 0;

  // Le catalogue actif : la maison, le tier et l'hôte carrière de chaque source.
  const sources: EmployerSourceLike[] = await prisma.source.findMany({
    where: { status: 'ACTIVE' },
    select: { maison: true, tier: true, careersDomain: true },
  });

  const pending = await prisma.company.findMany({
    where: { domain: null, jobs: { some: { isActive: true } } },
    select: {
      id: true,
      name: true,
      canonicalKey: true,
      _count: { select: { jobs: { where: { isActive: true } } } },
    },
  });
  const ordered = [...pending].sort((a, b) => b._count.jobs - a._count.jobs);
  const batch = limit ? ordered.slice(0, limit) : ordered;

  const stats: ResolveDomainsStats = {
    scanned: batch.length,
    resolved: { 'source-careers': 0, wikidata: 0, manual: 0 },
    unresolved: 0,
    written: 0,
    examples: { 'source-careers': [], wikidata: [], unresolved: [] },
  };

  for (const company of batch) {
    const result = await resolveCompanyDomain({ name: company.name, canonicalKey: company.canonicalKey }, sources, wikidata);
    if (!result) {
      stats.unresolved++;
      if (stats.examples.unresolved.length < EXAMPLES_PER_BUCKET) stats.examples.unresolved.push(company.name);
      continue;
    }
    stats.resolved[result.domainSource]++;
    const bucket = stats.examples[result.domainSource as 'source-careers' | 'wikidata'];
    if (bucket && bucket.length < EXAMPLES_PER_BUCKET) bucket.push(`${company.name} → ${result.domain}`);
    if (options.dryRun) continue;
    // `domain: null` dans le where : une Maison résolue entre-temps (un ingest
    // concurrent) garde ce qu'elle a — la commande ne rejoue jamais un choix.
    const written = await prisma.company.updateMany({
      where: { id: company.id, domain: null },
      data: { domain: result.domain, domainSource: result.domainSource },
    });
    stats.written += written.count;
  }

  return stats;
}
