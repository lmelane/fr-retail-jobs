import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { prisma, Prisma } from '@catwalks/db';
import { cleAttendue, refuserSiCleInvalide } from '@/lib/cle-api';

/**
 * D-522 §5 — LE SOCLE DES ROUTES DE PILOTAGE `/api/ops/*` (console Agrégateur du back-office), LECTURE SEULE.
 *
 * Chaque route lit par les fonctions du worker qui font déjà foi (`apps/aggregator/src/…` : état opérationnel des sources,
 * registre explicite, couverture, file d'identité, parcours d'une offre), jamais par une requête parallèle qui pourrait
 * en diverger. Ces modules sont importés sans la chaîne de capture (aucun navigateur ni client HTTP : témoin
 * `ops-frontiere.test.ts`).
 *
 * Deux gardes :
 *  - la clé `CATALOGUE_OPS_KEY`, seule acceptée, et FERMÉE sans elle même hors production (503) : contrairement aux
 *    routes publiques, aucun poste local ne doit exposer l'état interne par un oubli ;
 *  - la transaction `READ ONLY` : Postgres refuse toute écriture de la session, quel que soit le code appelé.
 */
export class OpsRefus extends Error {
  constructor(readonly status: 400 | 404, message: string) { super(message); this.name = 'OpsRefus'; }
}

export type Tx = Prisma.TransactionClient;

/** Une lecture cohérente (un seul instantané) et refusée en écriture par la base. */
export async function lireEnLectureSeule<T>(lire: (tx: Tx) => Promise<T>, delaiMs = 25_000): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return lire(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: delaiMs, maxWait: 5_000 });
}

/** Le squelette commun : clé ops, en-têtes, refus attendus (400, 404), base indisponible (503), le reste journalisé (500). */
export async function routeOps(request: NextRequest, nom: string, produire: (requestId: string) => Promise<unknown>): Promise<NextResponse> {
  const requestId = randomUUID();
  const entetes = { 'x-request-id': requestId, 'cache-control': 'no-store' };
  if (!cleAttendue('ops')) {
    console.error(JSON.stringify({ evenement: 'api.ops', requestId, route: nom, etat: 'non_configure', detail: 'CATALOGUE_OPS_KEY absente' }));
    return NextResponse.json({ error: 'Le pilotage du catalogue n’est pas configuré.', requestId }, { status: 503, headers: { ...entetes, 'retry-after': '60' } });
  }
  const refus = refuserSiCleInvalide(request, requestId, ['ops']);
  if (refus) return refus;
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'La base du catalogue est indisponible.', requestId }, { status: 503, headers: entetes });
  const debut = Date.now();
  try {
    const corps = await produire(requestId);
    console.info(JSON.stringify({ evenement: 'api.ops', requestId, route: nom, etat: 'ok', ms: Date.now() - debut }));
    return NextResponse.json(corps, { headers: entetes });
  } catch (error) {
    if (error instanceof OpsRefus) return NextResponse.json({ error: error.message, requestId }, { status: error.status, headers: entetes });
    const indisponible = error instanceof Prisma.PrismaClientInitializationError || (error instanceof Prisma.PrismaClientKnownRequestError
      && ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028'].includes(error.code));
    console.error(JSON.stringify({ evenement: 'api.ops', requestId, route: nom, etat: indisponible ? 'indisponible' : 'erreur', ms: Date.now() - debut,
      erreur: error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : 'inconnue' }));
    return NextResponse.json({ error: indisponible ? 'La base du catalogue est indisponible.' : 'La lecture du pilotage a échoué.', requestId },
      { status: indisponible ? 503 : 500, headers: entetes });
  }
}
