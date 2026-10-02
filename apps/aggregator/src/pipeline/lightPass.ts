/**
 * LA PASSE LÉGÈRE DE DÉCOUVERTE — R-143 §1 (D-513, 02/10/2026).
 *
 * « Une nouvelle offre importante ne doit pas arriver chez nous le lendemain si on peut raisonnablement la voir quelques
 * heures après sa publication. » Entre deux RUN, la passe collecte à nouveau les sources dont une collecte COMPLÈTE ne
 * coûte que quelques requêtes (une liste d'API, pas une page par offre), avec exactement l'étape du RUN
 * (`ingestOne` : accès, collecte scellée, écriture dédoublonnée, santé). Une nouvelle offre est écrite, mise en file
 * d'indexation par les déclencheurs de la base et servie dès la fin de sa source. Rien après la boucle : le géocodage
 * (carte, France seule, jusqu'à 2 000 appels) et la soumission à Google (quota partagé d'environ 200 par jour,
 * `googleIndexing.ts`, inactive en production faute de domaine configuré) restent au RUN, pour que la passe finisse
 * avec sa dernière source.
 *
 * CE QU'ELLE NE FAIT JAMAIS. Rien hors de sa propre lecture : ni refresh (preuve d'absence), ni revue de disponibilité
 * (R-143 §2), ni sonde des liens, ni garde de masse ; ces décisions restent au RUN, qui recollecte chaque source avant
 * de les prendre. Sur ce qu'elle lit, l'écrivain fait comme au RUN (`dedup/upsert.ts`) : une offre revue perd sa
 * retenue, et une fin déclarée par la source ou un retrait natif sur l'offre lue s'appliquent. Une collecte coupée par
 * la fenêtre est tronquée, donc sans droit d'attester (`attestingCapture.ts`), et aucune collecte de passe ne sert de
 * référence aux gardes du RUN (`referenceRuns.ts`).
 *
 * QUAND. Jamais dans la fenêtre du RUN (15:30-18:30 UTC), jamais pendant un RUN ni pendant une autre passe (lu dans
 * `PipelineRun`, revérifié avant chaque source) ; aucune source n'est commencée moins de 2 minutes avant son échéance
 * (45 minutes, jamais au-delà de 15:30 UTC) et chacune est bornée par ce qui reste : Railway saute
 * l'exécution suivante d'un cron encore en cours, une passe qui déborderait ferait sauter le RUN du jour.
 * La surveillance Healthchecks est celle du RUN : la passe ne la touche pas (`worker.ts`, `cli.ts`).
 *
 * LES SOURCES. Une liste relue, pas une règle lue à l'exécution dans le journal : la règle (au plus 200 requêtes et au
 * plus une requête pour cinq offres, collecte toujours complète sur les 7 RUN du 25/09 au 01/10, statut OK, moins de 10
 * minutes médianes, au moins une nouvelle offre par jour) et LVMH (128 requêtes Algolia pour 6 240 offres, 97 nouvelles
 * offres par jour ; DEGRADED par une annonce de test retenue sur preuve de l'éditeur et une énumération non déclarée,
 * donc sans droit d'attester), dans l'ordre des durées : la plus longue en dernier. La règle choisit par le COÛT, pas
 * par l'importance des offres : quelles Maisons méritent la fraîcheur reste une question du CEO, posée avec
 * l'activation. Mesures : `audits/2026-10-02/cadence-r143/`. Une clé absente du registre ou non ACTIVE est ignorée.
 */
import type { PrismaClient } from '@prisma/client';
import { inRunWindow } from '@catwalks/runtime';
import { assertPipelineRunning } from '../lib/pipelinePause.js';
import { log } from '../observability/logger.js';
import { ingestOne, type OrchestratorResult } from './ingestOrchestrator.js';
import { KIND_TO_ATS } from './ingest.js';

