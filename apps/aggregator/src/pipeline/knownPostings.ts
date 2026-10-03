/**
 * D-517 — CE QU'UNE SOURCE A DÉJÀ MONTRÉ : l'ensemble « connu » d'une lecture incrémentale (`lib/incrementalReading.ts`).
 *
 * Une publication est connue quand la source l'a déjà fait entrer chez nous (`JobSource`, quel que soit son état :
 * ouverte, fermée, retenue), ou quand une collecte HORS PASSE des 48 dernières heures l'a rendue sans la publier
 * (retenue, hors secteur, écriture refusée : `SourceExtraction`). Sans ce second ensemble, une publication que le RUN
 * écarte chaque jour serait relue en détail à chaque passe, sans rien publier. Une sortie de passe non publiée (fiche en
 * échec, retenue) n'en fait pas partie : la passe suivante relit sa fiche. Une publication connue n'est ni relue ni réécrite par la
 * passe ; le RUN la relit, la réécrit, la rouvre ou la ferme, comme avant.
 *
 * Identifiants CANONIQUES, ceux de `JobSource.externalId` : un adaptateur qui demanderait avec un autre identifiant
 * (diffusion, jeton) ne trouverait rien de connu et lirait tout, ce qui coûte, mais ne cache jamais rien.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { LIGHT_PASS_RUN_COMMAND } from './referenceRuns.js';

export const KNOWN_OUTPUT_HOURS = 48;

export async function knownPostings(prisma: PrismaClient, sourceKey: string, now = new Date()): Promise<Set<string>> {
  const since = new Date(now.getTime() - KNOWN_OUTPUT_HOURS * 3_600_000);
  const rows = await prisma.$queryRaw<{ externalId: string }[]>`
    SELECT "externalId" FROM "JobSource" WHERE "sourceKey" = ${sourceKey}
    UNION
    SELECT se."externalId" FROM "SourceExtraction" se JOIN "CaptureBatch" cb ON cb.id = se."batchId"
    WHERE cb."sourceKey" = ${sourceKey} AND cb.purpose = 'JOBS' AND cb."startedAt" >= (${since}::timestamptz AT TIME ZONE 'UTC') AND se."externalId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "PipelineRun" pass WHERE pass.id = cb."runId" AND pass.command = ${LIGHT_PASS_RUN_COMMAND})`;
  return new Set(rows.map(row => row.externalId));
}

/**
 * Audit r6 (F2, tranché par le CTO) — LA RECONFIRMATION D'UNE OFFRE CONNUE QUE LA PASSE VOIT ENCORE LISTÉE.
 *
 * `ids` : les connues que la lecture incrémentale a vues dans la liste (`knownSkipped`, scellé dans le manifeste et rejoué
 * à l'identique par la validation). C'est une preuve positive, jamais une preuve d'absence. Seules les représentations
 * ACTIVES de la source sont touchées : `lastSeenAt` avance à l'instant où la capture a commencé (jamais en arrière), et
 * une retenue de disponibilité posée avant cet instant tombe — la règle de levée du RUN (`availability.ts`). Une offre
 * fermée n'est pas rouverte ici : seul le RUN rouvre.
 */
export async function reconfirmListed(prisma: PrismaClient, sourceKey: string, captureBatchId: string, ids: readonly string[]) {
  const { startedAt } = await prisma.captureBatch.findUniqueOrThrow({ where: { id: captureBatchId }, select: { startedAt: true } });
  const listed = { sourceKey, externalId: { in: [...ids] }, isActive: true };
  const reconfirmed = (await prisma.jobSource.updateMany({ where: { ...listed, lastSeenAt: { lt: startedAt } }, data: { lastSeenAt: startedAt } })).count;
  const released = (await prisma.jobSource.updateMany({ where: { ...listed, availabilityHold: { not: null }, availabilityHoldAt: { lte: startedAt } },
    data: { availabilityHold: null, availabilityHoldAt: null, availabilityEvidence: Prisma.DbNull } })).count;
  return { reconfirmed, released };
}
