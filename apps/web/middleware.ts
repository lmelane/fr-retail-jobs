import { NextResponse, type NextRequest } from 'next/server';

/**
 * Expired-offer hygiene (D22): an offer that was closed must return 410 Gone, so
 * Google drops it from the index fast — a 404 is retried for weeks, a 410 is
 * removed. Next's page components can only emit 404 (notFound()), so the status
 * is set here, in middleware.
 *
 * Middleware runs on the edge and cannot query the database, so it asks the tiny
 * /api/offre-status/<id> Node route. Only 'closed' triggers a 410; 'missing'
 * falls through to the page's own notFound() (404), 'active' renders normally. A
 * probe failure falls through too — never 410 an offer by accident.
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

    return new NextResponse(GONE_HTML, {
      status: 410,
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' },
    });
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  // Only offer pages need the status check; everything else skips middleware.
  matcher: ['/offre/:id'],
};

/** Minimal, on-brand "offer no longer available" body served with the 410. */
const GONE_HTML = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Offre expirée — Fashion Atlas</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#FAFAFA;color:#000;
font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.4px}
.b{max-width:34rem;padding:2rem;text-align:center}h1{font-weight:400;font-size:1.5rem;text-transform:uppercase;letter-spacing:.4px}
p{color:#767676;line-height:1.6}a{display:inline-block;margin-top:1.25rem;padding:.75rem 1.75rem;border-radius:100vmax;
background:#000;color:#fff;text-decoration:none;font-size:.95rem}</style></head>
<body><div class="b"><h1>Cette offre n'est plus disponible</h1>
<p>Elle a été pourvue ou retirée par l'employeur. Des milliers d'autres offres Mode, Luxe, Beauté & Retail vous attendent.</p>
<a href="/emplois">Voir les offres</a></div></body></html>`;
