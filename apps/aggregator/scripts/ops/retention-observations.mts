/**
 * LA RÉTENTION DES OBSERVATIONS, EXÉCUTÉE — chaud 14 jours, archive vérifiée, purge fail-closed.
 *
 * La POLITIQUE vit dans `src/retention/observationArchive.ts` et n'écrit rien : elle DÉCIDE. Ce programme
 * exécute, dans l'ordre imposé, et ne supprime que si la politique l'autorise. Séparer les deux est ce qui
 * permet de tester la décision sans risquer une donnée — et ce qui empêche qu'un chemin d'appel réimplémente
 * une étape à côté, en l'oubliant.
 *
 * Ordre, où chaque étape est un verrou :
 *   1. créer l'archive · 2. compter · 3. sha256 · 4. vérifier le manifeste · 5. RESTAURER un échantillon
 *   6. enregistrer les pointeurs · 7. supprimer, alors seulement.
 *
 * Un échec à n'importe quelle étape ⇒ aucune suppression. « La sauvegarde n'existe que si la restauration a
 * été prouvée » (D26) : une archive écrite mais jamais relue est une intention, pas une archive.
 *
 * `--apply` est obligatoire pour écrire ou supprimer. Sans lui, tout est simulé jusqu'au verdict inclus —
 * un dry-run valide une intention, la relecture d'après valide un résultat (D55).
 *
 * usage:
 *   db.py <cible> npx tsx scripts/ops/retention-observations.mts --archive-dir=<dir> [--cutoff-days=14]
 *        [--now=<iso>] [--limit=<n>] [--sample=<n>] [--remote] [--apply] [--out=<f.json>]
 *
 * `--remote` envoie l'archive au stockage objet configuré ET la RELIT DEPUIS LE DISTANT avant de vérifier :
 * c'est la seule façon de prouver que ce qui autorise la purge est bien ce qui vit chez le fournisseur, et
 * non le tampon local qui vient d'être écrit. Sans configuration, l'option ÉCHOUE — jamais de repli muet.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { objectStoreFromEnv, objectStoreConfigured, type ObjectStore } from '../../src/retention/objectStore.js';
import {
  retentionVerdict, cutoffDate, partitionOf, archiveObjectKey,
  ARCHIVE_FORMAT_VERSION, HOT_RETENTION_DAYS,
  type ObservationRow, type ArchiveManifest,
} from '../../src/retention/observationArchive.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const has = (n: string) => process.argv.includes(`--${n}`);

const archiveDir = arg('archive-dir');
if (!archiveDir) { console.error('usage: retention-observations.mts --archive-dir=<dir> [--apply]'); process.exit(2); }
const cutoffDays = Number(arg('cutoff-days') ?? HOT_RETENTION_DAYS);
const now = arg('now') ? new Date(arg('now')!) : new Date();
const limit = Number(arg('limit') ?? 5000);
const sampleSize = Number(arg('sample') ?? 5);
const apply = has('apply');
const remote = has('remote');

/**
 * Le stockage distant est construit MAINTENANT, avant toute lecture de données : si la configuration manque,
 * la chaîne s'arrête ici, et non après avoir archivé localement en croyant avoir archivé au loin.
 */
let store: ObjectStore | null = null;
if (remote) {
  if (!objectStoreConfigured()) {
    console.error('--remote demandé mais le stockage objet n\'est pas configuré.');
    console.error(String((() => { try { objectStoreFromEnv(); return ''; } catch (e) { return (e as Error).message; } })()));
    process.exit(2);
  }
  store = objectStoreFromEnv();
  console.error(`stockage distant : ${JSON.stringify(store.describe())}`);
}

const prisma = new PrismaClient();
const cutoff = cutoffDate(now, cutoffDays);

/**
 * Le `runId` d'une observation n'existe pas sur la ligne : on le retrouve par le `SourceRun` qui couvre son
 * instant. Absent, la partition tombe sur `unknown-run` — on ne fabrique JAMAIS un identifiant de run, et une
 * observation sans run reste archivable, simplement dans sa propre partition.
 */
