import { exitIfPipelinePaused } from './lib/pipelinePause.js';
import { startObservability } from './observability/runtime.js';
import { ObservabilityUnavailableError } from './observability/logger.js';
import { log } from './observability/logger.js';
import { summarizeOrchestration } from './lib/runSummary.js';
import type { CompletionStatus, RunCompletion } from './lib/runCompletion.js';
import { issuesFromResult } from './lib/ingestionIssue.js';
import { PrismaClient } from '@prisma/client';
import { runIngest } from './pipeline/ingest.js';
import { ingestAllBySource, runQualifiedIngest } from './pipeline/ingestOrchestrator.js';
import { checkSourceHealth } from './pipeline/health.js';
import { sendHealthAlert } from './pipeline/alert.js';
import { submitOfferChanges } from './pipeline/googleIndexing.js';
import { pingHeartbeat } from './pipeline/heartbeat.js';

/**
 * How far back to look for offers created/closed by THIS run, when notifying
 * Google (D22). Wider than a run's duration, tighter than a day — a run cut short
 * still catches its changes, and a fresh-start rebuild does not dump the whole
 * catalogue at Google at once (the per-run cap in googleIndexing also guards it).
 */
const INDEXING_WINDOW_MS = Number(process.env.INDEXING_WINDOW_MS ?? 6 * 60 * 60 * 1000);
import { runRefresh, refreshScope } from './pipeline/refresh.js';
import { retireSource } from './pipeline/retireSource.js';
import { runGeocode } from './pipeline/geocodeJobs.js';
import { runStats } from './pipeline/stats.js';
import { exportCompanies } from './export/companies.js';
import { discoverMaisons } from './discovery/discoverMaisons.js';
import { closeBrowser } from './lib/browser.js';
import { validateCliArguments } from './lib/cliArguments.js';

/**
 * Ingestion and lifecycle maintenance have separate entry points:
 *
 *   ingest    (~2h)    new and updated offers; dedup happens at write time
 *   refresh   (daily)  lifecycle — closes offers no source reports any more
 *
 * geocode runs after ingest to resolve any new cities for the map.
 */

const command = process.argv[2] ?? 'ingest';
try { validateCliArguments(command, process.argv.slice(3)); }
catch (error) { await log.error('command.invalid_arguments', { message: error instanceof Error ? error.message : 'Invalid arguments', workStarted: false }); process.exit(2); }
if (!['health-report', 'stats', 'export-companies', 'occupation-review-queue'].includes(command)) exitIfPipelinePaused(command);
const prisma = new PrismaClient({ errorFormat: 'minimal', log: [] });

let fatalFailure = false;
let sourceIncidents = false;
let observation: Awaited<ReturnType<typeof startObservability>> | undefined;

