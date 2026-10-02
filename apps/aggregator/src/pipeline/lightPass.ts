/**
 * LA PASSE DE DÉCOUVERTE — R-143 §1, D-517 (02/10/2026).
 *
 * « Toutes les sources significatives découvertes en quelques heures ; le RUN quotidien devient le filet de sécurité,
 * pas le mécanisme principal de découverte. » Cinq fois par jour (01, 05, 09, 13, 21 UTC, `packages/runtime`), la passe lit chaque source qui a apporté
 * au moins une nouvelle offre dans la semaine, en LECTURE INCRÉMENTALE (`lib/incrementalReading.ts`) : la liste entière,
 * le détail des seules publications que la source n'avait jamais montrées, et l'écriture de ces seules publications,
 * par l'étape exacte du RUN (`ingestOne` : accès, collecte scellée et validée, écriture dédoublonnée). Une nouvelle
 * offre est servie et mise en file d'indexation dès la fin de sa source.
 *
 * LA SÉLECTION, PAR L'IMPORTANCE POUR LE CANDIDAT ET PAS PAR LE COÛT (D-517 remplace la règle de coût de la lecture
 * R-143 §1). Toute source qui a fait paraître au moins une publication nouvelle sur les 7 derniers jours
 * (`JobSource.firstSeenAt`) entre dans la passe, lue en base à chaque passe : une Maison qui se met à recruter y entre
 * d'elle-même, une source muette depuis une semaine en sort. Mesuré le 02/10/2026 (`audits/2026-10-02/fraicheur-d517/`) :
 * 285 sources, toutes les nouvelles publications. Un seuil plus haut n'économiserait presque rien : en lecture
 * incrémentale, une source calme ne coûte que sa liste (le seuil d'une par jour retenait 147 sources et 96,6 % des
 * nouvelles publications pour 6 470 requêtes par passe ; toutes, 8 160) et il écartait Audemars Piguet, Mulberry,
 * Zegna, Sisley, Patek Philippe, Breitling : le luxe calme est la promesse même. Les sources sont lues de la plus
 * productive à la moins productive, quatre à la fois (la porte par hôte borne le débit sur chaque site, comme au RUN).
 *
 * CE QU'ELLE NE FAIT JAMAIS. Rien sur ce qu'elle ne rend pas : une publication connue n'est ni relue, ni réécrite, ni
 * fermée, ni retenue ; la collecte est scellée `incremental`, jamais complète, jamais attestante, jamais crédible pour
 * la revue de disponibilité, jamais la référence d'une garde du RUN (`attestingCapture.ts`, `availability.ts`,
 * `referenceRuns.ts`), et sa santé ne se compare à rien et ne touche pas le résumé du catalogue (`health.ts`). Ni
 * refresh, ni revue de disponibilité, ni sonde, ni géocodage, ni soumission à Google, ni Healthchecks, ni alerte
 * e-mail : le RUN garde tout ce qui ferme, masque ou alerte.
 *
 * LA QUALIFICATION. Une collecte de passe validée rafraîchit la qualification native de sa source (24 h), comme toute
 * collecte validée : le RUN qui suit ne refait donc pas sa capture de qualification. Une source dont la qualification ou
 * l'autorisation d'accès expire dans l'heure n'est pas lue (`QUALIFICATION_DUE`) : la renouveler demanderait une lecture
 * complète, qui est le travail du RUN. Les sources à amorçage anti-robot (`WAF_BOOTSTRAP_SOURCES`, Ralph Lauren) restent
 * au RUN tant que D-483 et l'enquête de D-516 §1 jugent leurs collectes : une passe y ajouterait des amorçages.
 *
 * QUAND. Jamais dans la fenêtre du RUN (15:30-18:30 UTC), jamais pendant un RUN ni pendant une autre passe (lu dans
 * `PipelineRun`, revérifié avant chaque source) ; aucune source n'est commencée moins de 2 minutes avant l'échéance
 * (`LIGHT_PASS_BUDGET_MS`, jamais au-delà de 15:30 UTC), et chacune est bornée par ce qui reste : Railway saute
 * l'exécution suivante d'un cron encore en cours, une passe qui déborderait ferait sauter le RUN du jour.
 */
