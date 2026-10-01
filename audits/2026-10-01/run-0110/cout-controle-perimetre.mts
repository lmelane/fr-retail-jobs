/**
 * Lecture seule : temps de `observedRequests` (la lecture que fait `scopeOutgrown` à chaque source d'un RUN sans
 * requalification) sur les plus grosses captures de qualification du RUN du 01/10/2026. Ce chemin n'a encore tourné
 * dans aucun RUN de production (aucun événement source.access_scope_outgrown / _check_failed).
 * Usage : tsx cout-controle-perimetre.mts <captureBatchId>…
 */
import { PrismaClient } from '@prisma/client';
import { observedRequests } from '../../../apps/aggregator/src/connectors/sourceAccessQualification.js';

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
for (const id of process.argv.slice(2)) {
  const started = Date.now();
  const requests = await observedRequests(p, id);
  console.log(id, `${requests.length} requêtes lues en ${Date.now() - started} ms`);
}
await p.$disconnect();
