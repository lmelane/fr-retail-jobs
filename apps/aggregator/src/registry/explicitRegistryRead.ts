/**
 * D-520 §2 — la LECTURE du registre explicite (`explicitRegistry.ts`), sans dépendance au worker : vocabulaire, état lu
 * des sources, pause décidée, sources ambiguës. Extraite telle quelle (D-522 §5) pour que l'exposition des offres et la
 * console Agrégateur du back-office (API du catalogue) la lisent sans embarquer le retrait des publications ;
 * `explicitRegistry.ts` la réexporte.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { TRAJECTORIES } from '../pipeline/sourceState.js';

/** Ce que le registre veut de la source. */
export const SOURCE_INTENTIONS = ['COLLECTER', 'COUVERTE_AILLEURS', 'NE_PAS_COLLECTER', 'A_TRANCHER'] as const;
/** Les quatre sorties de D-520 §2, vocabulaire unique de l'état opérationnel (`pipeline/sourceState.ts`) : AUTO (revient
 * seule), A_REPARER, REVUE_HUMAINE, DECISION (exclusion ou pause décidée). */
export const SOURCE_TRAJECTORIES = TRAJECTORIES;
/** Ce qui fonde l'état : une décision (CEO ou propriétaire, datée), une règle validée, ou la seule preuve (aucune décision). */
export const STATUS_BASES = ['DECISION', 'REGLE', 'PREUVE'] as const;
export const STATUSES = ['DRAFT', 'VALIDATED', 'ACTIVE', 'PAUSED', 'RETIRED'] as const;

export type SourceIntention = typeof SOURCE_INTENTIONS[number];
export type SourceTrajectory = typeof SOURCE_TRAJECTORIES[number];
export type StatusBasis = typeof STATUS_BASES[number];
export type Status = typeof STATUSES[number];

/** L'état d'une source tel que l'aperçu le lit. */
export type RegistrySource = {
  key: string; status: Status; note: string | null; statusIntention: string | null; statusTrajectory: string | null;
  statusBasis: string | null; statusDecision: string | null; statusReason: string | null; statusNextAction: string | null;
  statusQuestion: string | null; statusReviewAt: string | null; statusExplainedFor: string | null; statusReviewId: string | null;
  activeJobs: number;
};

/** Le registre lu, pour l'aperçu : statut, note, explication courante et publications actives. */
export async function readRegistrySources(db: Prisma.TransactionClient | PrismaClient): Promise<RegistrySource[]> {
  const rows = await db.$queryRaw<(Omit<RegistrySource, 'activeJobs'> & { activeJobs: bigint })[]>`
    SELECT s.key, s.status::text AS status, s.note, s."statusIntention", s."statusTrajectory", s."statusBasis",
           s."statusDecision", s."statusReason", s."statusNextAction", s."statusQuestion",
           to_char(s."statusReviewAt", 'YYYY-MM-DD') AS "statusReviewAt", s."statusExplainedFor"::text AS "statusExplainedFor",
           s."statusReviewId",
           (SELECT count(*) FROM "JobSource" js WHERE js."sourceKey" = s.key AND js."isActive") AS "activeJobs"
      FROM "Source" s ORDER BY s.key`;
  return rows.map(r => ({ ...r, activeJobs: Number(r.activeJobs) }));
}

/**
 * Une pause posée par une décision (fondement DECISION, expliquée pour ce statut) : seule celle-là garde ses offres servies
 * hors du plafond de R-143 §2 (D-485, D-493, D-506). Une pause sans décision, ou pas encore expliquée, suit le masquage.
 */
export function pauseDecided(source: { status: string; statusBasis: string | null; statusExplainedFor: string | null }) {
  return source.status === 'PAUSED' && source.statusExplainedFor === 'PAUSED' && source.statusBasis === 'DECISION';
}

/**
 * Les sources dont l'état n'est pas expliqué : non ACTIVE sans explication, explication d'un autre statut (périmée),
 * ou pause dont la date de réexamen est passée. C'est la mesure de D-520 §2 ; elle doit rendre zéro.
 */
export type AmbiguousSource = { key: string; status: Status; why: 'UNEXPLAINED' | 'STALE_EXPLANATION' | 'REVIEW_OVERDUE' };
export function ambiguousSources(sources: readonly RegistrySource[], today: string): AmbiguousSource[] {
  return sources.flatMap((s): AmbiguousSource[] => {
    if (s.status === 'ACTIVE') return [];
    if (!s.statusReviewId) return [{ key: s.key, status: s.status, why: 'UNEXPLAINED' }];
    if (s.statusExplainedFor !== s.status) return [{ key: s.key, status: s.status, why: 'STALE_EXPLANATION' }];
    if (s.statusReviewAt && s.statusReviewAt < today) return [{ key: s.key, status: s.status, why: 'REVIEW_OVERDUE' }];
    return [];
  });
}
