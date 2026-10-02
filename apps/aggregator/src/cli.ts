import { exitIfPipelinePaused } from './lib/pipelinePause.js';
import { startObservability } from './observability/runtime.js';
import { ObservabilityUnavailableError } from './observability/logger.js';
import { log } from './observability/logger.js';
import { summarizeOrchestration } from './lib/runSummary.js';
import type { CompletionStatus, RunCompletion } from './lib/runCompletion.js';
import { PrismaClient } from '@prisma/client';
import { runIngest } from './pipeline/ingest.js';
import { captureHandoffFromEnv, ingestAllBySource, ingestCommandVerdict, runQualifiedIngest } from './pipeline/ingestOrchestrator.js';
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
/** R-143 §2 — la sonde des liens « Postuler » du RUN : au plus 300 offres et 10 minutes, à 2 requêtes par seconde. */
const APPLY_LINK_PROBE_LIMIT = 300;
const APPLY_LINK_PROBE_BUDGET_MS = 10 * 60 * 1000;
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
if (!['health-report', 'stats', 'export-companies', 'occupation-review-queue', 'coverage'].includes(command)) exitIfPipelinePaused(command);
const prisma = new PrismaClient({ errorFormat: 'minimal', log: [] });

/** L'avant d'une étape qui masque (R-143 §11) ; null si la lecture échoue : la revue de couverture le dira. */
async function readBeforeOrNull() {
  try {
    const { readCoverageBefore } = await import('./coverage/coverageReading.js');
    return await readCoverageBefore(prisma);
  } catch (error) {
    log.assertHealthy();
    await log.error('coverage.before_failed', { error });
    return null;
  }
}
/** Une commande qui pose des retenues hors RUN : encadrée par la revue de couverture, sauf à blanc (D-516 §2). */
async function maskingCommand<T>(step: () => Promise<T>, dryRun: boolean, probeOf?: (result: T) => { probed: number; byVerdict: Record<string, number> }) {
  if (dryRun) return { result: await step(), sent: true };
  const { withCoverageReview } = await import('./coverage/coverageReview.js');
  const outcome = await withCoverageReview(prisma, step, probeOf);
  if (outcome.error) { log.assertHealthy(); await log.error('coverage.failed', { error: outcome.error }); }
  await log.info('coverage.reviewed', { written: outcome.review?.written ?? 0, sent: outcome.sent, findings: outcome.review?.evaluation.findings.length ?? null });
  return { result: outcome.result, sent: outcome.sent };
}

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
    const stats = only ? await runQualifiedIngest(prisma, only, skipGeocode, undefined, captureHandoffFromEnv()) : await runIngest(prisma, { skipGeocode });
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
    // La règle du RUN (D-453 §1, D-480 §1) : l'alerte et le verdict séparent ce qui bloque de ce qui reste visible.
    const verdict = ingestCommandVerdict(stats, health.incidents);
    const alerted = await sendHealthAlert({ ...health, incidents: verdict.incidents });
    await log.info('command.result', { ok: verdict.ok, command, sources: stats, issues: verdict.issues, blocking: verdict.blocking, geo, health, alerted });

    if (!verdict.ok) {
      fatalFailure = true;
      for (const incident of verdict.incidents.filter(incident => incident.blocking !== false)) {
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
    // R-143 §11, D-516 §2 : ce que le candidat voit AVANT les étapes qui retirent (refresh, disponibilité, sonde), pour
    // que la revue de couverture mesure exactement ce qu'elles retirent, dès le premier RUN qui masque.
    const coverageBefore = await readBeforeOrNull();
    // The daily worker owns lifecycle maintenance too. A failed/partial source
    // cannot attest absence: the existing refresh proof reader and mass-closure
    // guard remain authoritative. Paused sources retain their publications, served (D-485, D-493, D-506).
    const activeSources = await prisma.source.findMany({ where: { status: 'ACTIVE' }, select: { key: true } });
    const refresh = await runRefresh(prisma, { onlyKeys: activeSources.map(source => source.key) });
    await log.info('refresh.completed', { command, ...refresh });
    if (refresh.refused) {
      fatalFailure = true;
      await log.error('command.failed', '[refresh] mass-closure guard refused lifecycle maintenance');
      process.exitCode = 1;
    }
    // La garde du zéro annoncé (R-143) n'a rien appliqué pour ces sources : chacune est une anomalie à instruire,
    // journalisée (`refresh.source_anomaly`) et visible au bilan. Elle ne rend pas le RUN rouge : ajouter un motif de
    // blocage du RUN appartient au CEO (D-453, D-480, D-484, D-491).
    if (refresh.anomalousSources.length > 0) {
      await log.error('refresh.anomalies', `[refresh] mass-absence guard kept the offers of: ${refresh.anomalousSources.join(', ')}`);
    }
    // R-143 §2 : la confiance avant le volume. Rien n'est fermé ; une offre non reconfirmée ou au lien mort quitte
    // l'expérience candidat et y revient dès que sa source la revoit.
    const { runAvailabilityReview } = await import('./pipeline/availability.js');
    const availability = await runAvailabilityReview(prisma);
    await log.info('availability.reviewed', { released: availability.released, held: availability.held,
      notCredible: availability.sources.filter(source => !source.credible && source.missed > 0)
        .map(source => ({ sourceKey: source.sourceKey, missed: source.missed, reason: source.reason })) });
    const { runApplyLinkProbe } = await import('./pipeline/applyLinkProbe.js');
    const probe = await runApplyLinkProbe(prisma, { limit: APPLY_LINK_PROBE_LIMIT, deadline: Date.now() + APPLY_LINK_PROBE_BUDGET_MS });
    await log.info('availability.probed', { probed: probe.probed, held: probe.held, byVerdict: probe.byVerdict });
    // R-143 §11, D-516 §2 : l'alerte de couverture et le bulletin de la boucle candidat, juste après le masquage (les
    // retenues sont lues en direct par la recherche ; le bulletin part quelques minutes après). Le masquage ne part
    // jamais sans lui : un bulletin non calculé ou non remis rend le RUN rouge.
    let coverageFailed = false;
    try {
      const { runCoverageReview } = await import('./coverage/coverageReview.js');
      if (!coverageBefore) throw new Error('coverage: the state before the RUN steps could not be read');
      const coverage = await runCoverageReview(prisma, { runId: log.runId() ?? null, probe, before: coverageBefore });
      coverageFailed = !coverage.sent;
      await log.info('coverage.reviewed', { written: coverage.written, sent: coverage.sent, referenceRuns: coverage.evaluation.referenceRuns,
        findings: coverage.evaluation.findings.map(f => ({ scope: f.scope, key: f.key, label: f.label, kind: f.kind, cause: f.cause,
          gravity: f.gravity, lost: f.lost, reference: f.reference, ongoing: f.ongoing })) });
    } catch (error) {
      coverageFailed = true;
      log.assertHealthy();
      await log.error('coverage.failed', { error });
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
    if (!summary.executionHealthy || (orchestration.incidents.length > 0 && !alerted) || coverageFailed) {
      fatalFailure = true;
      await log.error('command.failed', { blockingReasons: summary.blockingReasons,
        alertDeliveryFailed: orchestration.incidents.length > 0 && !alerted, coverageFailed });
      process.exitCode = 1;
    }
  } else if (command === 'ingest-light') {
    /**
     * R-143 §1, D-517 — la passe de découverte (`pipeline/lightPass.ts`) : chaque source significative (au moins une
     * publication nouvelle sur 7 jours), en lecture incrémentale — la liste, le détail du seul neuf, l'écriture du seul
     * neuf, avec les règles du RUN sur ce neuf (retenues, fin déclarée par l'éditeur). Jamais une preuve d'absence : rien
     * de connu n'est fermé, retenu ni masqué. Refusée dans la fenêtre du RUN et pendant un RUN ; bornée à 90 minutes. Une source en échec reste visible au bilan et dans SourceRun ; le RUN suivant la
     * recollecte, aucune alerte n'est envoyée pour elle.
     */
    const { runLightPass, lightPassHasIncidents } = await import('./pipeline/lightPass.js');
    const pass = await runLightPass(prisma, { runId: observation.runId });
    sourceIncidents = lightPassHasIncidents(pass);
    await log.info('command.result', { ok: !sourceIncidents, command, refused: pass.refused, stoppedBy: pass.stoppedBy,
      collected: pass.collected.length, notCollected: pass.notCollected, ignored: pass.unknown, qualificationDue: pass.qualificationDue, created: pass.created,
      okSources: pass.ok, failed: pass.failed, timedOut: pass.timedOut, failures: pass.failures });
  } else if (command === 'availability') {
    /** R-143 §2 — la revue de disponibilité seule ; `--dry-run` rend le plan sans rien écrire. Sans lui, le bulletin de
     * couverture part comme au RUN (D-516 §2) : une retenue posée hors RUN ne part jamais sans lui. */
    const dryRun = process.argv.includes('--dry-run');
    const { runAvailabilityReview } = await import('./pipeline/availability.js');
    const { review, coverageSent } = await maskingCommand(() => runAvailabilityReview(prisma, { dryRun }), dryRun)
      .then(({ result, sent }) => ({ review: result, coverageSent: sent }));
    await log.info('command.result', { ok: coverageSent, command, dryRun: review.dryRun, released: review.released, held: review.held, coverageSent,
      sources: review.sources.filter(source => source.missed > 0 || source.held > 0) });
    if (!coverageSent) process.exitCode = 1;
  } else if (command === 'coverage') {
    /** R-143 §11 — l'alerte de couverture et le bulletin de la boucle, rejoués sans photographie ni e-mail. */
    const { runCoverageReview } = await import('./coverage/coverageReview.js');
    const { bulletinSubject, bulletinText } = await import('./coverage/coverageBulletin.js');
    const review = await runCoverageReview(prisma, { dryRun: true });
    await log.info('command.result', { ok: true, command, dryRun: true, subject: bulletinSubject(review.evaluation),
      referenceRuns: review.evaluation.referenceRuns, lines: bulletinText(review.evaluation, review.indicators) });
  } else if (command === 'probe-apply-links') {
    /** R-143 §2 — une passe de la sonde des liens « Postuler » ; `--dry-run` lit les pages sans rien écrire. Sans lui, le
     * bulletin de couverture part comme au RUN (D-516 §2). */
    const dryRun = process.argv.includes('--dry-run');
    const { runApplyLinkProbe } = await import('./pipeline/applyLinkProbe.js');
    const limit = Number(process.argv.find(arg => arg.startsWith('--limit='))?.slice('--limit='.length) ?? APPLY_LINK_PROBE_LIMIT);
    const { probe, coverageSent } = await maskingCommand(() => runApplyLinkProbe(prisma, { limit, dryRun }), dryRun, result => result)
      .then(({ result, sent }) => ({ probe: result, coverageSent: sent }));
    await log.info('command.result', { ok: coverageSent, command, dryRun: probe.dryRun, probed: probe.probed, held: probe.held, byVerdict: probe.byVerdict,
      coverageSent, results: probe.results.map(result => ({ sourceKey: result.sourceKey, url: result.url, verdict: result.reading.verdict, reason: result.reading.reason })) });
    if (!coverageSent) process.exitCode = 1;
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
     * lance toutes les heures (D-474), sur GO de production.
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
     * abandoned Flux B board): marks the source RETIRED, deactivates its JobSource
     * rows, withdraws (`WITHDRAWN`, `SOURCE_RETIRED`) the jobs nothing else backs and
     * reassigns canonical URLs it owned. No row is deleted (`withdrawRetiredSource`),
     * but the withdrawal is administrative: a later collection does not republish
     * the job by itself (`administrativeWithdrawal`, dedup/upsert.ts). The key must be explicit.
     */
    const key = process.argv[3];
    if (!key || key.startsWith('--')) throw new Error('retire-source needs the sourceKey to retire');
    // `--external-prefix=https://` : ne retirer qu'une ROUTE d'une clé qui en
    // porte deux (kering : flux Eightfold vivant + sitemap périmée), voir RetireOptions.
    const externalIdPrefix = process.argv.find((a) => a.startsWith('--external-prefix='))?.slice('--external-prefix='.length);
    await log.info('command.result', { ok: true, command, externalIdPrefix, ...(await retireSource(prisma, key, { externalIdPrefix })) });
  } else if (command === 'consolidate-publications' || command === 'attach-maisons' || command === 'qualify-sectors') {
    /**
     * R-143 §4 et §5 (D-513), deux réparations relues en deux temps.
     *  - Aperçu (sans `--apply`) : rien n'est écrit ; `--output=<fichier>` garde l'aperçu complet, à relire.
     *  - Application : `--apply --plan=<fichier relu>` applique CE fichier et lui seul ; l'aperçu est recalculé et la
     *    commande refuse, sans rien écrire, s'il en diffère (REVIEWED_PLAN_MISMATCH).
     * `consolidate-publications` réunit les offres actives d'un même employeur qui portent la même clé native
     * (`dedup/consolidate.ts`, `--limit=<n>` groupes par passage, 500 par défaut) ; `attach-maisons` rattache les entités
     * juridiques prouvées à leur Maison (`identity/maisonPlan.ts`), signé du commit de l'image déployée.
     * `qualify-sectors` (D-519) reconnaît le secteur des Maisons sur preuves (`sectors/recognize.ts`) et l'écrit par la
     * revue de secteur relue (`sectors/review.ts`) ; à appliquer AVANT un nouvel aperçu de `attach-maisons`.
     * Jamais pendant le RUN de 18 h.
     */
    const { readFile, writeFile } = await import('node:fs/promises');
    const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    const apply = process.argv.includes('--apply'), output = arg('output'), planFile = arg('plan');
    if (apply === !planFile) throw new Error('--apply requires --plan=<reviewed preview file>, and --plan is only read by --apply');
    if (apply && output) throw new Error('--output belongs to the preview; --apply reads --plan');
    const reviewed = planFile ? JSON.parse(await readFile(planFile, 'utf8')) : undefined;
    const save = async (value: unknown) => { if (output) await writeFile(output, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); };
    const { objectStoreConfigured, objectStoreFromEnv } = await import('./retention/objectStore.js');
    const store = objectStoreConfigured() ? objectStoreFromEnv() : undefined;
    if (command === 'consolidate-publications') {
      const { applyReviewedConsolidation, previewConsolidation, DEFAULT_CONSOLIDATION_LIMIT } = await import('./dedup/consolidate.js');
      if (apply && arg('limit')) throw new Error('--apply reuses the limit recorded in the reviewed file');
      if (!apply) {
        const file = await previewConsolidation(prisma, { limit: Number(arg('limit') ?? DEFAULT_CONSOLIDATION_LIMIT), store });
        await save(file);
        await log.info('command.result', { ok: file.refused.length === 0, command, apply, limit: file.limit, planned: file.groups.length,
          refused: file.refused.length, refusedSample: file.refused.slice(0, 20), output });
      } else {
        const report = await applyReviewedConsolidation(prisma, reviewed, { store });
        await log.info('command.result', { ok: report.refused.length === 0, command, apply, ...report, refused: report.refused.length, refusedSample: report.refused.slice(0, 20) });
      }
    } else if (command === 'qualify-sectors') {
      const { applySectorRecognition, previewSectorRecognition } = await import('./sectors/recognize.js');
      if (!apply) {
        const file = await previewSectorRecognition(prisma);
        await save(file);
        await log.info('command.result', { ok: true, command, apply, proposals: file.proposals.length,
          offers: file.proposals.reduce((n, p) => n + p.servies, 0), abstentions: file.abstentions.length, output });
      } else {
        const report = await applySectorRecognition(prisma, reviewed);
        await log.info('command.result', { ok: true, command, apply, ...report });
      }
    } else {
      const { attachMaisons } = await import('./identity/maisonPlan.js');
      const { deployedCommitHash } = await import('./capture/revision.js');
      const result = await attachMaisons(prisma, apply ? { reviewed, commitHash: deployedCommitHash() } : {});
      if (!apply && 'preview' in result) await save(result.preview);
      await log.info('command.result', { ok: result.refused.length === 0, command, apply, maisons: result.maisons, entities: result.entities,
        toCreate: result.toCreate, uncertain: result.uncertain.length, applied: result.applied, movedJobs: result.movedJobs, refused: result.refused.slice(0, 20), output });
    }
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
    // La surveillance Healthchecks est celle du RUN : une passe légère (R-143 §1) ne la touche jamais.
    if (observation && !['health-report', 'stats', 'export-companies', 'occupation-review-queue', 'consolidate-publications', 'attach-maisons', 'qualify-sectors', 'ingest-light', 'coverage'].includes(command)) {
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
