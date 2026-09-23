import '../test/setup-integration.js';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { attestSyntheticFeed, collectAdmittedWithoutCompletion, qualifiedSource, releaseQualifiedSources } from '../test/ingestionFixture.js';
import { readOperationalMode } from '../registry/operationalMode.js';

const db = new PrismaClient();
const key = () => `mode-${randomUUID()}`;
afterAll(async () => { await releaseQualifiedSources(db); await db.$disconnect(); });

it('does not require a superseded identity review and refuses closure before publication completes', async () => {
  const source = await qualifiedSource(db, key());
  await collectAdmittedWithoutCompletion(db, source.key, []);
  expect(await readOperationalMode(db, source)).toMatchObject({ mode: 'PUBLISH_NO_CLOSE' });
});
it('uses the sealed completion for a proven empty feed, then respects PAUSED immediately', async () => {
  const name = key(); await attestSyntheticFeed(db, name, []);
  const source = await db.source.findUniqueOrThrow({ where: { key: name } });
  expect(await readOperationalMode(db, source)).toMatchObject({ mode: 'FULL_AUTOMATION' });
  const paused = await db.source.update({ where: { key: name }, data: { status: 'PAUSED' } });
  expect(await readOperationalMode(db, paused)).toMatchObject({ mode: 'PAUSED_BLOCKED' });
});
it('does not authorize publication from an old successful health row when validation expired', async () => {
  const source = await qualifiedSource(db, key());
  expect(await readOperationalMode(db, source, new Date(Date.now() + 25 * 3600_000))).toMatchObject({ mode: 'EVIDENCE_ONLY' });
});
