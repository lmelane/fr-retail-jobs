import { PrismaClient } from '@prisma/client';

/**
 * Retire les photographies « company » antérieures à une correction d'identité.
 *
 * D45 a fusionné 209 entités juridiques dans leur marque mère (Mango 551 →
 * 1 579, Nike 716 → 1 046). Les photographies déjà prises portent l'ANCIEN
 * découpage : les comparer aux suivantes afficherait « Mango +1 028 en un
 * jour », une variation qui n'a jamais eu lieu sur le marché. Ce n'est pas un
 * mouvement, c'est une correction — l'histoire par société doit repartir.
 *
 * Les autres périmètres (ville, pays, métier, secteur…) ne sont PAS touchés :
 * une offre Mango est restée dans la même ville et le même métier. 3 600
 * lignes d'historique sont préservées.
 *
 * Usage : DATABASE_URL=… npx tsx src/discovery/ops-drop-company-snapshot.mts [--apply]
 */
const apply = process.argv.includes('--apply');
const p = new PrismaClient();
const before = await p.marketSnapshot.count({ where: { scope: 'company' } });
const others = await p.marketSnapshot.count({ where: { scope: { not: 'company' } } });
console.log(`photographies « company » : ${before}   autres périmètres conservés : ${others}`);
if (apply) {
  const r = await p.marketSnapshot.deleteMany({ where: { scope: 'company' } });
  console.log(JSON.stringify({ deleted: r.count, remaining: await p.marketSnapshot.count() }));
} else {
  console.log('simulation — relancer avec --apply');
}
await p.$disconnect();