export const LIGHT_PASS_SOURCES: readonly string[] = Object.freeze([
  'ami-paris', 'figs', 'jojo-maman-bebe', 'gymshark', 'merkal', 'ephemera', 'monica-vinader', 'soeur', 'kiko-milano',
  'singularu', 'browns', 'kult-olymp-hades', 'eram-3', 'jeans-centre', 'ms-mode', 'my-jewellery', 'boggi-milano',
  'white-stuff', 'brilliant-earth', 'reformation', 'suitsupply', 'adopt-parfums', 'armand-thiery-flatchr', 'chalhoub',
  'space-nk', 'hans-anders', 'akira', 'clarkson-eyecare', 'etam', 'aroma-zone', 'lush', 'arcteryx', 'mejuri', 'normal',
  'element-6', 'galeries-lafayette', 'la-casa-de-las-carcasas', 'rituals', 'lovisa', 'lvmh',
]);
/** La durée maximale d'une passe ; mesurée en série : 23 minutes médianes (lvmh 10). */
export const LIGHT_PASS_BUDGET_MS = 45 * 60_000;
/** En deçà, une source n'est pas commencée : elle serait coupée avant d'écrire. */
export const LIGHT_PASS_MIN_SOURCE_MS = 2 * 60_000;
/** Un RUN ou une passe restés `RUNNING` au-delà (conteneur tué) ne bloquent plus. Le plus long RUN mesuré : 4 h 13. */
export const RUN_LOCK_HOURS = 12;
const RUN_WINDOW_START_UTC_MINUTES = 15 * 60 + 30;

export type RunningRun = { id: string; command: string; startedAt: Date };
export type LightPassRefusal = 'RUN_WINDOW' | 'RUN_IN_PROGRESS' | 'LIGHT_PASS_IN_PROGRESS';

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

export type LightPassResult = OrchestratorResult & {
  refused: LightPassRefusal | null;
  /** Arrêtée avant la fin de sa liste : la fenêtre, le budget ou un RUN qui a commencé. */
  stoppedBy: LightPassRefusal | 'DEADLINE' | null;
  collected: string[]; notCollected: string[]; unknown: string[]; created: number;
};

/**
 * La passe a-t-elle eu un incident de source ? La commande se termine alors COMPLETED_WITH_ERRORS (`cli.ts`), sans
 * alerte e-mail ni Healthchecks : le RUN suivant recollecte la source et porte, lui, l'alerte (D-453, D-480).
 */
export function lightPassHasIncidents(pass: Pick<LightPassResult, 'failed' | 'timedOut'>): boolean {
  return pass.failed + pass.timedOut > 0;
}

export async function runLightPass(prisma: PrismaClient, options: {
  runId: string | null; sources?: readonly string[]; now?: () => Date;
}): Promise<LightPassResult> {
  assertPipelineRunning();
  const now = options.now ?? (() => new Date());
  const wanted = [...(options.sources ?? LIGHT_PASS_SOURCES)];
  const result: LightPassResult = { total: 0, ok: 0, failed: 0, timedOut: 0, failures: [], incidents: [], issues: [],
    refused: null, stoppedBy: null, collected: [], notCollected: [], unknown: [], created: 0 };
  // `now` décide de la fenêtre et du budget ; les offres créées se comptent à l'horloge réelle des écritures.
  const writtenSince = new Date();
  const start = now();
  result.refused = lightPassRefusal(start, await runningRuns(prisma, options.runId));
  if (result.refused) {
    await log.warn('light.refused', { reason: result.refused });
    return { ...result, notCollected: wanted };
  }
  const deadline = lightPassDeadline(start);
  const registry = new Map((await prisma.source.findMany({ where: { key: { in: wanted }, status: 'ACTIVE' }, select: { key: true, kind: true } }))
    .filter(source => KIND_TO_ATS[source.kind]).map(source => [source.key, source.kind]));
  const keys = wanted.filter(key => registry.has(key));
  result.unknown = wanted.filter(key => !registry.has(key));
  result.total = keys.length;
  await log.info('light.sources_selected', { sources: keys.length, sourceKeys: keys, ignored: result.unknown, deadline: new Date(deadline).toISOString() });
  for (const [index, key] of keys.entries()) {
    const at = now();
    const stop = lightPassRefusal(at, await runningRuns(prisma, options.runId))
      ?? (deadline - at.getTime() < LIGHT_PASS_MIN_SOURCE_MS ? 'DEADLINE' : null);
    if (stop) {
      result.stoppedBy = stop;
      result.notCollected = keys.slice(index);
      await log.warn('light.stopped', { reason: stop, notCollected: result.notCollected });
      break;
    }
    assertPipelineRunning();
    await log.withContext({ sourceKey: key, connectorId: registry.get(key)! },
      () => ingestOne(prisma, key, result, deadline - at.getTime()));
    result.collected.push(key);
  }
  const created = await prisma.job.findMany({ where: { isActive: true, firstSeenAt: { gte: writtenSince } }, select: { id: true }, take: 500 });
  result.created = created.length;
  await log.info('light.completed', { collected: result.collected.length, ok: result.ok, failed: result.failed, timedOut: result.timedOut,
    stoppedBy: result.stoppedBy, notCollected: result.notCollected, created: result.created, failures: result.failures });
  return result;
}
