import { NextRequest, NextResponse } from 'next/server';
import { suggestCities, suggestTitles } from '@/lib/jobs';
import { suggestCompanies } from '@/lib/companies';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import { randomUUID } from 'node:crypto';

/**
 * Search-bar autocomplete, from our own data (decision D12): cities, job titles
 * and Maison names the board actually holds, so a suggestion always leads
 * somewhere real. `?type=city|title|company&q=<prefix>` returns up to 8 strings.
 *
 * A quiet endpoint: on any failure it returns an empty list rather than an
 * error — a broken autocomplete must never break the search box.
 *
 * ── `?marche=XX` — LE CLOISONNEMENT DES VILLES PAR MARCHÉ ─────────────────
 *
 * Cette route ne recevait QUE `type` et `q` — vérifié en lisant la route, pas
 * en la supposant. Conséquence mesurée le 2026-09-15 : un candidat du marché
 * français qui tape « Paris » reçoit dans la même liste le Paris de France
 * (3 701 offres), celui du Texas (9), et ceux de Belgique et d'Espagne. 370
 * villes du catalogue existent ainsi dans plusieurs pays, dont les quatre plus
 * grosses (PARIS, NEW YORK, LONDRES, LOS ANGELES).
 *
 * Le paramètre suit exactement la convention de `/api/jobs`, qui lit déjà
 * `?marche=XX` pour ses facettes : même nom, même forme, même registre
 * (`@catwalks/db/marches`). Deux conventions pour la même notion, c'est deux
 * endroits à corriger le jour où un marché change.
 *
 * ── LE CLOISONNEMENT NE S'APPLIQUE QU'AUX VILLES, ET C'EST VOULU ──────────
 *
 * `title` et `company` ne sont PAS restreints. Un intitulé de poste et un nom
 * de Maison ne sont pas des objets géographiques : « Chanel » reste « Chanel »
 * sur tous les marchés, et masquer une Maison parce qu'elle recrute ailleurs
 * retirerait au candidat une suggestion parfaitement valide. Seule la ville
 * porte une ambiguïté de pays, donc seule la ville est cloisonnée.
 *
 * Le paramètre est transmis tel quel, sans validation ici : `marche()` porte
 * sa propre garde (absent, mal formé ou non mesuré → aucun cloisonnement).
 * Le valider une seconde fois ici créerait une liste de marchés à maintenir
 * en double, qui divergerait du registre au premier ajout.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const refus = refuserSiCleInvalide(request, randomUUID());
  if (refus) return refus;
  const type = request.nextUrl.searchParams.get('type');
  const q = request.nextUrl.searchParams.get('q') ?? '';
  const marche = request.nextUrl.searchParams.get('marche') ?? undefined;

  try {
    const suggestions =
      type === 'city'
        ? await suggestCities(q, marche)
        : type === 'company'
          ? await suggestCompanies(q)
          : await suggestTitles(q);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
