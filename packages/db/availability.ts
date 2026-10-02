import { Prisma } from '@prisma/client';

/**
 * DEUX QUESTIONS DISTINCTES, à ne jamais confondre.
 *
 *   · DISPONIBLE (`sourceIsAvailable`) : la représentation est-elle encore publiée par sa source, selon le cycle de
 *     vie ? C'est elle qui décide d'une fermeture (refresh, retrait natif, échéance). Rien ici ne la change.
 *   · CONFIRMÉE (`sourceIsConfirmed`, R-143 §2, D-513) : a-t-on encore assez confiance pour SERVIR l'offre au candidat ?
 *     Une représentation disponible mais non reconfirmée sort de la recherche, de l'accueil et des alertes, sans être
 *     fermée, et y revient dès que sa source la revoit.
 *
 * Une représentation n'est plus confirmée quand :
 *   1. elle porte une retenue de disponibilité (`availabilityHold`) : une collecte crédible de sa source ne l'a pas vue
 *      (NOT_RECONFIRMED), ou la sonde a lu une page de candidature morte (APPLY_LINK_DEAD). Chaque écrivain qui la revoit
 *      efface la retenue (`dedup/upsert.ts`), et la revue de disponibilité du RUN efface celles que `lastSeenAt` a
 *      dépassées (`pipeline/availability.ts`) ;
 *   2. ou elle n'a pas été revue depuis `CONFIRMATION_CEILING_HOURS`, quelle qu'en soit la raison (source en panne, en
 *      pause, retenue sans motif) : le plafond absolu.
 */
export const CONFIRMATION_CEILING_HOURS = 72;
const CEILING_MS = CONFIRMATION_CEILING_HOURS * 3_600_000;

/** Publisher availability and a declared deadline must both permit publication. */
export function sourceIsAvailable(source: { isActive: boolean; expiresAt?: Date | null }, at = new Date()): boolean {
  return source.isActive && (!source.expiresAt || source.expiresAt > at);
}

export function availableSourceWhere(at = new Date()): Prisma.JobSourceWhereInput {
  return { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: at } }] };
}

export type ConfirmableSource = {
  isActive: boolean; expiresAt?: Date | null; lastSeenAt: Date; availabilityHold?: string | null;
};

/** R-143 §2 : disponible, revue depuis moins que le plafond, et sans retenue de disponibilité. */
export function sourceIsConfirmed(source: ConfirmableSource, at = new Date()): boolean {
  return sourceIsAvailable(source, at) && source.lastSeenAt.getTime() > at.getTime() - CEILING_MS && !source.availabilityHold;
}

export function confirmedSourceWhere(at = new Date()): Prisma.JobSourceWhereInput {
  return { AND: [availableSourceWhere(at), { lastSeenAt: { gt: new Date(at.getTime() - CEILING_MS) }, availabilityHold: null }] };
}

/** Aggregated listings are served only with at least one confirmed publication. */
export function publicJobWhere(at = new Date()): Prisma.JobWhereInput {
  return { isActive: true, mergedIntoId: null, sources: { some: confirmedSourceWhere(at) } };
}

/** Only trusted, static SQL identifiers may be supplied as the alias. Same predicate as `publicJobWhere`. */
export function publicJobSql(job: Prisma.Sql, at = new Date()): Prisma.Sql {
  const ceiling = new Date(at.getTime() - CEILING_MS);
  return Prisma.sql`${job}."isActive" AND ${job}."mergedIntoId" IS NULL AND EXISTS (
    SELECT 1 FROM "JobSource" available_source WHERE available_source."jobId" = ${job}.id
      AND available_source."isActive" AND (available_source."expiresAt" IS NULL OR available_source."expiresAt" > (${at}::timestamptz AT TIME ZONE 'UTC'))
      AND available_source."lastSeenAt" > (${ceiling}::timestamptz AT TIME ZONE 'UTC') AND available_source."availabilityHold" IS NULL)`;
}
