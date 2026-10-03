import type { NextRequest } from 'next/server';
import { lireEnLectureSeule, routeOps } from '@/lib/ops/lecture';
import { lireSante, lireSources } from '@/lib/ops/sources';
import { lireVueEnsemble } from '@/lib/ops/vue-ensemble';

/** D-522 §5 — la vue d'ensemble de la console Agrégateur. Clé `CATALOGUE_OPS_KEY` seule, lecture seule. */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return routeOps(request, 'vue-ensemble', async () => {
    const now = new Date();
    const sante = await lireSante(now);
    return lireEnLectureSeule(async tx => lireVueEnsemble(tx, await lireSources(tx, sante, now), sante, now));
  });
}
