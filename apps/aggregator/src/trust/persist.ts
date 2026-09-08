/**
 * PERSISTANCE des verdicts de confiance, avec mémoire.
 *
 * Deux tables, deux durées de vie (décision Loïc, 2026-09-08) :
 *  - `SourceFieldTrust` porte le verdict OPÉRATIONNEL, celui que le pipeline
 *    consulte. Il peut retomber à INSUFFICIENT_EVIDENCE si la source se tait
 *    plus de 60 jours — une source doit pouvoir réparer son flux.
 *  - `SourceFieldTrustObservation` garde CHAQUE évaluation, pour toujours.
 *    « Le verdict opérationnel peut expirer ; l'observation historique, non. »
 *    C'est ce qui permet d'expliquer une dégradation passée et de détecter une
 *    récidive.
 *
 * Aucune source n'est nommée ici ni ailleurs dans le moteur : les triplets
 * viennent de la mesure.
 */

import type { PrismaClient } from '@prisma/client';
import type { Observation } from './contradictions.js';
import { evaluate } from './verdict.js';

export type PersistStats = { created: number; updated: number; observations: number };

/**
 * Écrit les verdicts et empile une observation par triplet.
 *
 * Idempotent sur le verdict (upsert par `source × path × dimension`), additif
 * sur l'historique : rejouer la mesure n'écrase jamais la mémoire.
 */
export async function persistTrust(
  prisma: PrismaClient,
  observations: Observation[],
  evaluatorVersion: string,
  now = new Date(),
): Promise<PersistStats> {
  const stats: PersistStats = { created: 0, updated: 0, observations: 0 };

  for (const o of observations) {
    const v = evaluate(o, evaluatorVersion, now);
    const where = { source_path_dimension: { source: o.source, path: o.path, dimension: o.dimension } };

    const data = {
      level: v.level,
      eligibleCount: o.comparable,
      agreementCount: o.agreements,
      contradictionCount: o.contradictions,
      contradictionRate: o.contradictionRate,
      reason: v.reason,
      evaluatorVersion,
      // `observedAt` peut être nul si aucune offre ne portait de date : on
      // retombe sur l'instant d'évaluation plutôt que d'écrire un vide.
      observedAt: o.lastObservedAt ?? now,
      evaluatedAt: now,
    };

    const existing = await prisma.sourceFieldTrust.findUnique({ where, select: { id: true } });
    const row = existing
      ? await prisma.sourceFieldTrust.update({ where, data, select: { id: true } })
      : await prisma.sourceFieldTrust.create({
          data: { source: o.source, path: o.path, dimension: o.dimension, ...data },
          select: { id: true },
        });
    if (existing) stats.updated++;
    else stats.created++;

    await prisma.sourceFieldTrustObservation.create({
      data: {
        trustId: row.id,
        level: v.level,
        eligibleCount: o.comparable,
        contradictionCount: o.contradictions,
        contradictionRate: o.contradictionRate,
        evaluatorVersion,
        observedAt: o.lastObservedAt ?? now,
      },
    });
    stats.observations++;
  }

  return stats;
}

/**
 * Les verdicts opérationnels, prêts à être consultés par le pipeline.
 *
 * Clé : `source path dimension`, la même que celle de la mesure.
 */
export async function loadTrust(prisma: PrismaClient): Promise<Map<string, string>> {
  const rows = await prisma.sourceFieldTrust.findMany({
    select: { source: true, path: true, dimension: true, level: true },
  });
  return new Map(rows.map((r) => [`${r.source} ${r.path} ${r.dimension}`, r.level]));
}
