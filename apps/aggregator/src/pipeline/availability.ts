/**
 * LA REVUE DE DISPONIBILITÉ DU RUN — R-143 §2 (D-513, 02/10/2026).
 *
 * « Quand on n'a plus suffisamment confiance dans une offre, je préfère qu'on la retire temporairement de l'expérience
 * candidat plutôt que de servir un lien mort. » Ce module ne ferme rien : il pose ou lève une RETENUE DE
 * DISPONIBILITÉ sur une représentation (`JobSource.availabilityHold`), que le filtre public lit
 * (`packages/db/availability.ts`). Le cycle de vie (refresh, preuve d'absence) n'en dépend pas.
 *
 * LE SEUIL EST RELATIF À LA SOURCE, PAS ABSOLU. Une représentation est NOT_RECONFIRMED quand la dernière collecte de sa
 * source est CRÉDIBLE, a commencé après sa dernière observation, et ne l'a pas vue (ni publiée, ni retenue, ni écartée,
 * ni rejetée). Mesures du 02/10/2026 en production (lecture seule) : `audits/2026-10-02/r143-disponibilite/README.md`.
 * Une collecte ratée, inachevée ou partielle ne compte pas : une seule panne de RUN ne masque rien.
 *
 * LE PLAFOND (72 h, `CONFIRMATION_CEILING_HOURS`) prend le relais pour une source ACTIVE restée sans collecte crédible :
 * deux RUN manqués de suite. Il est posé par ce RUN, jamais lu à l'horloge par la requête publique : un RUN arrêté ne
 * retire rien. Une source en PAUSE garde ses offres servies SEULEMENT si sa pause a été posée par une décision (D-485,
 * D-493, D-506) : le registre explicite le dit (`registry/explicitRegistry.ts`, `pauseDecided`, D-520 §2). Une pause sans
 * décision (pause « historique », ou pas encore expliquée) suit le plafond comme une source ACTIVE : ses offres non
 * revues depuis 72 h sortent de l'expérience candidat (le 02/10 : Sioux 19, Fastrack 15, non revues depuis le 18-19/09).
 *
 * UNE COLLECTE EST CRÉDIBLE (`collectionReconfirms`) quand elle est admise, scellée et achevée par la révision courante
 * (`readAttestingCapture`), de statut OK ou DEGRADED, non tronquée, sans parcours déclaré incomplet (`complete=false`,
 * dont un total plafonné), avec un parcours prouvé complet OU au moins 90 % d'un total annoncé non nul lu
 * (`ATTESTATION_MIN_COVERAGE`), et sans effondrement face à la collecte productive précédente sauf chute confirmée par
 * l'éditeur (D-484 §2). Et, garde par source, elle ne peut pas retenir plus de la moitié d'un stock d'au moins 10
 * représentations (`RECONFIRMATION_MAX_SHARE`) : au-delà, c'est la collecte qui est suspecte.
 *
 * LA RETENUE S'EFFACE dès que la source revoit la représentation : chaque écrivain qui la revoit l'efface
 * (`dedup/upsert.ts`), et cette revue efface celles que `lastSeenAt` a dépassées.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { assertPipelineRunning } from '../lib/pipelinePause.js';
import { objectStoreConfigured, objectStoreFromEnv } from '../retention/objectStore.js';
import { ATTESTATION_MIN_COVERAGE } from './attestation.js';
import { readAttestingCapture } from './attestingCapture.js';
import { seenByCapture } from './refreshEvidence.js';
import { MASS_ABSENCE_MIN_STOCK, type AttestationFacts } from './refreshPlan.js';
import { pauseDecided } from '../registry/explicitRegistry.js';

export const RECONFIRMATION_MAX_SHARE = 0.5;
export const CONFIRMATION_CEILING_HOURS = 72;
const COLLAPSE_SHARE = 0.5;
export const RECONFIRMATION_READER = 'r143-reconfirmation/1';

/** Pourquoi cette collecte ne peut pas retirer d'offre de l'expérience ; null quand elle le peut. Pure. */
export function collectionReconfirms(facts: AttestationFacts): string | null {
  if (!['OK', 'DEGRADED'].includes(facts.status)) return `statut ${facts.status}`;
  if (facts.truncated) return 'collecte tronquée';
  if (facts.declaredTotal === 0) return 'zéro annoncé';
  if (facts.complete === false) return 'parcours déclaré incomplet';
  if (facts.complete !== true) {
    if (facts.declaredTotal == null || facts.declaredTotal <= 0) return 'ni parcours prouvé, ni total annoncé';
    if (facts.fetched / facts.declaredTotal < ATTESTATION_MIN_COVERAGE) return `lecture partielle : ${facts.fetched} sur ${facts.declaredTotal} annoncées`;
  }
  if (facts.previous != null && facts.previous > 0 && facts.published < facts.previous * COLLAPSE_SHARE && !facts.confirmedDrop) {
    return `effondrement : ${facts.published} publiées contre ${facts.previous}`;
  }
  return null;
}

/** Only rows the source has still not seen since `at`: a concurrent re-observation wins. */
async function hold(prisma: PrismaClient, ids: string[], at: Date, evidence: Record<string, unknown>): Promise<number> {
  if (!ids.length) return 0;
  return (await prisma.jobSource.updateMany({
    where: { id: { in: ids }, isActive: true, lastSeenAt: { lt: at }, OR: [{ availabilityHold: null }, { availabilityHoldAt: { lte: at } }] },
    data: { availabilityHold: 'NOT_RECONFIRMED', availabilityHoldAt: at, availabilityEvidence: evidence as Prisma.InputJsonValue },
  })).count;
}

