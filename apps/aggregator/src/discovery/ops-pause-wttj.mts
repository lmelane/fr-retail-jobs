import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const keys = ['hermes', 'a-p-c', 'monsieur-tshirt', 'pied-de-biche', 'helena-rubinstein-8', 'sessun', 'clarins-wttj'];
const r = await p.source.updateMany({ where: { key: { in: keys }, status: 'ACTIVE' }, data: { status: 'PAUSED', note: 'D39 2026-09-06 : couverte par wttj-sector ; quelques offres non re-listées par le balayage → PAUSED le temps que le refresh les ferme, puis retire-source' } });
console.log('paused', r.count, '| ACTIVE', await p.source.count({ where: { status: 'ACTIVE' } }));
await p.$disconnect();
