import type { NextRequest } from 'next/server';
import { lireEnLectureSeule, routeOps } from '@/lib/ops/lecture';
import { lirePourquoi, refDemandee } from '@/lib/ops/pourquoi';

/** D-522 §5, D-520 §3 — pourquoi une offre est ou n'est pas exposée (`?ref=` : identifiant, lien, ou `source:identifiant`). */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return routeOps(request, 'pourquoi', async () => {
    const ref = refDemandee(request.nextUrl.searchParams.get('ref'));
    return lireEnLectureSeule(tx => lirePourquoi(tx, ref, new Date()));
  });
}
