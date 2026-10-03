import type { NextRequest } from 'next/server';
import { lireEnLectureSeule, routeOps } from '@/lib/ops/lecture';
import { cleDemandee, lireSante, lireSource } from '@/lib/ops/sources';

/** D-522 §5 — le détail d'une source : sa ligne, ses dernières collectes, son portail, ses questions d'identité ouvertes. */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ cle: string }> }) {
  const { cle } = await params;
  return routeOps(request, 'source', async () => {
    const valide = cleDemandee(cle);
    const now = new Date();
    const sante = await lireSante(now);
    return lireEnLectureSeule(tx => lireSource(tx, valide, sante, now));
  });
}
