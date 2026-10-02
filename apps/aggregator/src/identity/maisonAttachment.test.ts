import { describe, expect, it } from 'vitest';
import { attachAll, attachToMaison, nameTokens, type EmployerRow } from './maisonAttachment.js';

const row = (id: string, name: string, maisons: Array<string | null> = [], extra: Partial<EmployerRow> = {}): EmployerRow =>
  ({ id, name, kind: 'UNKNOWN', parentGroupId: null, sources: maisons.map((maison, i) => ({ sourceKey: `${id}-s${i}`, maison })), ...extra });

describe('R-143 §5 — a legal entity is attached to its Maison only on proof', () => {
  const nike = row('nike', 'NIKE');
  it('attaches entities named after the registry Maison of every source that published them', () => {
    for (const name of ['NIKE Retail UK', 'Nike Sports (China) Co.', 'NIKE de Mexico, S. de R.L. de C.V.', 'Nike Retail BV Branch'])
      expect(attachToMaison(row('e', name, ['Nike']), [nike])).toMatchObject({ status: 'ATTACHED', maisonId: 'nike', maison: 'NIKE' });
  });
  it('prepares the Maison row when the registry names a Maison nobody created yet', () => {
    expect(attachToMaison(row('e', 'PUMA Europe GmbH – Sede Secondaria in Italia', ['Puma']), [])).toMatchObject({ status: 'ATTACHED', maisonId: null, maison: 'Puma' });
  });
  it.each([
    ['a brand of the group published on the Maison tenant', row('e', 'Converse Inc', ['Nike']), 'NOT_AN_ENTITY'],
    ['the Maison row itself', row('e', 'Nike', ['Nike']), 'NOT_AN_ENTITY'],
    ['a name that only shares a first word', row('e', 'Nikeland GmbH', ['Nike']), 'NOT_AN_ENTITY'],
    ['an entity seen only on a group portal', row('e', 'LVMH Fragrance Brands', ['LVMH (toutes Maisons)']), 'NOT_AN_ENTITY'],
    ['an entity seen only on a reviewed multi-brand portal', row('e', 'Kering Eyewear', [], { sources: [{ sourceKey: 'k', maison: 'Kering', portalScope: 'MULTI_BRAND' }] }), 'NOT_AN_ENTITY'],
    ['an entity without any registry evidence', row('e', 'NIKE Retail UK', []), 'NOT_AN_ENTITY'],
  ])('leaves %s alone', (_name, entity, status) => {
    expect(attachToMaison(entity, [nike]).status).toBe(status);
  });
  it.each([
    ['another Maison also publishes it', row('e', 'Michael Kors (Italy) srl', ['Michael Kors', 'Jimmy Choo']), [row('mk', 'Michael Kors')], 'SOURCES_DISAGREE'],
    ['a job board also names it', row('e', 'NIKE Retail UK', ['Nike', null]), [nike], 'SOURCES_DISAGREE'],
    ['two rows carry the Maison name', row('e', 'NIKE Retail UK', ['Nike']), [nike, row('nike2', 'Nike')], 'MAISON_ROW_AMBIGUOUS'],
    ['the Maison row is a group', row('e', 'Kering Eyewear', ['Kering']), [row('k', 'Kering', [], { kind: 'GROUP' })], 'MAISON_IS_GROUP'],
    ['the entity is a group', row('e', 'NIKE Holding', ['Nike'], { kind: 'GROUP' }), [nike], 'ENTITY_IS_GROUP'],
    ['the parents differ', row('e', 'NIKE Retail UK', ['Nike'], { parentGroupId: 'g1' }), [nike], 'PARENT_CONFLICT'],
  ])('signals for review when %s', (_name, entity, rows, reason) => {
    expect(attachToMaison(entity, rows)).toMatchObject({ status: 'UNCERTAIN', reason });
  });
  it('never builds a chain: a Maison row that is itself attached suspends its entities', () => {
    const rows = [row('a', 'Alpha', ['Alpha']), row('b', 'Alpha Beta', ['Alpha']), row('c', 'Alpha Beta GmbH', ['Alpha Beta'])];
    const results = attachAll(rows);
    expect(results.find(r => r.entityId === 'b')).toMatchObject({ status: 'ATTACHED', maisonId: 'a' });
    expect(results.find(r => r.entityId === 'c')).toMatchObject({ status: 'UNCERTAIN', reason: 'MAISON_ROW_IS_ENTITY' });
  });
  it('compares names word for word', () => {
    expect(nameTokens('PUMA Europe GmbH – Sede')).toEqual(['puma', 'europe', 'gmbh', 'sede']);
    expect(nameTokens("Claire's Accessories UK Ltd")).toEqual(['claire', 's', 'accessories', 'uk', 'ltd']);
  });
});
