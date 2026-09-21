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
  source: string; famille: string; maison: string;
  /** Le verdict de la CAMPAGNE : identité, domaine, accès. N'empêche pas de publier. */
  qualificationVerdict: string;
  acces: string; scope: string; rawDistinct: number;
  /** L'ÉTAT ACTUEL du catalogue pour cette source — ce qui compte pour le gain business. */
  jobSourceActifs: number; jobsCanoniques: number; publiables: number;
  /** La somme historique des completions : des ÉVÉNEMENTS de publication, jamais des offres. */
  publishedEvents: number;
  held: number; skipped: number; writeFailed: number;
  /** Ce qui empêche RÉELLEMENT de publier aujourd'hui — vide si la source publie. */
  publicationBlocker: string;
};

const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
  SELECT s.key AS source, s.kind AS famille, s.maison,
         coalesce(s."portalScope", '—') AS scope,
         coalesce(d.verdict, '—') AS acces,
         (SELECT count(DISTINCT e."externalId") FROM "SourceExtraction" e
            JOIN "CaptureBatch" b ON b.id = e."batchId" WHERE b."sourceKey" = s.key) AS "rawDistinct",
         /* Des ÉVÉNEMENTS de publication cumulés sur tous les runs : deux passages sur 213 offres
          * en comptent 426. Ce n'est PAS un nombre d'offres, et le nom le dit. */
         coalesce((SELECT sum(c.published) FROM "SourceIngestionCompletion" c
                     JOIN "CaptureBatch" b ON b.id = c."batchId" WHERE b."sourceKey" = s.key), 0) AS "publishedEvents",
         /* L'ÉTAT ACTUEL, lu dans la base : c'est lui qui mesure le catalogue. */
         (SELECT count(*) FROM "JobSource" x WHERE x."sourceKey" = s.key AND x."isActive") AS "jobSourceActifs",
         (SELECT count(DISTINCT x."jobId") FROM "JobSource" x WHERE x."sourceKey" = s.key AND x."jobId" IS NOT NULL) AS "jobsCanoniques",
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
  const qualificationVerdict = verdicts.get(String(r.source)) ?? 'NON_TENTEE';

  /*
   * LE BLOCKER DE PUBLICATION N'EST PAS LE VERDICT DE QUALIFICATION.
   *
   * `kiabi` est classée BLOCAGE_EXTERNE — ses pages officielles répondent 403 à la campagne —
   * et publie pourtant 213 offres. Mélanger les deux notions dans un même champ ferait lire un
   * blocage là où le catalogue se remplit normalement.
   *
   * Une source qui publie N'A PAS de blocker de publication, quel que soit son verdict.
   */
  const publicationBlocker = n('publiables') > 0 ? '—'
    : n('writeFailed') > 0 ? 'WRITE_FAILED'
    : qualificationVerdict === 'NON_TENTEE' ? 'NON_TENTEE'
    : qualificationVerdict !== 'QUALIFIEE' ? qualificationVerdict
    : 'QUALIFIEE_SANS_PUBLICATION';

  return { source: String(r.source), famille: String(r.famille), maison: String(r.maison),
    qualificationVerdict, acces: String(r.acces), scope: String(r.scope), rawDistinct: n('rawDistinct'),
    jobSourceActifs: n('jobSourceActifs'), jobsCanoniques: n('jobsCanoniques'), publiables: n('publiables'),
    publishedEvents: n('publishedEvents'), held: n('held'), skipped: n('skipped'),
    writeFailed: n('writeFailed'), publicationBlocker };
});

if (process.argv.includes('--csv')) {
  const entete = Object.keys(lignes[0] ?? {}).join(';');
  const csv = [entete, ...lignes.map((l) => Object.values(l).join(';'))].join('\n');
  writeFileSync('backups/etat-sources.csv', `${csv}\n`, 'utf8');
  console.log(`  → backups/etat-sources.csv (${lignes.length} sources)`);
}

console.log(`\n═══ ÉTAT DU REGISTRE — ${lignes.length} sources ═══\n`);
const parQualif = lignes.reduce<Record<string, { n: number; pub: number }>>((a, l) => {
  a[l.qualificationVerdict] ??= { n: 0, pub: 0 };
  a[l.qualificationVerdict].n++; a[l.qualificationVerdict].pub += l.publiables; return a;
}, {});
for (const [q, v] of Object.entries(parQualif).sort((a, b) => b[1].n - a[1].n))
  console.log(`  ${q.padEnd(28)} ${String(v.n).padStart(4)} sources  ${String(v.pub).padStart(5)} publiables`);

const actives = lignes.filter((l) => l.publiables > 0 || l.writeFailed > 0);
if (actives.length) {
  console.log(`\n  ${'source'.padEnd(26)} ${'famille'.padEnd(22)} ${'RAW'.padStart(5)} ${'JS'.padStart(5)} ${'Job'.padStart(5)} ${'publiables'.padStart(10)} ${'wFail'.padStart(6)}  ${'verdict'.padEnd(26)} blocker`);
  for (const l of actives)
    console.log(`  ${l.source.slice(0, 26).padEnd(26)} ${l.famille.slice(0, 22).padEnd(22)} ${String(l.rawDistinct).padStart(5)} ${String(l.jobSourceActifs).padStart(5)} ${String(l.jobsCanoniques).padStart(5)} ${String(l.publiables).padStart(10)} ${String(l.writeFailed).padStart(6)}  ${l.qualificationVerdict.padEnd(26)} ${l.publicationBlocker}`);
}

/* LES COMPTEURS SE LISENT DANS LA BASE, jamais recopiés à la main : une seule vérité. */
const publiantes = lignes.filter((l) => l.publiables > 0).length;
console.log(`\n  sources publiantes      : ${publiantes}`);
console.log(`  OFFRES PUBLIABLES UNIQUES : ${lignes.reduce((a, l) => a + l.publiables, 0)}`);
console.log(`  (événements de publication cumulés : ${lignes.reduce((a, l) => a + l.publishedEvents, 0)} — ne PAS confondre)\n`);
await prisma.$disconnect();
