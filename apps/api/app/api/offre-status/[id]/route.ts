import { NextResponse, type NextRequest } from 'next/server';
import { getOfferState } from '@/lib/jobs';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import { randomUUID } from 'node:crypto';

/** A temporary catalogue/readiness failure is unavailable, never an employer closure or proof of activity. */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const refus = refuserSiCleInvalide(request, randomUUID());
  if (refus) return refus;
  const { id } = await params;
  try {
    return NextResponse.json({ status: await getOfferState(id) });
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '60' } });
  }
}
