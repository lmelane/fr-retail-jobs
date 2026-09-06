import { PrismaClient } from '@prisma/client';
/** D38 : Foot Locker crédité par enseigne (Champs Sports, Kids Foot Locker, WSS) — opt-in brandTag=tags4 (mesure 2026-09-06 : 1 899 / 482 / 429 / 8). */
const p = new PrismaClient();
const s = await p.source.findUniqueOrThrow({ where: { key: 'foot-locker-france' }, select: { config: true } });
const config = { ...(s.config as Record<string, unknown>), brandTag: 'tags4' };
await p.source.update({ where: { key: 'foot-locker-france' }, data: { config } });
console.log('config posée:', JSON.stringify(config));
await p.$disconnect();
