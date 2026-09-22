/** Export indépendant de l’API : identifiants publiables lus sur la répétition en lecture seule. */
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { publicJobWhere } from '../../../../../packages/db/availability.js';
import { MARCHES } from '../../../../../packages/db/marches.js';
const url = process.env.DATABASE_URL;
if (!url || new URL(url).pathname !== '/catwalks_consolide_rehearsal') throw new Error('Utiliser avec-rehearsal.sh');
const sortie = process.argv[2];
if (!sortie) throw new Error('Chemin de sortie JSON requis');
const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  const baseline = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const [identity] = await tx.$queryRaw<{ base: string; lecture: string }[]>`SELECT current_database() AS base, current_setting('transaction_read_only') AS lecture`;
    if (identity.base !== 'catwalks_consolide_rehearsal' || identity.lecture !== 'on') throw new Error('Identité ou mode de la répétition incorrect');
    const mesureA = new Date();
    const marches = {} as Record<string, { pays: readonly string[]; locales: readonly string[]; ids: string[] }>;
    for (const code of ['CA', 'CH', 'BE'] as const) {
      const marche = MARCHES[code];
      if (!marche) throw new Error(`Marché absent : ${code}`);
      const [aggregees, directes] = await Promise.all([
        tx.job.findMany({ where: { ...publicJobWhere(mesureA), countryCode: { in: [...marche.pays] } }, select: { id: true } }),
        tx.directOffer.findMany({ where: { eligible: true, countryCode: { in: [...marche.pays] }, OR: [{ validThrough: null }, { validThrough: { gt: mesureA } }] }, select: { id: true } }),
      ]);
      marches[code] = { pays: marche.pays, locales: marche.locales, ids: [...aggregees.map(j => j.id), ...directes.map(j => `cw_${j.id}`)].sort() };
    }
    return { ...identity, mesureA: mesureA.toISOString(), marches };
  }, { timeout: 30_000 });
  writeFileSync(sortie, JSON.stringify(baseline, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ base: baseline.base, lecture: baseline.lecture, mesureA: baseline.mesureA, totaux: Object.fromEntries(Object.entries(baseline.marches).map(([code, m]) => [code, m.ids.length])) }));
} finally { await prisma.$disconnect(); }
