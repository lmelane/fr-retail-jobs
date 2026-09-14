import { NextResponse } from 'next/server';
import { prisma } from '@catwalks/db';

export const dynamic = 'force-dynamic';

/** Readiness includes the database and columns required by this application. */
export async function GET() {
  try {
    const expected: { name: string; checksum: string }[] = JSON.parse(process.env.CATWALKS_SCHEMA_MIGRATIONS ?? 'null');
    if (!Array.isArray(expected) || !expected.length || expected.some(m =>
      typeof m.name !== 'string' || !/^[a-f0-9]{64}$/.test(m.checksum))) {
      throw new Error('Missing schema contract');
    }
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
      const applied = await tx.$queryRaw<{ migration_name: string; checksum: string; finished_at: Date | null }[]>`
        SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`;
      if (applied.some(m => !m.finished_at) || expected.some(m => !applied.some(a =>
        a.migration_name === m.name && a.checksum === m.checksum && a.finished_at))) {
        throw new Error('Database migration contract not satisfied');
      }
      await tx.$queryRaw`SELECT "countryCode", "searchText", "canonicalSourceKey" FROM "Job" LIMIT 0`;
      await tx.$queryRaw`SELECT "complete", "canAttestAbsence" FROM "SourceRun" LIMIT 0`;
    }, { maxWait: 2000, timeout: 3000 });
    return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
