/**
 * D-517 — CE QU'UNE SOURCE A DÉJÀ MONTRÉ : l'ensemble « connu » d'une lecture incrémentale (`lib/incrementalReading.ts`).
 *
 * Une publication est connue quand la source l'a déjà fait entrer chez nous (`JobSource`, quel que soit son état :
 * ouverte, fermée, retenue), ou quand une collecte des 48 dernières heures l'a rendue sans la publier (retenue,
 * hors secteur, écriture refusée : `SourceExtraction`). Sans ce second ensemble, une publication que le RUN écarte chaque
 * jour serait relue en détail à chaque passe, sans rien publier. Une publication connue n'est ni relue ni réécrite par la
 * passe ; le RUN la relit, la réécrit, la rouvre ou la ferme, comme avant.
 *
 * Identifiants CANONIQUES, ceux de `JobSource.externalId` : un adaptateur qui demanderait avec un autre identifiant
 * (diffusion, jeton) ne trouverait rien de connu et lirait tout, ce qui coûte, mais ne cache jamais rien.
 */
import type { PrismaClient } from '@prisma/client';

export const KNOWN_OUTPUT_HOURS = 48;

export async function knownPostings(prisma: PrismaClient, sourceKey: string, now = new Date()): Promise<Set<string>> {
  const since = new Date(now.getTime() - KNOWN_OUTPUT_HOURS * 3_600_000);
  const rows = await prisma.$queryRaw<{ externalId: string }[]>`
    SELECT "externalId" FROM "JobSource" WHERE "sourceKey" = ${sourceKey}
    UNION
    SELECT se."externalId" FROM "SourceExtraction" se JOIN "CaptureBatch" cb ON cb.id = se."batchId"
    WHERE cb."sourceKey" = ${sourceKey} AND cb.purpose = 'JOBS' AND cb."startedAt" >= (${since}::timestamptz AT TIME ZONE 'UTC') AND se."externalId" IS NOT NULL`;
  return new Set(rows.map(row => row.externalId));
}
