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
 * ni rejetée). Mesuré le 02/10/2026 en production (lecture seule, `audits/2026-10-02/r143-disponibilite/`) : sur les
 * 86 547 offres servies, 10 310 étaient dans ce cas, presque toutes chez des sources qui lisent tout leur total annoncé
 * sans pouvoir prouver la fin de leur parcours (H&M 1 935 lues sur 1 935 annoncées, 2 839 en stock). Une collecte
 * ratée, inachevée ou partielle ne compte pas : une seule panne de RUN ne masque rien. Le plafond absolu de 72 h
 * (`CONFIRMATION_CEILING_HOURS`) prend le relais pour une source restée sans collecte crédible.
 *
 * UNE COLLECTE EST CRÉDIBLE (`collectionReconfirms`) quand elle est admise, scellée et achevée par la révision courante
 * (`readAttestingCapture`), de statut OK ou DEGRADED, non tronquée, qu'elle a lu au moins 90 % du total qu'elle annonce
 * (`ATTESTATION_MIN_COVERAGE`), qu'elle n'annonce pas zéro, et qu'elle n'a pas publié moins de la moitié de la collecte
 * productive précédente sauf chute confirmée par l'éditeur (D-484 §2). Et, garde par source, elle ne peut pas retenir plus
 * de la moitié d'un stock d'au moins 10 représentations (`RECONFIRMATION_MAX_SHARE`) : au-delà, c'est la collecte qui est
 * suspecte, pas la moitié des offres d'une Maison.
 *
 * LA RETENUE S'EFFACE dès que la source revoit la représentation : chaque écrivain qui la revoit l'efface
 * (`dedup/upsert.ts`), et cette revue efface celles que `lastSeenAt` a dépassées.
 */
import type { PrismaClient } from '@prisma/client';
import { assertPipelineRunning } from '../lib/pipelinePause.js';
import { objectStoreConfigured, objectStoreFromEnv } from '../retention/objectStore.js';
import { ATTESTATION_MIN_COVERAGE } from './attestation.js';
import { readAttestingCapture } from './attestingCapture.js';
import { seenByCapture } from './refreshEvidence.js';
import { MASS_ABSENCE_MIN_STOCK, type AttestationFacts } from './refreshPlan.js';

export const RECONFIRMATION_MAX_SHARE = 0.5;
const COLLAPSE_SHARE = 0.5;
export const RECONFIRMATION_READER = 'r143-reconfirmation/1';

/** Pourquoi cette collecte ne peut pas retirer d'offre de l'expérience ; null quand elle le peut. Pure. */
export function collectionReconfirms(facts: AttestationFacts): string | null {
  if (!['OK', 'DEGRADED'].includes(facts.status)) return `statut ${facts.status}`;
  if (facts.truncated) return 'collecte tronquée';
  if (facts.declaredTotal === 0) return 'zéro annoncé';
  if (facts.declaredTotal != null && facts.declaredTotal > 0 && facts.fetched / facts.declaredTotal < ATTESTATION_MIN_COVERAGE) {
    return `lecture partielle : ${facts.fetched} sur ${facts.declaredTotal} annoncées`;
  }
  if (facts.previous != null && facts.previous > 0 && facts.published < facts.previous * COLLAPSE_SHARE && !facts.confirmedDrop) {
    return `effondrement : ${facts.published} publiées contre ${facts.previous}`;
  }
  return null;
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
  sourceKey: string; stock: number; missed: number; held: number; alreadyHeld: number;
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
  const sources: SourceReview[] = [];
  let held = 0;
  for (const sourceKey of keys) {
    if (!dryRun) assertPipelineRunning();
    const now = new Date();
    const result = await readAttestingCapture(prisma, sourceKey, now, store);
    const rows = await prisma.jobSource.findMany({ where: { sourceKey, isActive: true },
      select: { id: true, externalId: true, lastSeenAt: true, availabilityHold: true, availabilityHoldAt: true } });
    const stillHeld = (row: typeof rows[number]) => !!row.availabilityHold && row.lastSeenAt < row.availabilityHoldAt!;
    const alreadyHeld = rows.filter(stillHeld).length;
    if (!result.ok) {
      sources.push({ sourceKey, stock: rows.length, missed: 0, held: 0, alreadyHeld, captureBatchId: result.captureBatchId,
        credible: false, reason: result.reasons.join(' ; ') });
      continue;
    }
    const { capture } = result;
    const seen = seenByCapture(new Set(capture.evidence.canonicalSet), capture.dispositions);
    const missed = rows.filter(row => row.lastSeenAt < capture.startedAt && !seen.has(row.externalId));
    const reason = reconfirmationVerdict({ facts: capture.facts, stock: rows.length, missed: missed.length });
    const toHold = reason ? [] : missed.filter(row => !stillHeld(row));
    let written = toHold.length;
    if (!dryRun && toHold.length) {
      // Only rows the source has still not seen since this collection started: a concurrent re-observation wins.
      written = (await prisma.jobSource.updateMany({
        where: { id: { in: toHold.map(row => row.id) }, isActive: true, lastSeenAt: { lt: capture.startedAt },
          OR: [{ availabilityHold: null }, { availabilityHoldAt: { lte: capture.startedAt } }] },
        data: { availabilityHold: 'NOT_RECONFIRMED', availabilityHoldAt: capture.startedAt,
          availabilityEvidence: { reader: RECONFIRMATION_READER, captureBatchId: capture.captureBatchId,
            collectionStartedAt: capture.startedAt.toISOString(), declaredTotal: capture.facts.declaredTotal,
            fetched: capture.facts.fetched, published: capture.facts.published } },
      })).count;
    }
    held += written;
    sources.push({ sourceKey, stock: rows.length, missed: missed.length, held: written, alreadyHeld,
      captureBatchId: capture.captureBatchId, credible: !reason, reason });
  }
  return { released: Number(released), held, sources, dryRun };
}
