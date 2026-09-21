/**
 * L'ÉTAT DE CHAQUE SOURCE DU REGISTRE — une vue, pas un modèle de plus.
 *
 *   DATABASE_URL=<base> npx tsx apps/aggregator/scripts/ops/etat-sources.mts [--csv]
 *
 * Tout vient des tables existantes : `Source`, `SourceAccessDecision`, `SourceExtraction`,
 * `SourceIngestionCompletion`, `JobSource`, `Job`. Le verdict de qualification est lu dans le
 * fichier de campagne quand il existe — c'est lui qui porte les états `QUALIFIEE`,
 * `BLOCAGE_EXTERNE`, `DOMAINE_OFFICIEL_*`…
 *
 * Objectif : qu'aucune source ne reste dans un état ambigu. Une source correctement bloquée est
 * un état CONNU, et c'est un succès — pas un échec à corriger.
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const verdicts = new Map<string, string>();
const fichier = 'backups/campagne-dev-l11/verdicts.json';
if (existsSync(fichier))
  for (const v of JSON.parse(readFileSync(fichier, 'utf8')) as Array<{ key: string; verdict: string }>)
    verdicts.set(v.key, v.verdict);

type Ligne = {
  source: string; famille: string; maison: string; qualification: string; acces: string;
  scope: string; rawDistinct: number; published: number; held: number; skipped: number;
  writeFailed: number; publiables: number; blocker: string;
};

const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
  SELECT s.key AS source, s.kind AS famille, s.maison,
         coalesce(s."portalScope", '—') AS scope,
         coalesce(d.verdict, '—') AS acces,
         (SELECT count(DISTINCT e."externalId") FROM "SourceExtraction" e
            JOIN "CaptureBatch" b ON b.id = e."batchId" WHERE b."sourceKey" = s.key) AS "rawDistinct",
         coalesce((SELECT sum(c.published) FROM "SourceIngestionCompletion" c
                     JOIN "CaptureBatch" b ON b.id = c."batchId" WHERE b."sourceKey" = s.key), 0) AS published,
         coalesce((SELECT sum(c.held) FROM "SourceIngestionCompletion" c
                     JOIN "CaptureBatch" b ON b.id = c."batchId" WHERE b."sourceKey" = s.key), 0) AS held,
         coalesce((SELECT sum(c.skipped) FROM "SourceIngestionCompletion" c
                     JOIN "CaptureBatch" b ON b.id = c."batchId" WHERE b."sourceKey" = s.key), 0) AS skipped,
         coalesce((SELECT sum(c."writeFailed") FROM "SourceIngestionCompletion" c
                     JOIN "CaptureBatch" b ON b.id = c."batchId" WHERE b."sourceKey" = s.key), 0) AS "writeFailed",
         (SELECT count(*) FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL
            AND EXISTS (SELECT 1 FROM "JobSource" x WHERE x."jobId" = j.id AND x."sourceKey" = s.key
                          AND x."isActive" AND (x."expiresAt" IS NULL OR x."expiresAt" > now()))) AS publiables
    FROM "Source" s
    LEFT JOIN LATERAL (SELECT verdict FROM "SourceAccessDecision" x
                        WHERE x."sourceKey" = s.key ORDER BY x.sequence DESC LIMIT 1) d ON true
   ORDER BY 7 DESC, 1`);

const lignes: Ligne[] = rows.map((r) => {
  const n = (k: string) => Number(r[k] ?? 0);
  const qualification = verdicts.get(String(r.source)) ?? 'NON_TENTEE';
  /* Le blocker se DÉDUIT de l'état, jamais d'une supposition : un writeFailed non nul est un
   * refus d'écriture, une qualification non QUALIFIEE est un blocage amont. */
  const blocker = n('writeFailed') > 0 ? 'WRITE_FAILED'
    : qualification !== 'QUALIFIEE' && qualification !== 'NON_TENTEE' ? qualification
    : n('published') === 0 && qualification === 'QUALIFIEE' ? 'QUALIFIEE_SANS_PUBLICATION'
    : qualification === 'NON_TENTEE' ? 'NON_TENTEE' : '—';
  return { source: String(r.source), famille: String(r.famille), maison: String(r.maison),
    qualification, acces: String(r.acces), scope: String(r.scope), rawDistinct: n('rawDistinct'),
    published: n('published'), held: n('held'), skipped: n('skipped'),
    writeFailed: n('writeFailed'), publiables: n('publiables'), blocker };
});

if (process.argv.includes('--csv')) {
  const entete = 'source;famille;maison;qualification;acces;scope;rawDistinct;published;held;skipped;writeFailed;publiables;blocker';
  const csv = [entete, ...lignes.map((l) => Object.values(l).join(';'))].join('\n');
  writeFileSync('backups/etat-sources.csv', `${csv}\n`, 'utf8');
  console.log(`  → backups/etat-sources.csv (${lignes.length} sources)`);
}

console.log(`\n═══ ÉTAT DU REGISTRE — ${lignes.length} sources ═══\n`);
const parQualif = lignes.reduce<Record<string, { n: number; pub: number }>>((a, l) => {
  a[l.qualification] ??= { n: 0, pub: 0 };
  a[l.qualification].n++; a[l.qualification].pub += l.publiables; return a;
}, {});
for (const [q, v] of Object.entries(parQualif).sort((a, b) => b[1].n - a[1].n))
  console.log(`  ${q.padEnd(28)} ${String(v.n).padStart(4)} sources  ${String(v.pub).padStart(5)} publiables`);

const actives = lignes.filter((l) => l.published > 0 || l.writeFailed > 0);
if (actives.length) {
  console.log(`\n  ${'source'.padEnd(26)} ${'famille'.padEnd(24)} ${'RAW'.padStart(5)} ${'publ.'.padStart(6)} ${'held'.padStart(5)} ${'skip'.padStart(5)} ${'wFail'.padStart(6)} ${'publiables'.padStart(10)}  blocker`);
  for (const l of actives)
    console.log(`  ${l.source.slice(0, 26).padEnd(26)} ${l.famille.slice(0, 24).padEnd(24)} ${String(l.rawDistinct).padStart(5)} ${String(l.published).padStart(6)} ${String(l.held).padStart(5)} ${String(l.skipped).padStart(5)} ${String(l.writeFailed).padStart(6)} ${String(l.publiables).padStart(10)}  ${l.blocker}`);
}
console.log(`\n  TOTAL publiables : ${lignes.reduce((a, l) => a + l.publiables, 0)}\n`);
await prisma.$disconnect();
