import { NextResponse, type NextRequest } from 'next/server';

/**
 * Expired-offer hygiene (D22, révisé 2026-09-03 par Loïc) : une offre fermée
 * renvoie le statut 410 Gone — Google la déréférence vite (un 404 est réessayé
 * des semaines, un 410 est retiré) — MAIS on laisse la VRAIE page /offre
 * s'afficher (offre + bandeau « Expirée » + offres similaires), plutôt qu'une
 * page-stub. Le meilleur des deux : SEO tenu ET le candidat voit l'offre et un
 * pont vers les offres vivantes de la Maison.
 *
 * Le composant de page ne peut pas fixer un code HTTP ; le middleware le fait
 * ici via un `rewrite` vers la même URL avec `status: 410`. Le rendu React de
 * la page (qui re-détecte 'closed' via getJobStatus) devient le corps du 410.
 *
 * Middleware runs on the edge and cannot query the database, so it asks the tiny
 * /api/offre-status/<id> Node route. Only 'closed' triggers the 410 rewrite;
 * 'missing' falls through to the page's own notFound() (404), 'active' renders
 * normally. A probe failure falls through too — never 410 an offer by accident.
 */
export async function middleware(request: NextRequest) {
  const match = request.nextUrl.pathname.match(/^\/offre\/([^/]+)\/?$/);
  if (!match) return NextResponse.next();
  const id = decodeURIComponent(match[1]);

  try {
    const probe = await fetch(new URL(`/api/offre-status/${encodeURIComponent(id)}`, request.url), {
      headers: { 'x-internal-probe': '1' },
    });
    if (!probe.ok) return NextResponse.next();
    const { status } = (await probe.json()) as { status: 'active' | 'closed' | 'missing' };
    if (status !== 'closed') return NextResponse.next();

    // Rendu de la page réelle, mais avec le statut 410 + noindex : Google
    // déréférence, le candidat voit l'offre expirée avec son bandeau.
    return NextResponse.rewrite(request.nextUrl, {
      status: 410,
      headers: { 'x-robots-tag': 'noindex' },
    });
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  // Only offer pages need the status check; everything else skips middleware.
  matcher: ['/offre/:id'],
};