import type { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { inRunWindow } from '@catwalks/runtime';
import { assertPipelineRunning } from '../lib/pipelinePause.js';
import { log } from '../observability/logger.js';
import { withIncrementalPass } from '../lib/incrementalReading.js';
import { requireSourceValidation, SourceValidationGateError } from '../connectors/sourceCertification.js';
import { assertSourceAccess } from '../connectors/sourceAccess.js';
import { SourceAccessGateError } from '../connectors/accessScope.js';
import { WAF_BOOTSTRAP_SOURCES } from '../connectors/wafBootstrap.js';
import { ingestOne, type OrchestratorResult } from './ingestOrchestrator.js';
import { KIND_TO_ATS } from './ingest.js';

/** Une source est significative dès qu'elle a fait paraître une publication nouvelle sur `SIGNIFICANT_WINDOW_DAYS` jours. */
export const SIGNIFICANT_NEW_IN_WINDOW = 1;
export const SIGNIFICANT_WINDOW_DAYS = 7;
/**
 * La durée maximale d'une passe. Projetée le 02/10/2026 à environ 12 minutes pour la sélection en lecture
 * incrémentale, quatre sources à la fois (`audits/2026-10-02/fraicheur-d517/projection.out`, hors validation et
 * ouverture des collectes) ; 90 minutes laissent la marge d'un jour lent, et la passe de 13:00 finit avant 15:30.
 */
export const LIGHT_PASS_BUDGET_MS = 90 * 60_000;
/** En deçà, une source n'est pas commencée : elle serait coupée avant d'écrire. */
export const LIGHT_PASS_MIN_SOURCE_MS = 2 * 60_000;
/** Les sources lues en même temps ; la porte par hôte (`hostGate.ts`) borne le débit sur chaque site. */
export const LIGHT_PASS_CONCURRENCY = (raw => Number.isInteger(raw) && raw >= 1 && raw <= 16 ? raw : 4)(Number(process.env.LIGHT_PASS_SOURCE_CONCURRENCY ?? 4));
/** Une qualification ou une autorisation qui expire avant cette marge est laissée au RUN. */
export const QUALIFICATION_MARGIN_MS = 60 * 60_000;
/** Un RUN ou une passe restés `RUNNING` au-delà (conteneur tué) ne bloquent plus. Le plus long RUN mesuré : 4 h 13. */
export const RUN_LOCK_HOURS = 12;
const RUN_WINDOW_START_UTC_MINUTES = 15 * 60 + 30;

export type RunningRun = { id: string; command: string; startedAt: Date };
export type LightPassRefusal = 'RUN_WINDOW' | 'RUN_IN_PROGRESS' | 'LIGHT_PASS_IN_PROGRESS';
export type SignificantSource = { key: string; newPostings: number; perDay: number };

/** Pourquoi une passe ne peut pas (ou plus) travailler à `now`, vu les runs en cours qu'on lui donne ; null quand elle le peut. Pure. */
export function lightPassRefusal(now: Date, running: readonly RunningRun[]): LightPassRefusal | null {
  if (inRunWindow(now)) return 'RUN_WINDOW';
  if (running.some(run => run.command === 'ingest-all')) return 'RUN_IN_PROGRESS';
  if (running.some(run => run.command === 'ingest-light')) return 'LIGHT_PASS_IN_PROGRESS';
  return null;
}

/** La fin de la passe : son budget, et jamais au-delà de la prochaine ouverture de la fenêtre du RUN. Pure. */
export function lightPassDeadline(start: Date): number {
  const windowOpens = new Date(start);
  windowOpens.setUTCHours(0, RUN_WINDOW_START_UTC_MINUTES, 0, 0);
  if (windowOpens.getTime() <= start.getTime()) windowOpens.setUTCDate(windowOpens.getUTCDate() + 1);
  return Math.min(start.getTime() + LIGHT_PASS_BUDGET_MS, windowOpens.getTime());
}

/**
 * Lecture en base, PAS pure : le RUN et les passes en cours, hors la passe elle-même, à l'horloge réelle (celle des lignes `PipelineRun`). Un run
 * sans fin depuis plus de 12 h ne compte plus.
 */
export async function runningRuns(prisma: PrismaClient, selfId: string | null): Promise<RunningRun[]> {
  return prisma.pipelineRun.findMany({
    where: { command: { in: ['ingest-all', 'ingest-light'] }, finishedAt: null,
      startedAt: { gte: new Date(Date.now() - RUN_LOCK_HOURS * 3_600_000) }, ...(selfId ? { id: { not: selfId } } : {}) },
    select: { id: true, command: true, startedAt: true },
  });
}

/**
 * Les sources significatives (D-517), de la plus productive à la moins productive : ACTIVE, lisibles par un adaptateur,
 * au moins `SIGNIFICANT_NEW_IN_WINDOW` publication vue pour la première fois sur les `SIGNIFICANT_WINDOW_DAYS` derniers
 * jours. Le premier chargement d'une source est un stock, pas un flux : pour une
 * source enregistrée dans la fenêtre, le flux se compte à partir du lendemain de sa première publication, et il faut au
 * moins un jour de flux (Estée Lauder, Kering, PVH, enregistrées la veille de la mesure, y entrent ainsi dès le lendemain).
 */
/** Les sources laissées au RUN quelle que soit leur production : celles à amorçage anti-robot (D-483, D-516 §1). */
export const LEFT_TO_RUN: ReadonlySet<string> = new Set(Object.keys(WAF_BOOTSTRAP_SOURCES));

export async function significantSources(prisma: PrismaClient, now = new Date(), leftToRun: ReadonlySet<string> = LEFT_TO_RUN): Promise<SignificantSource[]> {
  const since = new Date(now.getTime() - SIGNIFICANT_WINDOW_DAYS * 24 * 3_600_000);
  const rows = await prisma.$queryRaw<{ key: string; kind: string; n: bigint; days: number }[]>`
    WITH bornes AS (SELECT (${since}::timestamptz AT TIME ZONE 'UTC') AS since, (${now}::timestamptz AT TIME ZONE 'UTC') AS t),
    debut AS (SELECT js."sourceKey", greatest(bornes.since, min(js."firstSeenAt") + interval '1 day') AS d FROM "JobSource" js, bornes GROUP BY 1, bornes.since),
    flux AS (SELECT js."sourceKey", count(*) AS n FROM "JobSource" js JOIN debut ON debut."sourceKey" = js."sourceKey", bornes
             WHERE js."firstSeenAt" >= debut.d AND js."firstSeenAt" < bornes.t GROUP BY 1)
    SELECT s.key, s.kind, flux.n, extract(epoch FROM (bornes.t - debut.d))::float8 / 86400 AS days
    FROM "Source" s JOIN flux ON flux."sourceKey" = s.key JOIN debut ON debut."sourceKey" = s.key, bornes
    WHERE s.status = 'ACTIVE' AND debut.d <= bornes.t - interval '1 day'`;
  return rows.map(row => ({ key: row.key, kind: row.kind, newPostings: Number(row.n), perDay: Number(row.n) / Number(row.days) }))
    .filter(row => KIND_TO_ATS[row.kind] && row.newPostings >= SIGNIFICANT_NEW_IN_WINDOW && !leftToRun.has(row.key))
    .sort((a, b) => b.perDay - a.perDay || a.key.localeCompare(b.key))
    .map(({ key, newPostings, perDay }) => ({ key, newPostings, perDay }));
}

/**
 * La qualification native et l'autorisation d'accès de la source tiendront-elles toute la lecture ? Sinon, la raison :
 * la renouveler demanderait une lecture complète, que seul le RUN fait. Lecture en base, à l'horloge réelle.
 */
export async function qualificationDue(prisma: PrismaClient, key: string, now = new Date()): Promise<string | null> {
  const source = await prisma.source.findUnique({ where: { key }, select: { key: true, currentRevisionId: true } });
  if (!source?.currentRevisionId) return 'REVISION_MISSING';
  const until = new Date(now.getTime() + QUALIFICATION_MARGIN_MS);
  try {
    await requireSourceValidation(prisma, source.currentRevisionId, until);
    const decision = await prisma.sourceAccessDecision.findFirst({ where: { sourceKey: key }, orderBy: { sequence: 'desc' } });
    assertSourceAccess({ key, currentRevisionId: source.currentRevisionId }, decision, until);
    return null;
  } catch (error) {
    // Seules les gardes de qualification et d'accès disent « laissée au RUN » ; toute autre erreur (base) est une panne.
    if (error instanceof SourceValidationGateError || error instanceof SourceAccessGateError) return error.code;
    throw error;
  }
}

export type LightPassResult = OrchestratorResult & {
  refused: LightPassRefusal | null;
  /** Arrêtée avant la fin de sa liste : la fenêtre, le budget ou un RUN qui a commencé. */
  stoppedBy: LightPassRefusal | 'DEADLINE' | null;
  collected: string[]; notCollected: string[]; unknown: string[]; created: number;
  /** Laissées au RUN : leur qualification ou leur autorisation expire avant la fin de la lecture (code de la garde). */
  qualificationDue: Array<{ source: string; code: string }>;
};

/**
 * La passe a-t-elle eu un incident de source ? La commande se termine alors COMPLETED_WITH_ERRORS (`cli.ts`), sans
 * alerte e-mail ni Healthchecks : le RUN suivant recollecte la source et porte, lui, l'alerte (D-453, D-480).
 */
export function lightPassHasIncidents(pass: Pick<LightPassResult, 'failed' | 'timedOut'>): boolean {
  return pass.failed + pass.timedOut > 0;
}

export async function runLightPass(prisma: PrismaClient, options: {
  runId: string | null; sources?: readonly string[]; now?: () => Date; concurrency?: number;
}): Promise<LightPassResult> {
  assertPipelineRunning();
  const now = options.now ?? (() => new Date());
  const result: LightPassResult = { total: 0, ok: 0, failed: 0, timedOut: 0, failures: [], incidents: [], issues: [],
    refused: null, stoppedBy: null, collected: [], notCollected: [], unknown: [], created: 0, qualificationDue: [] };
  // `now` décide de la fenêtre et du budget ; la sélection, la qualification et les offres créées se lisent à l'horloge réelle.
  const writtenSince = new Date();
  const start = now();
  result.refused = lightPassRefusal(start, await runningRuns(prisma, options.runId));
  if (result.refused) {
    await log.warn('light.refused', { reason: result.refused });
    return { ...result, notCollected: [...(options.sources ?? [])] };
  }
  const deadline = lightPassDeadline(start);
  const wanted = options.sources ? [...options.sources] : (await significantSources(prisma)).map(source => source.key);
  const registry = new Map((await prisma.source.findMany({ where: { key: { in: wanted }, status: 'ACTIVE' }, select: { key: true, kind: true } }))
    .filter(source => KIND_TO_ATS[source.kind]).map(source => [source.key, source.kind]));
  const keys = wanted.filter(key => registry.has(key));
  result.unknown = wanted.filter(key => !registry.has(key));
  result.total = keys.length;
  await log.info('light.sources_selected', { sources: keys.length, sourceKeys: keys, ignored: result.unknown, deadline: new Date(deadline).toISOString(),
    rule: options.sources ? 'EXPLICIT' : `D-517 ≥ ${SIGNIFICANT_NEW_IN_WINDOW} nouvelle sur ${SIGNIFICANT_WINDOW_DAYS} jours`, concurrency: LIGHT_PASS_CONCURRENCY });
  const limit = pLimit(Math.max(1, options.concurrency ?? LIGHT_PASS_CONCURRENCY));
  // allSettled : une panne inattendue n'abandonne pas les sources en cours ; la passe attend leur fin, puis échoue.
  const settled = await Promise.allSettled(keys.map(key => limit(async () => {
    if (result.stoppedBy) { result.notCollected.push(key); return; }
    const at = now();
    const stop = lightPassRefusal(at, await runningRuns(prisma, options.runId))
      ?? (deadline - at.getTime() < LIGHT_PASS_MIN_SOURCE_MS ? 'DEADLINE' : null);
    if (stop) {
      result.stoppedBy = stop;
      result.notCollected.push(key);
      await log.warn('light.stopped', { reason: stop, from: key });
      return;
    }
    const due = await qualificationDue(prisma, key);
    if (due) {
      result.qualificationDue.push({ source: key, code: due });
      await log.info('light.qualification_due', { sourceKey: key, code: due });
      return;
    }
    assertPipelineRunning();
    await log.withContext({ sourceKey: key, connectorId: registry.get(key)! },
      () => withIncrementalPass(() => ingestOne(prisma, key, result, deadline - at.getTime())));
    result.collected.push(key);
  })));
  const crashed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (crashed) throw crashed.reason;
  const created = await prisma.job.findMany({ where: { isActive: true, firstSeenAt: { gte: writtenSince } }, select: { id: true }, take: 5_000 });
  result.created = created.length;
  await log.info('light.completed', { collected: result.collected.length, ok: result.ok, failed: result.failed, timedOut: result.timedOut,
    stoppedBy: result.stoppedBy, notCollected: result.notCollected, qualificationDue: result.qualificationDue, created: result.created,
    failures: result.failures });
  return result;
}