/** La collecte crédible, puis la garde par source sur la part du stock qu'elle retiendrait. Pure. */
export function reconfirmationVerdict(input: { facts: AttestationFacts; stock: number; missed: number }): string | null {
  const collection = collectionReconfirms(input.facts);
  if (collection) return collection;
  if (input.stock >= MASS_ABSENCE_MIN_STOCK && input.missed > input.stock * RECONFIRMATION_MAX_SHARE) {
    return `anomalie : la collecte retiendrait ${input.missed} représentations sur ${input.stock}`;
  }
  return null;
}

export type SourceReview = {
  sourceKey: string; status: string | null; stock: number; missed: number; held: number; ceilingHeld: number; alreadyHeld: number;
  captureBatchId: string | null; credible: boolean; reason: string | null;
};
export type AvailabilityReview = { released: number; held: number; sources: SourceReview[]; dryRun: boolean };

/**
 * Pose les retenues NOT_RECONFIRMED et lève celles que la source a dépassées. `dryRun` ne fait aucune écriture et rend
 * le même plan. `onlyKeys` borne les sources revues ; la levée des retenues dépassées est toujours globale (elle ne
 * peut que rendre des offres au candidat, et seulement celles que leur source a revues).
 */
export async function runAvailabilityReview(prisma: PrismaClient, options: { dryRun?: boolean; onlyKeys?: string[] } = {}): Promise<AvailabilityReview> {
  const dryRun = options.dryRun === true;
  if (!dryRun) assertPipelineRunning();
  const released = dryRun
    ? (await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "JobSource" WHERE "availabilityHold" IS NOT NULL AND "lastSeenAt" >= "availabilityHoldAt"`)[0].n
    : await prisma.$executeRaw`
        UPDATE "JobSource" SET "availabilityHold" = NULL, "availabilityHoldAt" = NULL, "availabilityEvidence" = NULL
        WHERE "availabilityHold" IS NOT NULL AND "lastSeenAt" >= "availabilityHoldAt"`;
  const keys = (await prisma.jobSource.groupBy({ by: ['sourceKey'], where: { isActive: true,
    ...(options.onlyKeys ? { sourceKey: { in: options.onlyKeys } } : {}) } })).map(row => row.sourceKey).sort();
  const store = objectStoreConfigured() ? objectStoreFromEnv() : undefined;
  const registry = new Map((await prisma.source.findMany({ where: { key: { in: keys } },
    select: { key: true, status: true, statusBasis: true, statusExplainedFor: true } })).map(source => [source.key, source]));
  const sources: SourceReview[] = [];
  let held = 0;
  for (const sourceKey of keys) {
    if (!dryRun) assertPipelineRunning();
    const now = new Date();
    const source = registry.get(sourceKey);
    const status = source?.status ?? null;
    const result = await readAttestingCapture(prisma, sourceKey, now, store);
    const rows = await prisma.jobSource.findMany({ where: { sourceKey, isActive: true },
      select: { id: true, externalId: true, lastSeenAt: true, availabilityHold: true, availabilityHoldAt: true } });
    const stillHeld = (row: typeof rows[number]) => !!row.availabilityHold && row.lastSeenAt < row.availabilityHoldAt!;
    const alreadyHeld = rows.filter(stillHeld).length;
    let missed: typeof rows = [], reason: string | null, captureBatchId: string | null, written = 0;
    if (!result.ok) {
      reason = result.reasons.join(' ; '); captureBatchId = result.captureBatchId;
    } else {
      const { capture } = result;
      captureBatchId = capture.captureBatchId;
      const seen = seenByCapture(new Set(capture.evidence.canonicalSet), capture.dispositions);
      missed = rows.filter(row => row.lastSeenAt < capture.startedAt && !seen.has(row.externalId));
      reason = reconfirmationVerdict({ facts: capture.facts, stock: rows.length, missed: missed.length });
      const toHold = reason ? [] : missed.filter(row => !stillHeld(row));
      written = dryRun ? toHold.length : await hold(prisma, toHold.map(row => row.id), capture.startedAt, {
        reader: RECONFIRMATION_READER, rule: 'MISSED_BY_CREDIBLE_COLLECTION', captureBatchId: capture.captureBatchId,
        collectionStartedAt: capture.startedAt.toISOString(), declaredTotal: capture.facts.declaredTotal,
        fetched: capture.facts.fetched, published: capture.facts.published });
    }
    // Le plafond : une source ACTIVE, ou en pause sans décision, qui n'a plus revu la représentation depuis 72 h.
    const ceiling = new Date(now.getTime() - CONFIRMATION_CEILING_HOURS * 3_600_000);
    const ceilingApplies = status === 'ACTIVE' || (status === 'PAUSED' && !pauseDecided(source!));
    const stale = ceilingApplies ? rows.filter(row => row.lastSeenAt < ceiling && !stillHeld(row) && !missed.includes(row)) : [];
    const ceilingHeld = dryRun ? stale.length : await hold(prisma, stale.map(row => row.id), now, {
      reader: RECONFIRMATION_READER, rule: 'CEILING_72H', ceiling: ceiling.toISOString(), lastCollection: captureBatchId });
    held += written + ceilingHeld;
    sources.push({ sourceKey, status, stock: rows.length, missed: missed.length, held: written, ceilingHeld, alreadyHeld,
      captureBatchId, credible: result.ok && !reason, reason });
  }
  return { released: Number(released), held, sources, dryRun };
}
