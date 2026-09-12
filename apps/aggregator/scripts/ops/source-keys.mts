/**
 * Les clés du CATALOGUE, pour valider une allowlist — lecture seule.
 *
 * On lit `Source`, pas les `JobSource` actives : une clé doit pouvoir être nommée même si aucune de ses offres
 * n'est active. Et surtout, la validation d'une allowlist ne se déduit JAMAIS du statut `ACTIVE` — le registre
 * P6 a séparé « au catalogue » de « a démontré son exhaustivité ». Les statuts sont donc rendus à côté des
 * clés, pour information, jamais comme critère d'appartenance.
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
try {
  const rows = await p.source.findMany({ select: { key: true, status: true }, orderBy: { key: 'asc' } });
  console.log(JSON.stringify({
    all: rows.map((r) => r.key),
    byStatus: rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}),
  }, null, 1));
} finally {
  await p.$disconnect();
}
