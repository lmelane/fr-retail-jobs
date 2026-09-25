import type { Prisma, PrismaClient } from '@prisma/client';
import { log } from '../observability/logger.js';
import type { ContexteProjection } from './contexte.js';
import { colonnesProjetees, relirePayload } from './projection.js';
import { CORRESPONDANCE_DIRECTE_VERSION } from './vocabulaire.js';

/**
 * LE STOCK SUIT LA CORRESPONDANCE (D-455, D-444). Une offre directe n'est re-projetée que lorsqu'elle est relue ; une
 * offre retirée, ou que sa source ne relit pas, garderait sa projection quand la correspondance change (l'univers pour
 * employeur avant D-455 ; ni groupe ni métier avant D-444). Toute ligne restée à une `correspondanceVersion` antérieure
 * est donc reconstruite depuis son contrat conservé (`payload` : contrat du flux, ou offre de la liste publique dont le
 * pays est recalculé par ses coordonnées), sans le backend, avant chaque lecture. Ni sa version, ni sa séquence, ni son
 * éligibilité (une offre retirée le reste), ni sa provenance (`payload`, `payloadHash`) ne changent. Une ligne dont le
 * contrat conservé ne se projette plus (illisible, ou montant que la base refuse) garde sa projection antérieure : elle
 * est rendue dans les statistiques et journalisée, jamais tue, et ne bloque ni les autres lignes ni la lecture.
 * Idempotent : une ligne à jour n'est plus relue.
 */
export type NonReprojetee = { id: string; cause: string };
export type StatsReprojection = { reprojetees: number; nonReprojetees: NonReprojetee[] };
/** Une ligne à re-projeter, telle qu'elle a été lue : son contrat conservé et l'empreinte de ce contrat. */
export type LigneLue = { id: string; payload: Prisma.JsonValue; payloadHash: string };
type Database = PrismaClient | Prisma.TransactionClient;

export async function reprojeterStock(db: Database, contexte: ContexteProjection): Promise<StatsReprojection> {
  const perimees = await db.directOffer.findMany({
    where: { correspondanceVersion: { lt: CORRESPONDANCE_DIRECTE_VERSION } },
    select: { id: true, payload: true, payloadHash: true },
    orderBy: { id: 'asc' },
  });
  const stats: StatsReprojection = { reprojetees: 0, nonReprojetees: [] };
  for (const ligne of perimees) {
    const resultat = await reprojeterLigne(db, ligne, contexte);
    if (typeof resultat === 'number') stats.reprojetees += resultat;
    else stats.nonReprojetees.push({ id: ligne.id, cause: resultat.cause });
  }
  if (stats.nonReprojetees.length) {
    await log.warn('direct.reprojection_incomplete',
      `[direct] ${stats.nonReprojetees.length} offre(s) directe(s) gardent leur projection antérieure : contrat conservé non projetable`,
      { reprojetees: stats.reprojetees, nonReprojetees: stats.nonReprojetees });
  } else if (stats.reprojetees) {
    await log.info('direct.reprojection', { reprojetees: stats.reprojetees, correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION });
  }
  return stats;
}

/**
 * Re-projette UNE ligne lue : le nombre de lignes écrites (0 ou 1), ou la cause qui empêche de la reconstruire.
 * L'écriture n'a lieu que si la ligne porte encore le contrat lu (`payloadHash`) et une correspondance antérieure : une
 * version plus récente écrite entre la lecture et l'écriture, par ce code ou par un processus plus ancien, n'est jamais
 * écrasée par des colonnes dérivées d'un contrat périmé ; la passe suivante la relira.
 */
export async function reprojeterLigne(db: Database, ligne: LigneLue, contexte: ContexteProjection): Promise<number | { cause: string }> {
  let colonnes: ReturnType<typeof colonnesProjetees>;
  try {
    colonnes = colonnesProjetees(relirePayload(ligne.payload, contexte).offre, contexte);
  } catch (error) {
    return { cause: error instanceof Error ? error.name : 'UnknownError' };
  }
  const { count } = await db.directOffer.updateMany({
    where: { id: ligne.id, payloadHash: ligne.payloadHash, correspondanceVersion: { lt: CORRESPONDANCE_DIRECTE_VERSION } },
    data: colonnes,
  });
  return count;
}
