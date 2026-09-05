import { PrismaClient } from '@prisma/client';
import { tenantKeyOf } from '../connectors/sourceStore.js';

/**
 * Migre les clés tenant Workday vers `tenant/site` (voir le correctif dans
 * sourceStore). Vérifié avant écriture : 18 sources, 18 clés uniques après,
 * aucune collision. Sans cette migration, les anciennes clés continueraient de
 * bloquer les vrais boards frères.
 */
const p = new PrismaClient();
const rows = await p.source.findMany({ where: { kind: 'workday' }, select: { key: true, maison: true, config: true, tenantKey: true, careersDomain: true } });

const planned = rows.map((r) => ({
  key: r.key,
  from: r.tenantKey,
  to: tenantKeyOf('workday', JSON.stringify(r.config), r.careersDomain ?? undefined, r.maison),
}));
const unique = new Set(planned.map((x) => x.to));
if (unique.size !== planned.length) {
  console.error('COLLISION détectée — migration refusée');
  process.exit(1);
}

let n = 0;
for (const x of planned) {
  if (x.from === x.to) continue;
  await p.source.update({ where: { key: x.key }, data: { tenantKey: x.to } });
  n++;
}
console.log(`clés migrées: ${n}/${planned.length}`);
await p.$disconnect();
