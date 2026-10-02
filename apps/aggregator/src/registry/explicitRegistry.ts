import { Prisma, type PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { withdrawRetiredSource } from '../pipeline/deactivateSources.js';
import { lockSourceWrites } from '../lib/writeLocks.js';
import { TRAJECTORIES } from '../pipeline/sourceState.js';

/**
 * D-520 §2 — LE REGISTRE EXPLICITE : « une source qui n'est pas opérationnelle doit toujours avoir une raison explicite
 * et une trajectoire : soit elle revient automatiquement, soit il y a quelque chose à réparer, soit une revue est
 * réellement nécessaire, soit nous décidons explicitement de ne plus la collecter ». Aucune source dans un état ambigu.
 *
 * Une source non ACTIVE est expliquée par un fichier relu (`registre-explicite/1`) : intention, motif dans les mots de sa
 * décision, fondement (DECISION du CEO, REGLE validée, ou PREUVE seule : dit tel quel), trajectoire, prochaine action,
 * date de réexamen pour une pause ou une revue humaine. Deux temps, comme `attach-maisons` et `qualify-sectors` :
 *  - aperçu : rien n'est écrit ; il refuse une source inconnue, ACTIVE, dont le statut a changé, ou une source non
 *    ACTIVE absente du fichier (le registre doit être complet) ;
 *  - application du SEUL aperçu relu : l'aperçu est recalculé sous verrou et l'application refuse, sans rien écrire,
 *    s'il diffère (REVIEWED_PLAN_MISMATCH). Elle écrit une SourceRegistryReview immuable, l'explication sur chaque
 *    source, et retire par le mécanisme existant (R-142 §2) une source PAUSED, DRAFT ou VALIDATED dont l'état cible
 *    est RETIRED. Elle ne rouvre jamais une source : une reprise passe par la qualification (campagne).
 */

export const REGISTRY_PLAN_KIND = 'registre-explicite/1';
export const REGISTRY_PREVIEW_KIND = 'registre-explicite-apercu/1';
/** Ce que le registre veut de la source. */
export const SOURCE_INTENTIONS = ['COLLECTER', 'COUVERTE_AILLEURS', 'NE_PAS_COLLECTER', 'A_TRANCHER'] as const;
/** Les quatre sorties de D-520 §2, vocabulaire unique de l'état opérationnel (`pipeline/sourceState.ts`) : AUTO (revient
 * seule), A_REPARER, REVUE_HUMAINE, DECISION (exclusion ou pause décidée). */
export const SOURCE_TRAJECTORIES = TRAJECTORIES;
/** Ce qui fonde l'état : une décision (CEO ou propriétaire, datée), une règle validée, ou la seule preuve (aucune décision). */
export const STATUS_BASES = ['DECISION', 'REGLE', 'PREUVE'] as const;
const STATUSES = ['DRAFT', 'VALIDATED', 'ACTIVE', 'PAUSED', 'RETIRED'] as const;

export type SourceIntention = typeof SOURCE_INTENTIONS[number];
export type SourceTrajectory = typeof SOURCE_TRAJECTORIES[number];
export type StatusBasis = typeof STATUS_BASES[number];
type Status = typeof STATUSES[number];

export type RegistryEntry = {
  key: string; maison: string; currentStatus: Status; intention: SourceIntention; targetStatus: Status;
  trajectory: SourceTrajectory; basis: StatusBasis; decision: string; reason: string; nextAction: string;
  reviewAt: string | null; question: string | null;
};
export type RegistryPlan = { kind: typeof REGISTRY_PLAN_KIND; reviewer: string; observedAt?: string; entries: RegistryEntry[] };
/** L'état d'une source tel que l'aperçu le lit. */
export type RegistrySource = {
  key: string; status: Status; note: string | null; statusIntention: string | null; statusTrajectory: string | null;
  statusBasis: string | null; statusDecision: string | null; statusReason: string | null; statusNextAction: string | null;
  statusQuestion: string | null; statusReviewAt: string | null; statusExplainedFor: string | null; statusReviewId: string | null;
  activeJobs: number;
};
export type RegistryRefusal = { key: string; code: 'UNKNOWN_SOURCE' | 'ACTIVE_SOURCE' | 'STATUS_CHANGED' | 'NOT_IN_PLAN'; detail?: string };
export type RegistryPreview = {
  kind: typeof REGISTRY_PREVIEW_KIND; plan: RegistryPlan; before: RegistrySource[];
  retirements: { key: string; from: Status; activeJobs: number }[]; refused: RegistryRefusal[]; hash: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const isDay = (v: unknown) => typeof v === 'string' && DAY.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/** Contrôle d'un fichier relu ; refuse en nommant chaque défaut, jamais en silence. */
export function validateRegistryPlan(raw: unknown): RegistryPlan {
  const plan = raw as RegistryPlan;
  if (plan?.kind !== REGISTRY_PLAN_KIND || !text(plan.reviewer) || !Array.isArray(plan.entries)) {
    throw new Error(`REVIEWED_PLAN_INVALID: a ${REGISTRY_PLAN_KIND} file with a reviewer and entries is required`);
  }
  const problems: string[] = [], seen = new Set<string>();
  for (const e of plan.entries) {
    const p = (m: string) => problems.push(`${e?.key ?? '?'}: ${m}`);
    if (!text(e?.key)) { p('key missing'); continue; }
    if (seen.has(e.key)) p('listed twice');
    seen.add(e.key);
    if (!SOURCE_INTENTIONS.includes(e.intention)) p(`intention ${e.intention} unknown`);
    if (!SOURCE_TRAJECTORIES.includes(e.trajectory)) p(`trajectory ${e.trajectory} unknown`);
    if (!STATUS_BASES.includes(e.basis)) p(`basis ${e.basis} unknown`);
    if (!STATUSES.includes(e.currentStatus) || !STATUSES.includes(e.targetStatus)) p('status unknown');
    if (e.targetStatus === 'ACTIVE' || e.currentStatus === 'ACTIVE') p('an ACTIVE source is not explained here; reopening goes through qualification');
    if (e.targetStatus !== e.currentStatus && e.targetStatus !== 'RETIRED') p(`transition ${e.currentStatus} -> ${e.targetStatus} refused`);
    if (e.currentStatus === 'RETIRED' && e.targetStatus !== 'RETIRED') p('a RETIRED source is never reopened by the registry');
    for (const field of ['maison', 'decision', 'reason', 'nextAction'] as const) if (!text(e[field])) p(`${field} missing`);
    if (e.reviewAt !== null && !isDay(e.reviewAt)) p(`reviewAt ${e.reviewAt} is not a YYYY-MM-DD day`);
    if (e.targetStatus === 'PAUSED' && !e.reviewAt) p('a pause needs its review date');
    if (e.trajectory === 'DECISION' && e.targetStatus !== 'RETIRED' && e.basis !== 'DECISION') p('a DECISION trajectory is an exclusion (RETIRED) or a pause a decision posed');
    if (e.targetStatus === 'RETIRED' && e.trajectory === 'AUTO') p('a RETIRED source never comes back by itself');
    if ((e.trajectory === 'REVUE_HUMAINE') !== (e.intention === 'A_TRANCHER')) p('REVUE_HUMAINE and A_TRANCHER go together');
    if (e.trajectory === 'REVUE_HUMAINE' && (!text(e.question) || !e.reviewAt)) p('a human review needs its question and its date');
    if ((e.intention === 'COUVERTE_AILLEURS' || e.intention === 'NE_PAS_COLLECTER') && (e.trajectory !== 'DECISION' || e.targetStatus !== 'RETIRED')) p(`${e.intention} is an exclusion (DECISION, RETIRED)`);
  }
  if (problems.length) throw new Error(`REVIEWED_PLAN_INVALID: ${problems.slice(0, 20).join('; ')}${problems.length > 20 ? ` (+${problems.length - 20})` : ''}`);
  return plan;
}

const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable((v as Record<string, unknown>)[k])])) : v;
export const registryHash = (v: unknown) => createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');

