import '../test/setup-integration.js';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

/**
 * D-520 §2 — la base elle-même refuse un état opérationnel incohérent : la migration
 * `20261002203000_etat_operationnel_sources` pose des contraintes CHECK sur `SourceOperationalState`. Ce témoin écrit
 * par le même client que `sourceStateStore.ts` et attend le refus nommé de chaque contrainte ; il échoue si l'une d'elles
 * est retirée ou affaiblie. Les lignes valides du témoin sont supprimées à la fin ; aucune autre n'est touchée.
 */
const db = new PrismaClient();
const keys: string[] = [];
const key = () => { const k = `etat-check-${randomUUID().slice(0, 8)}`; keys.push(k); return k; };
const row = (over: Record<string, unknown>) => ({ sourceKey: key(), state: 'NORMALE', cause: null, trajectory: null, since: new Date(),
  computedAt: new Date(), ...over });
const write = (over: Record<string, unknown>) => db.sourceOperationalState.create({ data: row(over) as never });

afterAll(async () => {
  await db.sourceOperationalState.deleteMany({ where: { sourceKey: { in: keys } } });
  await db.$disconnect();
});

describe('D-520 §2 — la contrainte refuse un état sans explication, ou une explication sans état', () => {
  it('prémisse : un état NORMALE sans cause et un état non normal expliqué sont acceptés', async () => {
    await expect(write({})).resolves.toMatchObject({ state: 'NORMALE', cause: null, trajectory: null });
    await expect(write({ state: 'BLOQUEE', cause: 'DEFAUT_INTERNE', trajectory: 'A_REPARER', lastCollectionKind: 'RUN' }))
      .resolves.toMatchObject({ state: 'BLOQUEE', cause: 'DEFAUT_INTERNE' });
  });

  it.each([
    ['NORMALE avec une cause', { cause: 'DEFAUT_INTERNE', trajectory: 'AUTO' }],
    ['NORMALE avec une trajectoire seule', { trajectory: 'AUTO' }],
    ['un état non normal sans cause ni trajectoire', { state: 'EN_ATTENTE' }],
    ['un état non normal sans trajectoire', { state: 'BLOQUEE', cause: 'LECTEUR' }],
    ['un état non normal sans cause', { state: 'DEGRADEE', trajectory: 'A_REPARER' }],
  ])('refuse %s', async (_, over) => {
    await expect(write(over)).rejects.toThrow('SourceOperationalState_explained_check');
  });

  it('refuse un état, une trajectoire ou une nature de collecte hors du vocabulaire fermé', async () => {
    await expect(write({ state: 'INCONNU', cause: 'LECTEUR', trajectory: 'AUTO' })).rejects.toThrow('SourceOperationalState_state_check');
    await expect(write({ state: 'BLOQUEE', cause: 'LECTEUR', trajectory: 'PLUS_TARD' })).rejects.toThrow('SourceOperationalState_trajectory_check');
    await expect(write({ lastCollectionKind: 'MANUELLE' })).rejects.toThrow('SourceOperationalState_kind_check');
  });

  it('aucune ligne refusée n’a été écrite', async () => {
    const written = await db.sourceOperationalState.findMany({ where: { sourceKey: { in: keys } }, select: { state: true, cause: true } });
    expect(written).toHaveLength(2);
  });
});
