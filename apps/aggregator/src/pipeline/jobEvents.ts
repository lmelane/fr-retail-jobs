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

/**
 * Le PONT entre le nom de COLONNE et le nom d'ÉVÉNEMENT.
 *
 * La colonne se nomme `countryCode` depuis le renommage du 2026-09-08 ; le champ
 * d'événement reste `country`, parce que `JobEvent.field` porte déjà cette
 * valeur sur des milliers de lignes d'historique. Renommer l'événement
 * désalignerait les anciens des nouveaux — on ne réécrit pas une histoire pour
 * harmoniser un nom technique (décision Loïc).
 *
 * Toute future divergence colonne/événement passe par ici, et par nulle part
 * ailleurs : c'est le seul endroit où les deux vocabulaires se rencontrent.
 */
const COLUMN_TO_EVENT_FIELD: Record<string, StructuralField> = { countryCode: 'country' };

/**
 * Projette une ligne (ou un patch) Prisma sur le vocabulaire des événements.
 *
 * Sans cette projection, `diffStructuralFields` lit `row['country']` sur une
 * ligne qui ne porte plus que `countryCode` : elle trouve `undefined`, conclut
 * « inchangé », et AUCUN changement de pays n'est plus jamais tracé. Le bug est
 * muet — pas d'erreur, pas de type qui proteste, juste une histoire qui s'arrête.
 */
export function structuralValuesOf(row: Record<string, unknown>): StructuralValues {
  const out: StructuralValues = {};
  for (const field of STRUCTURAL_FIELDS) {
    // Le nom de colonne correspondant à ce champ d'événement, s'il diffère.
    const column = Object.keys(COLUMN_TO_EVENT_FIELD).find((c) => COLUMN_TO_EVENT_FIELD[c] === field) ?? field;
    // `in` et non `?.` : un champ ABSENT doit rester absent (inchangé), là où
    // une valeur `null` présente est un effacement réel.
    if (column in row) out[field] = row[column] as string | null | undefined;
  }
  return out;
}

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
