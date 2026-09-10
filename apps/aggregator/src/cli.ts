import { fileURLToPath } from 'node:url';
import { startObservability } from './observability/runtime.js';
import { ObservabilityUnavailableError } from './observability/logger.js';
import { log } from './observability/logger.js';
import { summarizeOrchestration } from './lib/runSummary.js';
import { PrismaClient } from '@prisma/client';
import { runIngest } from './pipeline/ingest.js';
import { ingestAllBySource } from './pipeline/ingestOrchestrator.js';
import { checkSourceHealth } from './pipeline/health.js';
import { sendHealthAlert } from './pipeline/alert.js';
import { submitOfferChanges } from './pipeline/googleIndexing.js';
import { pingHeartbeat } from './pipeline/heartbeat.js';
import { runEgressProbe } from './pipeline/egressProbe.js';

/**
 * How far back to look for offers created/closed by THIS run, when notifying
 * Google (D22). Wider than a run's duration, tighter than a day — a run cut short
 * still catches its changes, and a fresh-start rebuild does not dump the whole
 * catalogue at Google at once (the per-run cap in googleIndexing also guards it).
 */
const INDEXING_WINDOW_MS = Number(process.env.INDEXING_WINDOW_MS ?? 6 * 60 * 60 * 1000);
import { runRefresh } from './pipeline/refresh.js';
import { parseDay, runSnapshot, type SnapshotStats } from './pipeline/snapshot.js';
import { runReconcile } from './pipeline/reconcile.js';
import { separateFusedJobs } from './pipeline/separateFused.js';
import { retireSource } from './pipeline/retireSource.js';
import { importSourcesCsv, promoteSource } from './connectors/sourceStore.js';
import { runGeocode } from './pipeline/geocodeJobs.js';
import { runStats } from './pipeline/stats.js';
import { exportCompanies } from './export/companies.js';
import { discoverMaisons } from './discovery/discoverMaisons.js';
import { closeBrowser } from './lib/browser.js';
import { validateCliArguments } from './lib/cliArguments.js';

/**
 * Three scheduled entry points, each with its own failure domain so one broken
 * job never takes the others down:
 *
 *   ingest    (~2h)    new and updated offers; dedup happens at write time
 *   refresh   (daily)  lifecycle — closes offers no source reports any more,
 *                      then takes the day's market snapshot (D38)
 *   reconcile (weekly) retroactive merges after an alias or synonym is added
 *   snapshot  (manual) the market snapshot alone: --date=, --backfill-from=
 *
 * geocode runs after ingest to resolve any new cities for the map.
 */

const command = process.argv[2] ?? 'ingest';
try { validateCliArguments(command, process.argv.slice(3)); }
catch (error) { await log.error('command.invalid_arguments', { message: error instanceof Error ? error.message : 'Invalid arguments', workStarted: false }); process.exit(2); }
const prisma = new PrismaClient({ errorFormat: 'minimal', log: [] });

// Sonde d'egress AVANT tout (hostGate, ingest, DB) — no-op sans EGRESS_PROBE=1.
let fatalFailure = false;
let observation: Awaited<ReturnType<typeof startObservability>> | undefined;

