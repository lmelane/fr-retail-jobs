import type { Prisma, PrismaClient } from '@prisma/client';
import { chunk } from '../lib/chunk.js';

/**
 * Historique d'une offre (Catwalks Intelligence, D38).
 *
 * Chaque ouverture, fermeture, ré-ouverture et changement de champ
 * STRUCTURANT est un `JobEvent` daté. La liste des offres se remplace à
 * chaque run ; son histoire, elle, ne se reconstruit pas — c'est ce qui permet
 * de rejouer le marché dans trois ans. Deux règles :
 *  - on n'écrit que ce qui change VRAIMENT (un `CHANGED` par champ dont la
 *    valeur diffère, jamais un événement « touché ») ;
 *  - on écrit par lot (`createMany`), jamais une requête par ligne quand c'est
 *    évitable — le refresh ferme des centaines d'offres d'un coup.
 */

export type JobEventType = 'OPENED' | 'CLOSED' | 'REOPENED' | 'CHANGED';

/** Les champs dont un changement fait un événement. Description, dates, salaire n'en font pas. */
export const STRUCTURAL_FIELDS = ['title', 'city', 'country', 'companyId', 'jobFunction'] as const;
export type StructuralField = (typeof STRUCTURAL_FIELDS)[number];

/** Une valeur avant/après est une chaîne bornée : l'événement raconte, il n'archive pas. */
export const EVENT_VALUE_MAX_LENGTH = 200;

export type JobEventInput = {
  jobId: string;
  type: JobEventType;
  field?: StructuralField;
  before?: string | null;
  after?: string | null;
  at?: Date;
};

type StructuralValues = Partial<Record<StructuralField, string | null | undefined>>;

export type StructuralChange = { field: StructuralField; before: string | null; after: string | null };

/** Tronque à 200 caractères ; `null`/`undefined` restent `null`. */
export function truncateEventValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.length > EVENT_VALUE_MAX_LENGTH ? value.slice(0, EVENT_VALUE_MAX_LENGTH) : value;
}

/**
 * Les champs structurants dont la valeur change réellement entre `before` et
 * `after`. Un champ ABSENT de `after` (undefined) n'est pas « effacé » : la
 * ré-attestation ne ré-écrit que ce qu'elle porte, donc absent = inchangé.
 * `null` dans `after`, lui, est un vrai effacement.
 */
export function diffStructuralFields(before: StructuralValues, after: StructuralValues): StructuralChange[] {
  const changes: StructuralChange[] = [];
  for (const field of STRUCTURAL_FIELDS) {
    if (!(field in after) || after[field] === undefined) continue;
    const previous = before[field] ?? null;
    const next = after[field] ?? null;
    if (previous === next) continue;
    changes.push({ field, before: truncateEventValue(previous), after: truncateEventValue(next) });
  }
  return changes;
}

/** Les événements `CHANGED` d'une offre, prêts à écrire. */
export function changedEvents(jobId: string, changes: StructuralChange[], at: Date): JobEventInput[] {
  return changes.map((change) => ({ jobId, type: 'CHANGED', ...change, at }));
}

/**
 * Les colonnes d'un événement SANS son offre : la forme qu'attend un
 * `createMany` imbriqué dans `job.update` (l'offre est implicite — Prisma
 * refuse `jobId` là, mesuré : « Unknown argument `jobId` »).
 */
export function toNestedEventRow(event: JobEventInput): Prisma.JobEventCreateManyJobInput {
  return {
    type: event.type,
    field: event.field ?? null,
    before: truncateEventValue(event.before),
    after: truncateEventValue(event.after),
    ...(event.at ? { at: event.at } : {}),
  };
}

/** La ligne `JobEvent` complète, telle que `jobEvent.createMany` l'écrit. */
export function toEventRow(event: JobEventInput): Prisma.JobEventCreateManyInput {
  return { jobId: event.jobId, ...toNestedEventRow(event) };
}

/**
 * Écrit les événements par `createMany` (par tranches : borne Postgres des
 * paramètres liés). Accepte un client Prisma ou un client transactionnel
 * (même surface pour `jobEvent.createMany`).
 */
export async function recordEvents(
  prisma: Pick<PrismaClient, 'jobEvent'>,
  events: ReadonlyArray<JobEventInput>,
): Promise<number> {
  if (events.length === 0) return 0;
  let count = 0;
  for (const batch of chunk(events)) {
    const result = await prisma.jobEvent.createMany({ data: batch.map(toEventRow) });
    count += result.count;
  }
  return count;
}
