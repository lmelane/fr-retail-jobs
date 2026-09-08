import { NextResponse } from 'next/server';
import { prisma } from '@catwalks/db';

export const dynamic = 'force-dynamic';

/** Readiness includes the database and columns required by this application. */
export async function GET() {
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
      await tx.$queryRaw`SELECT "countryCode", "searchText", "canonicalSourceKey" FROM "Job" LIMIT 0`;
      await tx.$queryRaw`SELECT "complete", "canAttestAbsence" FROM "SourceRun" LIMIT 0`;
    }, { maxWait: 2000, timeout: 3000 });
    return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