/** L'aperçu pur : le fichier relu confronté au registre lu. Aucun effet. */
export function previewRegistry(raw: unknown, sources: readonly RegistrySource[]): RegistryPreview {
  const plan = validateRegistryPlan(raw);
  const byKey = new Map(sources.map(s => [s.key, s]));
  const planned = new Set(plan.entries.map(e => e.key));
  const refused: RegistryRefusal[] = [];
  for (const e of plan.entries) {
    const s = byKey.get(e.key);
    if (!s) refused.push({ key: e.key, code: 'UNKNOWN_SOURCE' });
    else if (s.status === 'ACTIVE') refused.push({ key: e.key, code: 'ACTIVE_SOURCE' });
    else if (s.status !== e.currentStatus) refused.push({ key: e.key, code: 'STATUS_CHANGED', detail: `${e.currentStatus} reviewed, ${s.status} now` });
  }
  for (const s of sources) if (s.status !== 'ACTIVE' && !planned.has(s.key)) refused.push({ key: s.key, code: 'NOT_IN_PLAN', detail: s.status });
  const entries = [...plan.entries].sort((a, b) => a.key.localeCompare(b.key));
  const before = entries.flatMap(e => byKey.get(e.key) ?? []);
  const retirements = entries.filter(e => e.targetStatus === 'RETIRED' && byKey.get(e.key)?.status !== 'RETIRED' && byKey.has(e.key))
    .map(e => ({ key: e.key, from: byKey.get(e.key)!.status, activeJobs: byKey.get(e.key)!.activeJobs }));
  refused.sort((a, b) => a.key.localeCompare(b.key) || a.code.localeCompare(b.code));
  const normalized: RegistryPlan = { ...plan, entries };
  return { kind: REGISTRY_PREVIEW_KIND, plan: normalized, before, retirements, refused,
    hash: registryHash({ plan: normalized, before, retirements, refused }) };
}

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

