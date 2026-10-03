import type { NextRequest } from 'next/server';
import { lireEnLectureSeule, routeOps } from '@/lib/ops/lecture';
import { lireCouverture } from '@/lib/ops/couverture';

/** D-522 §5 — la couverture par Maison et par marché : servie maintenant, au dernier RUN, référence et perte posée. */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return routeOps(request, 'couverture', async () => lireEnLectureSeule(tx => lireCouverture(tx, new Date())));
}
