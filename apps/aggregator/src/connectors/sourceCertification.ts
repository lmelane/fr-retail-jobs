import type { Prisma } from '@prisma/client';
import { captureReaderRevision } from '../capture/revision.js';

/** v3 separates partial publication from absence attestation, accounts for
 * malformed native rows with the existing allowance, and certifies Greenhouse's
 * explicit zero-total response. The SQL admission contract uses this version. */
export const SOURCE_VALIDATION_POLICY = 'source-validation-20260923-v3';

/**
 * Combien d'offres non qualifiées un lot tolère — décision du propriétaire, 19/09/2026.
 *
 * LES DEUX CONDITIONS S'APPLIQUENT ENSEMBLE, et aucune ne suffit seule :
 *
 *   · un POURCENTAGE seul se laisse contourner par un gros lot — 1 % de 10 000 offres, c'est
 *     100 annonces perdues sans que rien ne le signale ;
 *   · une VALEUR ABSOLUE seule se laisse contourner par un petit lot — 2 offres sur 20, c'est
 *     10 % du catalogue d'une Maison, et ça passerait.
 *
 * Ce que le seuil NE FAIT PAS : il ne publie aucune offre non qualifiée. Celles-ci restent
 * refusées une par une ; le seuil décide seulement si la SOURCE reste validée. Et le rapport
 * conserve le compte exact, donc une dégradation progressive reste lisible.
 */
export const VALIDATION_UNQUALIFIED_ALLOWANCE = { floor: 2, ratio: 0.01, count: 5 } as const;

/**
 * Le plafond effectif d'un lot : `max(floor, min(ratio × observées, count))`.
 *
 * LE PLANCHER (décision du propriétaire, 19/09/2026). Sans lui, 1 % d'un petit lot vaut ZÉRO —
 * une source de 73 offres n'en tolérait aucune, et 71 offres valides restaient non publiées pour
 * 2 annonces sans description. Mesuré : Burberry 152/154, Selfridges 73/75, Uniqlo 71/73,
 * Dr. Martens 197/199 — 493 offres bloquées par 8 annonces.
 *
 * LE PLAFOND reste la protection contre la dégradation, qui est la raison d'être de cette porte
 * (lot 5D, 16/09/2026 : « les lignes rejetées masquées par un sous-ensemble lisible »). Une
 * source qui commence à mal se lire dépasse vite 5 offres et redevient bloquante ; une source
 * de 10 000 offres n'en perd jamais plus de 5 en silence.
 *
 * Ce que le plancher NE FAIT PAS : publier une offre non qualifiée. Elle reste refusée. Il
 * décide seulement si la SOURCE garde le droit de publier les autres.
 */
export function unqualifiedAllowanceFor(observed: number): number {
  const { floor, ratio, count } = VALIDATION_UNQUALIFIED_ALLOWANCE;
  /*
   * LE PLANCHER NE DÉPASSE JAMAIS LA MOITIÉ DU LOT.
   *
   * Sans cette borne, une source de 2 offres dont les 2 échouent serait « validée » avec zéro
   * offre publiable, et une source d'une seule offre aussi : le seuil aurait couvert la totalité
   * du lot. Le témoin l'a attrapé — ce sont des tailles réelles (plusieurs sources mesurées le
   * 19/09 publient 1 ou 2 offres).
   *
   * Sur un lot assez grand pour que le plancher ait un sens (4 offres et plus), cette borne
   * n'agit pas : c'est bien `floor` qui s'applique.
   */
  return Math.max(Math.min(floor, Math.floor(observed / 2)), Math.min(Math.floor(observed * ratio), count));
}
export const SOURCE_VALIDATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type GateCode = 'VALIDATION_MISSING' | 'READER_STALE' | 'CAPTURE_STALE' | 'ATTEMPT_ORDER_UNKNOWN' | 'CAPTURE_SUPERSEDED';
export class SourceValidationGateError extends Error {
  constructor(readonly code: GateCode, message: string) {
    super(message); this.name = 'SourceValidationGateError';
  }
}

/** Called after locking the current registry row, together with identity and
 * access checks. A newer rejection supersedes an earlier successful validation. */
export async function requireSourceValidation(db: Prisma.TransactionClient, revisionId: string, now = new Date()) {
  const validation = await db.sourceValidation.findFirst({ where: { sourceRevisionId: revisionId },
    orderBy: { sequence: 'desc' }, include: { captureBatch: true } });
  if (!validation || validation.verdict !== 'VALIDATED' || validation.captureBatch.purpose !== 'JOBS') throw new SourceValidationGateError('VALIDATION_MISSING', 'no current validated native offer capture or proven empty feed');
  if (validation.policyVersion !== SOURCE_VALIDATION_POLICY || validation.readerRevision !== captureReaderRevision()) throw new SourceValidationGateError('READER_STALE', 'native validation must be repeated with the current reader');
  const age = now.getTime() - validation.captureBatch.startedAt.getTime();
  if (!Number.isFinite(age) || age < -300_000 || age > SOURCE_VALIDATION_MAX_AGE_MS) throw new SourceValidationGateError('CAPTURE_STALE', 'native capture must have been observed within 24 hours');
  // A failed or still-running attempt has no successful manifest to validate.
  // It must not leave an earlier success eligible for a new activation or ingestion. Database
  // allocation order is independent of clock corrections and timestamp ties.
  // Promotion and ingestion hold the registry row lock used by new captures.
  if (validation.captureBatch.attemptOrdinal === null) throw new SourceValidationGateError('ATTEMPT_ORDER_UNKNOWN', 'capture predates ordered source attempts; collect again');
  const competing = await db.captureBatch.findFirst({ where: { sourceRevisionId: revisionId, purpose: 'JOBS',
    attemptOrdinal: { gt: validation.captureBatch.attemptOrdinal } }, select: { id: true } });
  if (competing) throw new SourceValidationGateError('CAPTURE_SUPERSEDED', 'a newer capture attempt requires a new native validation');
  return validation;
}
