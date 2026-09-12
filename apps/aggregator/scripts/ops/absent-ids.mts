/**
 * LES IDENTIFIANTS ABSENTS d'un cycle, nommés — pour qu'une absence puisse être VÉRIFIÉE à la source.
 *
 * Un compte d'absences ne se vérifie pas : il se croit. Fermer une offre, c'est dire à un candidat qu'un poste
 * n'existe plus ; avant de le dire six fois, on veut les six identifiants, leur dernière observation et leur
 * URL, pour aller regarder chez le publieur.
 *
 * usage: db.py readonly npx tsx scripts/ops/absent-ids.mts --key=<sourceKey> --run-id=<id>
 */
import { PrismaClient, Prisma } from '@prisma/client';

const arg = (n: string) => process.argv.slice(2).find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const key = arg('key');
const runId = arg('run-id');
if (!key || !runId) {
  console.error('usage: absent-ids.mts --key=<sourceKey> --run-id=<id>');
  process.exit(2);
}

const prisma = new PrismaClient();

// L'ensemble RÉELLEMENT observé, lu dans la preuve du run — jamais déduit d'un lastSeenAt.
// La preuve vit sur `PipelineEvent`, pas sur `SourceRun` : même source et même requête que
// `cycle-contracts.mts`, pour que les deux programmes ne puissent pas lire deux ensembles différents.
const ev: any[] = await prisma.$queryRaw(Prisma.sql`
  SELECT coalesce((SELECT array_agg(x) FROM
           jsonb_array_elements(coalesce(payload->'enumeration'->'pageEvidence','[]'::jsonb)) pe,
           jsonb_array_elements_text(coalesce(pe->'canonicalIds','[]'::jsonb)) x), ARRAY[]::text[]) AS ids,
         coalesce((SELECT bool_and(pe ? 'canonicalIds') FROM
           jsonb_array_elements(coalesce(payload->'enumeration'->'pageEvidence','[]'::jsonb)) pe), false) AS declared
  FROM "PipelineEvent"
  WHERE event = 'source.enumeration_observed' AND "sourceKey" = ${key} AND "runId" = ${runId}
  ORDER BY at DESC LIMIT 1`);
if (!ev.length || !ev[0].declared) {
  console.error('preuve absente ou contrat non déclaré : aucune absence n\'est démontrable pour ce cycle');
  process.exit(1);
}
const observed = new Set<string>((ev[0].ids ?? []).map(String));

const rows = await prisma.jobSource.findMany({
  where: { sourceKey: key, isActive: true },
  select: {
    externalId: true, lastSeenAt: true, firstSeenAt: true, url: true,
    job: { select: { id: true, title: true, isActive: true, sources: { where: { isActive: true }, select: { sourceKey: true } } } },
  },
});

const absent = rows
  .filter((r) => !observed.has(r.externalId))
  .map((r) => ({
    externalId: r.externalId,
    title: r.job?.title,
    lastSeenAt: r.lastSeenAt?.toISOString(),
    firstSeenAt: r.firstSeenAt?.toISOString(),
    url: r.url,
    otherActiveSources: (r.job?.sources ?? []).map((s) => s.sourceKey).filter((k) => k !== key),
  }));

console.log(JSON.stringify({ key, runId, observedCount: observed.size, activeRows: rows.length, absent }, null, 1));
await prisma.$disconnect();
