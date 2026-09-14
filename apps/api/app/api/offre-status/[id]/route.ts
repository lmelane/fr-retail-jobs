import { NextResponse, type NextRequest } from 'next/server';
import { getOfferState } from '@/lib/jobs';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import { randomUUID } from 'node:crypto';

/**
 * Lightweight status probe for a single offer, used by middleware to decide the
 * HTTP status of /offre/[id]: 'active' | 'closed' | 'missing'. Kept as its own
 * tiny endpoint because middleware runs on the edge and cannot open a Prisma
 * connection — this Node route can.
 *
 * A DB blip must not turn every offer into a 410: on error it answers 'active'
 * so the page renders normally rather than the whole board 410-ing.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const refus = refuserSiCleInvalide(request, randomUUID());
  if (refus) return refus;
  const { id } = await params;
  try {
    return NextResponse.json({ status: await getOfferState(id) });
  } catch {
    return NextResponse.json({ status: 'active' });
  }
}