try {
  observation = await startObservability(prisma, command);
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
    const stats = only ? await runQualifiedIngest(prisma, only, skipGeocode) : await runIngest(prisma, { skipGeocode });
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
    const issues = issuesFromResult(stats, health.incidents);
    await log.info('command.result', { ok: stats.length > 0 && issues.length === 0, command, sources: stats, issues, geo, health, alerted });

    if (!stats.length || issues.length > 0) {
      fatalFailure = true;
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
    // The daily worker owns lifecycle maintenance too. A failed/partial source
    // cannot attest absence: the existing refresh proof reader and mass-closure
    // guard remain authoritative. Paused sources retain their publications.
    const activeSources = await prisma.source.findMany({ where: { status: 'ACTIVE' }, select: { key: true } });
    const refresh = await runRefresh(prisma, { onlyKeys: activeSources.map(source => source.key) });
    await log.info('refresh.completed', { command, ...refresh });
    if (refresh.refused) {
      fatalFailure = true;
      await log.error('command.failed', '[refresh] mass-closure guard refused lifecycle maintenance');
      process.exitCode = 1;
    }
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

    // SourceRun already persists each incident. Dumping hundreds of nested
    // records exceeded Railway's 500-lines/s limit and hid the final outcome.
    const summary = summarizeOrchestration(orchestration);
    sourceIncidents = orchestration.failed + orchestration.timedOut > 0;
    await log.info('ingest.completed', { command,
      ...summary, geo, refresh, alerted, indexing });
    if (!summary.executionHealthy || (orchestration.incidents.length > 0 && !alerted)) {
      fatalFailure = true;
      await log.error('command.failed', { blockingReasons: summary.blockingReasons,
        alertDeliveryFailed: orchestration.incidents.length > 0 && !alerted });
      process.exitCode = 1;
    }
  } else if (command === 'refresh') {
    /**
     * Le refresh a SON périmètre autorisé (`REFRESH_ONLY_KEYS`), distinct de celui de l'ingestion.
     *
     * Les clés connues sont lues dans le CATALOGUE (`Source`), pas dans les JobSource actives : une clé doit
     * pouvoir être nommée même si aucune de ses offres n'est active. Une clé inconnue arrête la commande.
     */
    const catalogue = await prisma.source.findMany({ select: { key: true } });
    const onlyKeys = refreshScope(catalogue.map((s) => s.key));
    if (onlyKeys) await log.info('refresh.scoped', { sources: onlyKeys.length, keys: onlyKeys.join(',') });
    const refresh = await runRefresh(prisma, onlyKeys ? { onlyKeys } : {});
    // Report honestly: a refused mass-closure or a skipped broken source is an
    // incident the scheduler must show, not a silent ok:true.
    await log.info('refresh.completed', { ok: !refresh.refused, command, ...refresh });
    if (refresh.refused) {
      await log.error('command.failed', '[refresh] mass-closure guard refused the run — a source is likely broken');
      process.exitCode = 1;
    }
    if (refresh.unverifiableSources.length > 0) {
      await log.error('command.failed', `[refresh] left offers of broken sources open: ${refresh.unverifiableSources.join(', ')}`);
    }
  } else if (command === 'direct-sync') {
    /**
     * Lot 6 (D-423) — la copie de lecture des offres Catwalks : consomme le
     * flux d'outbox du backend depuis le curseur (ou `--depuis=<seq>` pour
     * rejouer), page par page (`--limite=`, ≤ 500). Idempotent, monotone :
     * rejouer depuis 0 ne ressuscite rien. `CATALOGUE_FLUX_URL` et
     * `CATALOGUE_FLUX_KEY` viennent de l'environnement ; sans eux, rien ne
     * part et la commande échoue explicitement.
     */
    const { consommerFlux, fluxHttp } = await import('./direct/feed.js');
    const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    const base = process.env.CATALOGUE_FLUX_URL?.trim(), cle = process.env.CATALOGUE_FLUX_KEY?.trim();
    if (!base || !cle) throw new Error('direct-sync requires CATALOGUE_FLUX_URL and CATALOGUE_FLUX_KEY');
    const depuis = arg('depuis'), limite = Number(arg('limite') ?? 200);
    if (depuis !== undefined && !/^\d{1,19}$/.test(depuis)) throw new Error('--depuis must be a sequence number');
    const stats = await consommerFlux(prisma, fluxHttp(base, cle), { taillePage: limite, ...(depuis !== undefined ? { depuis: BigInt(depuis) } : {}) });
    // D-455 : une ligne du stock que la re-projection n'a pas su reconstruire garde son ancien employeur affiché.
    // Le flux a bien été lu, mais la commande le dit : un ok:true silencieux cacherait l'écart à l'ordonnanceur.
    const nonReprojetees = stats.reprojection.nonReprojetees.length;
    await log.info('command.result', { ok: !stats.refus && nonReprojetees === 0, command, ...stats, dernierSeq: stats.dernierSeq?.toString() ?? null });
    if (stats.refus || nonReprojetees > 0) process.exitCode = 1;
  } else if (command === 'direct-liste') {
    /**
     * D-444 — la photo des offres Catwalks : relit la liste publique du backend (origine `CATALOGUE_LISTE_URL`, chemins
     * `/api/jobs` et `/api/jobs/filters` pour son compte) et tient `DirectOffer` à jour en n'écrivant que ce qui change
     * (`direct/photo.ts`). Une photo vide, tronquée au plafond de 500, plus courte que le compte du backend (ou sans
     * compte lisible) ou portant une offre refusée ne retire rien et fait échouer la passe ; une panne du backend ou une
     * réponse invalide la fait échouer sans rien écrire dans les offres. Le service Railway `catwalks-direct-sync` la
     * lance toutes les 5 minutes, sur GO de production.
     */
    const { passeReussie, synchroniserListe } = await import('./direct/photo.js');
    const { listeHttp } = await import('./direct/liste.js');
    const origine = process.env.CATALOGUE_LISTE_URL?.trim();
    if (!origine) throw new Error('direct-liste requires CATALOGUE_LISTE_URL');
    const stats = await synchroniserListe(prisma, listeHttp(origine));
    // Une photo incomplète, périmée ou concurrente, ou une ligne du stock que la re-projection n'a pas su reconstruire,
    // se dit à l'ordonnanceur.
    const ok = passeReussie(stats);
    await log.info('command.result', { ok, command, ...stats });
    if (!ok) process.exitCode = 1;
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
     * Rejoue la version active du référentiel métier (métier, séniorité) sur toute la base — actives et fermées — pour les lignes
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
     * REVIEW — jamais directement dans le registre. Reprenable : un nouveau passage saute ce qui est
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
    if (observation && !['health-report', 'stats', 'export-companies', 'occupation-review-queue'].includes(command)) {
      const heartbeat = await pingHeartbeat(!fatalFailure && !process.exitCode);
      await log.info('pipeline.heartbeat', { heartbeat, command });
      if (heartbeat === 'failed') { fatalFailure = true; process.exitCode = 1; }
    }
    const status: CompletionStatus = fatalFailure ? 'FAILED' : process.exitCode || sourceIncidents ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
    await observation?.finish(status);
    if (observation && process.send) {
      const message: RunCompletion = { event: 'pipeline.finalized', command, runId: observation.runId,
        status: process.exitCode ? 'FAILED' : status };
      await new Promise<void>((resolve, reject) => process.send!(message, error => error ? reject(error) : resolve()));
    }
  } catch (error) {
    process.exitCode = 1;
    await pingHeartbeat(false);
    if (!(error instanceof ObservabilityUnavailableError)) {
      try { await log.error('run.finalization_failed', { error }); }
      catch (loggingError) { if (!(loggingError instanceof ObservabilityUnavailableError)) throw loggingError; }
    }
  } finally { await prisma.$disconnect(); if (process.connected) process.disconnect(); }
}
