/*
 * Qui tient le verrou consultatif de Prisma, et depuis quand.
 *
 * `prisma migrate deploy` prend `pg_advisory_lock(72707369)` avant d'appliquer quoi que ce soit, et
 * abandonne au bout de 10 s si le verrou est déjà pris — sans rien écrire. L'erreur rendue (P1002,
 * « database server ... timed out ») désigne le serveur, ce qui envoie chercher une panne réseau
 * alors que la base répond parfaitement : c'est une autre session qui migre, ou qui interroge
 * `migrate status` au démarrage d'un service.
 *
 * Relancer à l'aveugle dans ce cas, c'est empiler les prétendants sur le même verrou. On regarde
 * d'abord QUI le tient : un démarrage de service (normal, on attend), ou une session oubliée.
 *
 * Lecture seule, sans écriture d'aucune sorte. Le numéro 72707369 est celui que Prisma dérive de son
 * propre nom ; il est stable d'une version à l'autre.
 *
 * usage: python3 apps/aggregator/scripts/ops/db.py readonly npx tsx apps/aggregator/scripts/ops/verrou-migration.mts
 */
import { PrismaClient } from '@prisma/client';

const VERROU_PRISMA = 72707369;

const db = new PrismaClient();
try {
  const detenteurs = await db.$queryRawUnsafe(
    `SELECT l.pid, l.granted, a.application_name, a.state,
            date_trunc('second', now() - a.state_change)::text AS depuis,
            left(coalesce(a.query, ''), 80) AS requete
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.objid = $1
      ORDER BY l.granted DESC`,
    VERROU_PRISMA,
  );
  const appliquees = await db.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
  );
  console.log(JSON.stringify({ detenteurs, appliquees }, (_c, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
} finally {
  await db.$disconnect();
}
