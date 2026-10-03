import type { NextRequest } from 'next/server';
import { lireEnLectureSeule, routeOps } from '@/lib/ops/lecture';
import { lireSante, lireSources, synthese } from '@/lib/ops/sources';

/**
 * D-522 §5 — toutes les sources du registre (543 le 03/10/2026), chacune avec son état, sa cause, sa trajectoire, ce qui
 * manque, depuis quand, son échéance, ses offres en jeu, son prochain réexamen et sa dernière collecte. Le tableau se
 * filtre et se trie côté console : la liste entière tient en une réponse.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return routeOps(request, 'sources', async () => {
    const now = new Date();
    const sante = await lireSante(now);
    return lireEnLectureSeule(async tx => {
      const lecture = await lireSources(tx, sante, now);
      return { at: lecture.at, etatCalcule: lecture.etatCalcule, synthese: synthese(lecture), sources: lecture.lignes };
    });
  });
}
