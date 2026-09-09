/**
 * Guard rail for integration tests.
 *
 * These tests call deleteMany() to reset state, so they MUST run against a
 * dedicated test database — never the working/demo database. This refuses to run
 * unless DATABASE_URL points at a database whose name marks it as a test DB, so a
 * stray `vitest run` can never wipe real data again.
 */
const url = process.env.DATABASE_URL ?? '';

function databaseName(connectionUrl: string): string {
  try {
    return new URL(connectionUrl).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

const name = databaseName(url);

if (!url) {
  throw new Error(
    'Integration tests need DATABASE_URL set to a TEST database (e.g. …/catwalks_test).',
  );
}

if (!/test/i.test(name)) {
  throw new Error(
    `Refusing to run integration tests against "${name}": the database name must contain "test" ` +
      `so real data cannot be wiped. Point DATABASE_URL at a dedicated test database.`,
  );
}

// The immutable occupation ledger restricts deleting its Job. Only this guarded
// disposable test database may truncate it between tests; production repairs
// retain the ledger. The afterEach also permits existing afterAll cleanup.
import { beforeEach, afterEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
const occupationTestDb = new PrismaClient();
export const clearOccupationLedger = async () => { await occupationTestDb.$executeRaw`TRUNCATE "OccupationObservation"`; };
beforeEach(clearOccupationLedger);
afterEach(clearOccupationLedger);
afterAll(async () => { await occupationTestDb.$disconnect(); });
