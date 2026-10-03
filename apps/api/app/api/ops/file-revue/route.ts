import type { NextRequest } from 'next/server';
import { lireEnLectureSeule, routeOps } from '@/lib/ops/lecture';
import { lireSante, lireSources } from '@/lib/ops/sources';
import { lireFileRevue } from '@/lib/ops/file-revue';

/** D-522 §5 — la file de revue en lecture : identité d'employeur, registre à trancher ou ambigu, sources en revue, couverture à vérifier. */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return routeOps(request, 'file-revue', async () => {
    const now = new Date();
    const sante = await lireSante(now);
    return lireEnLectureSeule(async tx => lireFileRevue(tx, await lireSources(tx, sante, now), now));
  });
}