export async function previewRegistryReview(db: PrismaClient, raw: unknown): Promise<RegistryPreview> {
  validateRegistryPlan(raw);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return previewRegistry(raw, await readRegistrySources(tx));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 });
}

/**
 * Les sources dont l'état n'est pas expliqué : non ACTIVE sans explication, explication d'un autre statut (périmée),
 * ou pause dont la date de réexamen est passée. C'est la mesure de D-520 §2 ; elle doit rendre zéro.
 */
/**
 * Une pause posée par une décision (fondement DECISION, expliquée pour ce statut) : seule celle-là garde ses offres servies
 * hors du plafond de R-143 §2 (D-485, D-493, D-506). Une pause sans décision, ou pas encore expliquée, suit le masquage.
 */
export function pauseDecided(source: { status: string; statusBasis: string | null; statusExplainedFor: string | null }) {
  return source.status === 'PAUSED' && source.statusExplainedFor === 'PAUSED' && source.statusBasis === 'DECISION';
}

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

export async function applyRegistryReview(db: PrismaClient, reviewed: unknown) {
  const file = reviewed as RegistryPreview;
  if (file?.kind !== REGISTRY_PREVIEW_KIND || !file.plan || typeof file.hash !== 'string') {
    throw new Error('REVIEWED_PLAN_INVALID: a registry preview file (--output of registry-review) is required');
  }
  const plan = validateRegistryPlan(file.plan);
  const keys = plan.entries.map(e => e.key).sort();
  const result = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('source-registry', 0))`;
    for (const key of keys) await lockSourceWrites(tx, key, true);
    if (keys.length) await tx.$queryRaw(Prisma.sql`SELECT key FROM "Source" WHERE key IN (${Prisma.join(keys)}) ORDER BY key FOR UPDATE`);
    const now = previewRegistry(plan, await readRegistrySources(tx));
    if (now.refused.length) throw new Error(`REVIEWED_PLAN_REFUSED: ${now.refused.slice(0, 10).map(r => `${r.key} ${r.code}`).join(', ')}`);
    if (now.hash !== file.hash) throw new Error('REVIEWED_PLAN_MISMATCH: the recomputed preview differs from the reviewed file; preview again');
    await tx.sourceRegistryReview.create({ data: { id: now.hash, reviewer: plan.reviewer,
      plan: now.plan as unknown as Prisma.InputJsonValue, before: now.before as unknown as Prisma.InputJsonValue } });
    for (const e of now.plan.entries) {
      await tx.$executeRaw`
        UPDATE "Source" SET status = ${e.targetStatus}::"SourceStatus", "statusExplainedFor" = ${e.targetStatus}::"SourceStatus",
          "statusIntention" = ${e.intention}, "statusTrajectory" = ${e.trajectory}, "statusBasis" = ${e.basis},
          "statusDecision" = ${e.decision}, "statusReason" = ${e.reason}, "statusNextAction" = ${e.nextAction},
          "statusQuestion" = ${e.question}, "statusReviewAt" = ${e.reviewAt}::date, "statusReviewId" = ${now.hash}, "updatedAt" = now()
        WHERE key = ${e.key}`;
    }
    return { reviewId: now.hash, explained: now.plan.entries.length, retirements: now.retirements };
  }, { timeout: 120_000 });
  // Le retrait des publications suit le mécanisme existant de `retire-source` (R-142 §2), après la validation du statut,
  // hors transaction comme dans `retireSource.ts`. REPRISE si un retrait échoue ici : le registre est déjà écrit (la
  // source est RETIRED et expliquée), donc le même fichier relu est refusé (STATUS_CHANGED) et un nouvel aperçu du
  // même fichier de décisions aussi ; on relance `retire-source <clé>` pour chaque clé de `retirements` non retirée :
  // `withdrawRetiredSource` est idempotent (il ne touche que les publications encore actives).
  const withdrawn = [];
  for (const r of result.retirements) withdrawn.push({ key: r.key, ...await withdrawRetiredSource(db, { sourceKey: r.key }) });
  return { ...result, withdrawn };
}