async function runIdFor(sourceKey: string, at: Date): Promise<string> {
  const r = await prisma.sourceRun.findFirst({
    where: { sourceKey, ranAt: { lte: at } },
    orderBy: { ranAt: 'desc' }, select: { runId: true },
  });
  return r?.runId ?? 'unknown-run';
}

const eligible = await prisma.sourceObservation.findMany({
  where: { observedAt: { lt: cutoff } },
  select: { id: true, sourceKey: true, externalId: true, contentHash: true, observedAt: true },
  orderBy: { observedAt: 'asc' },
  take: limit,
});

/** Regroupement en partitions date × runId × sourceKey, le grain imposé par la décision. */
const groups = new Map<string, { partition: ReturnType<typeof partitionOf>; rows: ObservationRow[] }>();
for (const row of eligible) {
  const runId = await runIdFor(row.sourceKey, row.observedAt);
  const partition = partitionOf(row, runId);
  const key = archiveObjectKey(partition);
  if (!groups.has(key)) groups.set(key, { partition, rows: [] });
  groups.get(key)!.rows.push(row);
}

const results: any[] = [];
let deletedTotal = 0;
let archivedBytes = 0;

for (const [objectKey, { partition, rows }] of groups) {
  const path = join(archiveDir, objectKey);
  let archiveCreated = false;
  let sha256: string | null = null;
  let manifest: ArchiveManifest | null = null;
  let restored: ObservationRow[] | null = null;
  let pointersRecorded = false;
  let remoteUri: string | null = null;

  try {
    // ── 1. créer l'archive. Le RAW n'est PAS recopié quand il est inchangé : la contrainte unique
    //    (sourceKey, externalId, contentHash) garantit déjà qu'un payload identique n'existe qu'une fois en
    //    base. L'archive porte donc chaque contenu une seule fois, par construction.
    const full = await prisma.sourceObservation.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: { sourceKey: true, externalId: true, contentHash: true, observedAt: true, pipelineVersion: true, raw: true },
      orderBy: { observedAt: 'asc' },
    });
    const jsonl = full.map((r) => JSON.stringify({ ...r, observedAt: r.observedAt.toISOString() })).join('\n');
    const gz = gzipSync(Buffer.from(jsonl, 'utf8'), { level: 9 });
    if (apply) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, gz); }
    archiveCreated = true;

    // ── 2 et 3. compter, puis empreindre les OCTETS RÉELLEMENT ÉCRITS (relus du disque quand on applique) :
    //    empreindre le tampon en mémoire ne prouverait pas que l'écriture a abouti.
    /**
     * Les octets qui font foi sont ceux RELUS, jamais le tampon en mémoire : empreindre ce qu'on vient de
     * calculer ne prouve pas que l'écriture a abouti. En mode distant, la relecture se fait CHEZ LE
     * FOURNISSEUR — c'est là que l'archive devra être retrouvée le jour où on en aura besoin.
     */
    let bytes: Uint8Array = gz;
    if (remote && apply) {
      await store!.put(objectKey, gz, 'application/gzip');
      const head = await store!.head(objectKey);
      if (!head || head.size !== gz.length) {
        throw new Error(`relecture distante : taille ${head?.size ?? 'absente'} ≠ ${gz.length} envoyés`);
      }
      bytes = await store!.get(objectKey);
      remoteUri = store!.uri(objectKey);
    } else if (apply) {
      bytes = readFileSync(path);
    }
    sha256 = createHash('sha256').update(bytes).digest('hex');
    const sizeBytes = bytes.length;
    archivedBytes += sizeBytes;

    const times = rows.map((r) => r.observedAt.getTime());
    manifest = {
      partition, rowCount: rows.length,
      periodStart: new Date(Math.min(...times)).toISOString(),
      periodEnd: new Date(Math.max(...times)).toISOString(),
      sizeBytes, sha256, formatVersion: ARCHIVE_FORMAT_VERSION,
    };

    /**
     * Le manifeste voyage AVEC l'archive, au même préfixe : une archive retrouvée sans son manifeste ne dit
     * ni combien de lignes elle porte, ni quelle empreinte elle devait avoir — donc elle ne se vérifie pas.
     * Il part APRÈS l'archive : un manifeste présent devant une archive absente serait un mensonge durable.
     */
    if (remote && apply) {
      const manifestKey = objectKey.replace(/\.jsonl\.gz$/, '.manifest.json');
      await store!.put(manifestKey, Buffer.from(JSON.stringify(manifest, null, 1), 'utf8'), 'application/json');
    }

    // ── 5. RESTAURER un échantillon : relire l'archive et vérifier que ce qui revient appartient au lot.
    const decoded = gunzipSync(bytes).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    restored = decoded.slice(0, sampleSize).map((r: any) => ({
      id: '', sourceKey: r.sourceKey, externalId: r.externalId,
      contentHash: r.contentHash, observedAt: new Date(r.observedAt),
    }));

    // ── 6. enregistrer les pointeurs AVANT toute suppression.
    if (apply) {
      await prisma.$transaction(async (tx) => {
        await tx.observationArchiveManifest.upsert({
          where: { day_runId_sourceKey: { day: partition.day, runId: partition.runId, sourceKey: partition.sourceKey } },
          create: {
            day: partition.day, runId: partition.runId, sourceKey: partition.sourceKey,
            rowCount: manifest!.rowCount, periodStart: new Date(manifest!.periodStart), periodEnd: new Date(manifest!.periodEnd),
            sizeBytes: BigInt(manifest!.sizeBytes), sha256: manifest!.sha256,
            formatVersion: manifest!.formatVersion, archiveUri: remoteUri ?? objectKey, verifiedAt: new Date(),
          },
          update: {
            rowCount: manifest!.rowCount, sizeBytes: BigInt(manifest!.sizeBytes),
            sha256: manifest!.sha256, verifiedAt: new Date(),
          },
        });
        for (const r of rows) {
          await tx.observationArchiveRef.upsert({
            where: { sourceKey_externalId_contentHash: { sourceKey: r.sourceKey, externalId: r.externalId, contentHash: r.contentHash } },
            create: {
              sourceKey: r.sourceKey, externalId: r.externalId, runId: partition.runId === 'unknown-run' ? null : partition.runId,
              observedAt: r.observedAt, contentHash: r.contentHash, disposition: 'ARCHIVED_AND_PURGED',
              archiveUri: remoteUri ?? objectKey, archiveSha256: manifest!.sha256, archiveFormatVersion: manifest!.formatVersion,
            },
            update: { archiveUri: remoteUri ?? objectKey, archiveSha256: manifest!.sha256 },
          });
        }
      });
      pointersRecorded = true;
    } else {
      pointersRecorded = true; // simulé : la politique est exercée jusqu'au verdict inclus.
    }
  } catch (error) {
    results.push({ partition, objectKey, rows: rows.length, deletionAuthorised: false, error: String(error) });
    continue;
  }

  // ── LE VERDICT. C'est LUI, et rien d'autre, qui autorise la suppression.
  const verdict = retentionVerdict({ rows, manifest, observedSha256: sha256, restoredSample: restored, pointersRecorded, archiveCreated });

  let deleted = 0;
  if (verdict.deletionAuthorised && apply) {
    // ── 7. supprimer, alors seulement.
    const res = await prisma.sourceObservation.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    deleted = res.count;
    deletedTotal += deleted;
  }

  results.push({
    partition, objectKey, rows: rows.length,
    deletionAuthorised: verdict.deletionAuthorised,
    completedSteps: verdict.completedSteps,
    failure: verdict.failure,
    sizeBytes: manifest?.sizeBytes ?? null, sha256, deleted,
  });
}

const hotAfter = await prisma.sourceObservation.count();
const report = {
  at: new Date().toISOString(),
  mode: apply ? 'APPLY' : 'DRY_RUN',
  policy: { hotRetentionDays: cutoffDays, cutoff: cutoff.toISOString(), formatVersion: ARCHIVE_FORMAT_VERSION },
  eligible: eligible.length,
  partitions: results.length,
  authorised: results.filter((r) => r.deletionAuthorised).length,
  refused: results.filter((r) => !r.deletionAuthorised).length,
  deleted: deletedTotal,
  archivedBytes,
  hotRowsAfter: hotAfter,
  results,
};

const out = arg('out');
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
await prisma.$disconnect();