try {
  observation = await startObservability(prisma, command);
  await runEgressProbe();
  if (command === 'health-report') {
    const { buildHealthReport } = await import('./pipeline/healthReport.js');
    await log.info('health.report', await buildHealthReport(prisma));
  } else if (command === 'ingest') {
    // `ingest --source=<key>` runs one source as a short, independent job (D6).
    const only = process.argv.find((arg) => arg.startsWith('--source='))?.slice('--source='.length);
    // The orchestrator geocodes ONCE at the end, so it passes --no-geocode to
    // each child: otherwise every source re-geocodes the whole backlog of
    // un-located offers, turning a quick per-source run into minutes of API
    // calls repeated 102 times.
    const skipGeocode = process.argv.includes('--no-geocode');
    // skipGeocode passé AUSSI à runIngest : sans lui, une passe de géocodage
    // suivait chaque source (7 775 offres en attente = minutes) même avec le
    // flag, qui ne sautait que la passe finale.
    const stats = await runIngest(prisma, { ...(only ? { only } : {}), skipGeocode });
    const geo = skipGeocode
      ? { pending: 0, lookedUp: 0, jobsLocated: 0, remaining: 0 }
      : await runGeocode(prisma);

    /**
     * A source that stopped producing is an incident, not a quiet zero.
     *
     * Vendors rotate public search keys and move listing paths without notice,
     * and the failure always looks the same: the adapter returns an empty
     * array, the cron exits 0, and a Maison appears to have stopped hiring.
     * Exiting non-zero is what makes the scheduler show it.
     */
    const health = await checkSourceHealth(prisma, stats);
    const alerted = await sendHealthAlert(health);
    await log.info('command.result', { ok: health.broken === 0, command, sources: stats, geo, health, alerted });

    if (health.broken > 0) {
      for (const incident of health.incidents) {
        await log.error('command.failed', `[health] ${incident.source}: ${incident.status} — ${incident.note}`);
      }
      // The data already written is kept; the run is flagged so someone looks.
      process.exitCode = 1;
    }
  } else if (command === 'ingest-all') {
    /**
     * The production ingest entry point (decision D6): each source runs
     * in-process under its own timeout, so no single feed can starve the run.
     * A geocode + health pass follows once every source has had its turn.
     *
     * No cross-run lock: the cron runs ~once a day and a run finishes well
     * within that, so overlap is unlikely; and if two ever overlap, the
     * per-source purge and the unique constraints make it merely duplicated
     * work, never corruption. A session advisory lock, by contrast, could stay
     * stuck after a killed container and block every later run — which it did.
     */
    const orchestration = await ingestAllBySource(prisma);
    const geo = await runGeocode(prisma);
    // One health digest per run: email the operator every degraded/broken source
    // so the catalogue stays clean (a source dying silently is the enemy).
    const alerted = await sendHealthAlert({
      degraded: orchestration.incidents.filter((i) => i.status === 'DEGRADED').length,
      broken: orchestration.incidents.filter((i) => i.status === 'BROKEN').length,
      incidents: orchestration.incidents,
    });

    // D22 — tell Google about the offers this run added (URL_UPDATED) and closed
    // (URL_DELETED), so new pages get crawled fast and expired ones dropped. A
    // no-op until the domain + service account are configured. Bounded windows so
    // a first run after a fresh start does not submit the whole catalogue.
    const since = new Date(Date.now() - INDEXING_WINDOW_MS);
    const [createdRows, closedRows] = await Promise.all([
      prisma.job.findMany({ where: { isActive: true, firstSeenAt: { gte: since } }, select: { id: true }, take: 500 }),
      prisma.job.findMany({ where: { isActive: false, OR: [
        { closedAt: { gte: since } }, { withdrawnAt: { gte: since } },
      ] }, select: { id: true }, take: 500 }),
    ]);
    const indexing = await submitOfferChanges(
      createdRows.map((r) => r.id),
      closedRows.map((r) => r.id),
    );

    // DEC-4: tell the external pinger this run happened (no-op unconfigured).
    // A completed run with source failures remains a failure signal. The
    // summary distinguishes source incidents from an interrupted process.
    const heartbeat = await pingHeartbeat(orchestration.failed === 0 && orchestration.timedOut === 0);

    // SourceRun already persists each incident. Dumping hundreds of nested
    // records exceeded Railway's 500-lines/s limit and hid the final outcome.
    await log.info('ingest.completed', { command,
      ...summarizeOrchestration(orchestration), geo, alerted, indexing, heartbeat });
    if (orchestration.failed > 0 || orchestration.timedOut > 0) {
      await log.error('command.failed', `[orchestrator] ${orchestration.failed} failed, ${orchestration.timedOut} timed out: ${orchestration.failures.join(', ')}`);
      process.exitCode = 1;
    }
  } else if (command === 'refresh') {
    const refresh = await runRefresh(prisma);
    /**
     * D38 : la photographie du jour se prend APRÈS les fermetures, pour que
     * `closedJobs` et la durée de publication médiane reflètent ce refresh.
     * Un échec du snapshot est un incident visible (exit 1) mais ne cache
     * jamais le résultat du refresh, déjà acquis.
     */
    let snapshot: SnapshotStats | null = null;
    let snapshotError: string | null = null;
    if (refresh.refused) {
      // Un refresh refusé laisse des offres périmées « actives » : les
      // photographier ferait entrer un faux jour dans l'historique (audit I-2).
      snapshotError = 'refresh refused by the mass-closure guard — no snapshot taken for today';
    } else {
      try {
        // La garde IA par société (audit I-3) tourne chaque nuit, AVANT la
        // photographie : l'indice IA du jour ne compte pas les textes d'entreprise.
        const { aiCompanyGuard } = await import('./pipeline/classifyJobs.js');
        await aiCompanyGuard(prisma);
        snapshot = await runSnapshot(prisma);
      } catch (error) {
        log.assertHealthy();
        await log.error('snapshot.failed', { error });
        snapshotError = error instanceof Error ? error.message : String(error);
      }
    }
    // Report honestly: a refused mass-closure or a skipped broken source is an
    // incident the scheduler must show, not a silent ok:true.
    await log.info('refresh.completed', { ok: !refresh.refused && !snapshotError, command, ...refresh, snapshot, snapshotError });
    if (refresh.refused) {
      await log.error('command.failed', '[refresh] mass-closure guard refused the run — a source is likely broken');
      process.exitCode = 1;
    }
    if (refresh.skippedBrokenSources.length > 0) {
      await log.error('command.failed', `[refresh] left offers of broken sources open: ${refresh.skippedBrokenSources.join(', ')}`);
    }
    if (snapshotError) {
      await log.error('command.failed', `[snapshot] failed after refresh: ${snapshotError}`);
      process.exitCode = 1;
    }
  } else if (command === 'snapshot') {
    /**
     * Photographie du marché (D38) pour un jour : `--date=YYYY-MM-DD` (défaut
     * aujourd'hui UTC), `--backfill-from=YYYY-MM-DD` reconstruit chaque jour
     * depuis cette date (approximation : voir snapshot.ts). Idempotent.
     */
    const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    const date = arg('date');
    const backfillFrom = arg('backfill-from');
    const stats = await runSnapshot(prisma, {
      ...(date ? { date: parseDay(date) } : {}),
      ...(backfillFrom ? { backfillFrom: parseDay(backfillFrom) } : {}),
    });
    await log.info('command.result', { ok: true, command, ...stats });
  } else if (command === 'reconcile') {
    await log.info('command.result', { ok: true, command, ...(await runReconcile(prisma)) });
  } else if (command === 'import-sources') {
    /**
     * One-shot seed of the Source table (DEC-3) from data/seeds/sources.csv.
     * Idempotent: re-running updates, never duplicates. After this, the CSV is
     * dead weight — every runtime consumer reads the table.
     */
    const stats = await importSourcesCsv(prisma);
    await log.info('command.result', { ok: stats.skippedDuplicateTenant.length === 0, command, ...stats });
    if (stats.skippedDuplicateTenant.length > 0) process.exitCode = 1;
  } else if (command === 'identity-profile') {
    const { sourceIdentityHash, sourceSubjectKey } = await import('./connectors/sourceIdentity.js');
    const key = process.argv[3];
    if (!key || key.startsWith('--')) throw new Error('identity-profile needs a source key');
    const source = await prisma.source.findUniqueOrThrow({ where: { key } });
    await log.info('command.result', { sourceKey: source.key, tenantKey: source.tenantKey, subjectKey: sourceSubjectKey(source), sourceHash: sourceIdentityHash(source) });
  } else if (command === 'review-source-identity') {
    const { readFileSync } = await import('node:fs');
    const { recordSourceIdentityReview } = await import('./connectors/sourceIdentity.js');
    const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    const record = arg('record'); const artifact = arg('artifact');
    if (!record || !artifact) throw new Error('review-source-identity needs --record=<json> --artifact=<archived evidence file> [--apply]');
    await log.info('command.result', await recordSourceIdentityReview(prisma, JSON.parse(readFileSync(record, 'utf8')), readFileSync(artifact), process.argv.includes('--apply')));
  } else if (command === 'promote') {
    /**
     * DRAFT/VALIDATED/PAUSED -> ACTIVE, guarded: config + dated robots verdict
     * + at least one proven offer, or the promotion refuses (règles du plan).
     */
    const key = process.argv[3];
    if (!key || key.startsWith('--')) throw new Error('promote needs the sourceKey to promote');
    await log.info('command.result', { ok: true, command, ...(await promoteSource(prisma, key)) });
  } else if (command === 'retire-source') {
    /**
     * Cleans up after a catalogue line is removed (a robots-forbidden route, an
     * abandoned Flux B board): detaches the retired source's JobSource rows,
     * deletes jobs nothing else backs, reassigns canonical URLs it owned.
     * Guarded: destructive on purpose, so the key must be explicit.
     */
    const key = process.argv[3];
    if (!key || key.startsWith('--')) throw new Error('retire-source needs the sourceKey to retire');
    // `--external-prefix=https://` : ne retirer qu'une ROUTE d'une clé qui en
    // porte deux (kering : flux Eightfold vivant + sitemap périmée), voir RetireOptions.
    const externalIdPrefix = process.argv.find((a) => a.startsWith('--external-prefix='))?.slice('--external-prefix='.length);
    await log.info('command.result', { ok: true, command, externalIdPrefix, ...(await retireSource(prisma, key, { externalIdPrefix })) });
  } else if (command === 'separate-fused') {
    /**
     * One-shot repair for audit D-01: splits openings a single source published
     * under distinct ids that the old write path wrongly fused into one Job.
     * Prints the before/after metric; after the fix ships, fusedAfter must be 0
     * and STAY 0 — a non-zero value on a later run means the guard regressed.
     */
    const stats = await separateFusedJobs(prisma);
    await log.info('command.result', { ok: stats.fusedAfter === 0, command, ...stats });
    if (stats.fusedAfter > 0) process.exitCode = 1;
  } else if (command === 'resolve-domains') {
    /**
     * Pose Company.domain (le logo) sur les Maisons actives qui n'en ont pas :
     * le domaine carrière du catalogue, sinon Wikidata (P856, ≤ 1 req/s),
     * sinon rien — l'initiale plutôt qu'un logo d'une autre entreprise.
     * Idempotente. `--limit=<n>` borne le run, `--dry-run` n'écrit rien.
     */
    const { resolveDomains } = await import('./pipeline/resolveDomains.js');
    const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    const limit = Number(arg('limit') ?? 0);
    const stats = await resolveDomains(prisma, {
      limit: Number.isFinite(limit) ? limit : 0,
      dryRun: process.argv.includes('--dry-run'),
    });
    await log.info('command.result', { ok: true, command, ...stats });
  } else if (command === 'apply-domain-sheet') {
    /**
     * Applique le référentiel de domaines établi à la main (D45) :
     * IDENTIFIÉ pose le domaine, RATTACHÉ fusionne l'entité juridique dans sa
     * marque mère, À VÉRIFIER ne touche à rien. `--apply` pour écrire.
     */
    const { applyDomainSheet } = await import('./pipeline/applyDomainSheet.js');
    const file = process.argv.find((a) => a.startsWith('--file='))?.slice('--file='.length)
      ?? fileURLToPath(new URL('../data/imports/maisons-domaines-loic.tsv', import.meta.url));
    const stats = await applyDomainSheet(prisma, file, { apply: process.argv.includes('--apply') });
    await log.info('command.result', { ok: true, command, file, ...stats });
  } else if (command === 'occupation-review-queue') {
    const {occupationReviewQueue}=await import('./occupation/inventory.js');
    const {writeFile}=await import('node:fs/promises');
    const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
    if(!output)throw new Error('Review queue requires --output=<inventory.json>');
    const result=await occupationReviewQueue(prisma,Number(process.argv.find(a=>a.startsWith('--limit='))?.slice(8)??500));
    await writeFile(output,JSON.stringify(result,null,2)+'\n');
    await log.info('occupation.review_queue',{output,activeUnresolved:result.activeUnresolved,totalVariants:result.totalVariants,returnedVariants:result.returnedVariants});
  } else if (command === 'occupation-preview' || command === 'occupation-activate') {
    const {readFile,writeFile} = await import('node:fs/promises');
    const {previewOccupationRelease,activateOccupationRelease} = await import('./occupation/release.js');
    const arg = (name:string) => process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
    const file=arg('file'),output=arg('output');
    if(!file||!output)throw new Error('Occupation catalogue commands require --file=<manifest.json> and --output=<receipt.json>');
    const manifest=JSON.parse(await readFile(file,'utf8'));
    let receipt;
    if(command==='occupation-preview')receipt=await previewOccupationRelease(prisma,manifest);
    else {
      const review=arg('review'),commit=arg('commit');
      if(!review||!commit||!process.argv.includes('--apply'))throw new Error('Activation requires --review=<preview.json> --commit=<implementation SHA> --apply');
      receipt=await activateOccupationRelease(prisma,manifest,JSON.parse(await readFile(review,'utf8')),commit);
    }
    await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
    await log.info('occupation.catalogue_result',{command,releaseId:receipt.targetRelease,activeJobs:receipt.activeJobs,classifiedActive:receipt.classifiedActive,proofHash:receipt.proofHash,output});
  } else if (command === 'classify-jobs') {
    /**
     * Rejoue la version active du référentiel métier (métier, séniorité, retail) sur toute la base — actives et fermées — pour les lignes
     * dont la version de taxonomie est en retard. `--all` re-classe tout,
     * `--limit=<n>` borne, `--dry-run` compte sans écrire.
     */
    const { classifyJobs } = await import('./pipeline/classifyJobs.js');
    const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    const limit = Number(arg('limit') ?? 0);
    if(!Number.isInteger(limit)||limit<0)throw new Error('--limit must be a nonnegative integer');
    const stats = await classifyJobs(prisma, {
      all: process.argv.includes('--all'),
      dryRun: process.argv.includes('--dry-run'),
      expectedRelease: arg('expected-release'),
      limit: Number.isFinite(limit) ? limit : 0,
    });
    await log.info('command.result', { ok: stats.remaining===0 || !!process.argv.includes('--dry-run') || limit>0, command, ...stats });
    if(!process.argv.includes('--dry-run')&&!limit&&stats.remaining!==0)throw new Error(`OCCUPATION_REPLAY_INCOMPLETE: ${stats.remaining} canonical postings remain on an older release`);
  } else if (command === 'geocode') {
    await log.info('command.result', { ok: true, command, ...(await runGeocode(prisma)) });
  } else if (command === 'stats') {
    await log.info('command.result', { ok: true, ...(await runStats(prisma)) });
  } else if (command === 'export-companies') {
    const output = process.argv[3] ?? 'companies.csv';
    await log.info('command.result', { ok: true, ...(await exportCompanies(prisma, output)) });
  } else if (command === 'discover') {
    /**
     * ATS discovery over a roster of Maisons (decision, 2026-09-02): open each
     * Maison's site in a browser, detect its ATS (following the careers link one
     * hop), and write source candidates to the explicit output directory for HUMAN
     * REVIEW — never straight into sources.csv. Resumable: a re-run skips what is
     * already processed. `--input=<nom,url.csv>` (required), `--limit=<n>` caps
     * this run, `--fresh` restarts from scratch, `--concurrency=<n>`.
     */
    const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    const inputFile = arg('input');
    const outputDir = arg('output-dir');
    if (!inputFile || !outputDir) throw new Error('discover needs --input=<CSV> --output-dir=<run directory>');
    const limit = Number(arg('limit') ?? 0);
    const concurrency = Number(arg('concurrency') ?? 3);
    const fresh = process.argv.includes('--fresh');
    const result = await discoverMaisons({
      inputFile,
      outputDir,
      deadList: arg('dead-list'),
      prisma,
      limit: Number.isFinite(limit) ? limit : 0,
      concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 3,
      fresh,
    });
    await log.info('command.result', { ok: true, command, ...result });
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  fatalFailure = true;
  // Exit non-zero so Railway marks the cron run as failed instead of silently
  // reporting success on a broken pipeline.
  process.exitCode = 1;
  if (!(error instanceof ObservabilityUnavailableError)) {
    try { await log.error('command.failed', { command, error }); }
    catch (loggingError) { if (!(loggingError instanceof ObservabilityUnavailableError)) throw loggingError; }
  }
} finally {
  try {
    try { await closeBrowser(); }
    catch (error) { fatalFailure = true; process.exitCode = 1; await log.error('browser.cleanup_failed', { error }); }
    await observation?.finish(fatalFailure ? 'FAILED' : process.exitCode ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED');
  } catch (error) {
    process.exitCode = 1;
    if (!(error instanceof ObservabilityUnavailableError)) {
      try { await log.error('run.finalization_failed', { error }); }
      catch (loggingError) { if (!(loggingError instanceof ObservabilityUnavailableError)) throw loggingError; }
    }
  } finally { await prisma.$disconnect(); }
}
