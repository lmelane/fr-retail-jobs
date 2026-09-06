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
/**
 * Hôte canonique (D30 — domaine modecareers.com) : le sous-domaine Railway et
 * www redirigent en 301 vers l'apex, même chemin — un seul hôte accumule
 * l'autorité SEO, et les URLs Railway déjà vues par Google migrent proprement.
 */
const CANONICAL_HOST = 'modecareers.com';
const LEGACY_HOSTS = new Set(['catwalks-web-production.up.railway.app', `www.${CANONICAL_HOST}`]);

export async function middleware(request: NextRequest) {
  const host = request.headers.get('host')?.toLowerCase() ?? '';
  if (LEGACY_HOSTS.has(host)) {
    const target = request.nextUrl.clone();
    target.protocol = 'https:';
    target.host = CANONICAL_HOST;
    target.port = '';
    return NextResponse.redirect(target, 301);
  }

  const match = request.nextUrl.pathname.match(/^\/offre\/([^/]+)\/?$/);
  if (!match) return NextResponse.next();
  const id = decodeURIComponent(match[1]);

  try {
    // Sonde en clair sur le port local : derrière le proxy Railway, Next compose
    // request.url = https://0.0.0.0:8080/… (x-forwarded-proto), le TLS échouait
    // sur un port HTTP et le catch rendait 200 — 10/10 offres fermées en 200 en
    // prod, jamais 410 (audit A5, 2026-09-06).
    const probe = await fetch(new URL(`/api/offre-status/${encodeURIComponent(id)}`, `http://127.0.0.1:${process.env.PORT ?? 8080}`), {
      headers: { 'x-internal-probe': '1' },
    });
    if (!probe.ok) {
      console.error(`[offre-status] sonde ${probe.status} pour ${id}`);
      return NextResponse.next();
    }
    const { status } = (await probe.json()) as { status: 'active' | 'closed' | 'missing' };
    if (status !== 'closed') return NextResponse.next();

    // Rendu de la page réelle, mais avec le statut 410 + noindex : Google
    // déréférence, le candidat voit l'offre expirée avec son bandeau.
    return NextResponse.rewrite(request.nextUrl, {
      status: 410,
      headers: { 'x-robots-tag': 'noindex' },
    });
  } catch (error) {
    // Jamais silencieux : une sonde qui échoue rend une offre fermée en 200
    // (audit A5 : 10/10 fermées en 200, cause invisible pendant des jours).
    console.error(`[offre-status] sonde en échec pour ${id} : ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.next();
  }
}

export const config = {
  // Every path: the canonical-host 301 must cover the whole site. The offer
  // status probe still only triggers on /offre/:id inside the handler.
  // Assets/_next are excluded — a 301 sur un chunk hashé n'apporte rien.
  matcher: ['/((?!_next/|favicon|fonts/).*)'],
};
