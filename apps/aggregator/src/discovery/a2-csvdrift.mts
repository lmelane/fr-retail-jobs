/**
 * a2 — dérive entre data/sources.csv (rejoué par `import-sources` à CHAQUE
 * démarrage de conteneur, cf. Dockerfile CMD) et la table Source (lecture seule).
 * Une différence = une valeur de la base que le prochain déploiement écrasera.
 */
import { PrismaClient } from '@prisma/client';
import { loadSourceCatalog, sourceKeyFor, tierFor } from '../connectors/sourceCatalog.js';

const prisma = new PrismaClient();
try {
  const csv = loadSourceCatalog();
  const keys = csv.map(sourceKeyFor);
  const rows = await prisma.source.findMany({ where: { key: { in: keys } } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const diffs: string[] = [];
  let missing = 0;
  for (const source of csv) {
    const key = sourceKeyFor(source);
    const row = byKey.get(key);
    if (!row) { missing++; continue; }
    let config: Record<string, unknown>;
    try { config = JSON.parse(source.entryUrl || '{}'); } catch { config = { url: source.entryUrl }; }
    // Comparaison insensible à l'ordre des clés : Prisma re-sérialise le JSON.
    const canon = (v: unknown): string =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
        : JSON.stringify(v);
    const same = (a: unknown, b: unknown) => canon(a) === canon(b);
    const fields: string[] = [];
    if (!same(config, row.config)) fields.push('config');
    if ((source.careersDomain || null) !== row.careersDomain) fields.push('careersDomain');
    if (source.kind !== row.kind) fields.push('kind');
    if (tierFor(source) !== row.tier) fields.push('tier');
    if ((source.jobCount || null) !== row.verifiedJobCount) fields.push('verifiedJobCount');
    if ((source.robotsVerdict || null) !== row.robotsVerdict) fields.push('robotsVerdict');
    if (fields.length) diffs.push(`${key} [${row.status}]: ${fields.join(',')}`);
  }
  console.log(JSON.stringify({ csvRows: csv.length, inTable: rows.length, missingFromTable: missing, rowsDeployWouldOverwrite: diffs.length, diffs }, null, 0));
} finally {
  await prisma.$disconnect();
}
