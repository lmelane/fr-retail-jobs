import { NextResponse } from 'next/server';

/**
 * Favicon d'une Maison, ou 404 — jamais le carré gris.
 *
 * DuckDuckGo répond `404` MAIS avec une image valide de 1 478 octets quand le
 * domaine n'existe pas. Un `<img>` affiche donc ce placeholder sans jamais
 * déclencher `onError` : mesuré le 2026-09-05, c'est la vraie cause des logos
 * « catastrophe » signalés par Loïc — un carré gris identique sur des dizaines
 * de Maisons, là où le monogramme de la marque aurait été lisible.
 *
 * Cette route lit le statut, que le navigateur ne peut pas voir sur une balise
 * image, et renvoie 404 quand la source en renvoie un. Le composant tombe alors
 * proprement sur son monogramme.
 *
 * Deux fournisseurs, dans l'ordre : DuckDuckGo (sans clé, respectueux de la vie
 * privée — décision D9) puis Google en secours, qui couvre des domaines que le
 * premier ignore. Aucun des deux ne reçoit d'information sur le visiteur : la
 * requête part du serveur.
 */

/** Le placeholder « domaine inconnu » de DuckDuckGo, à l'octet près. */
const DDG_PLACEHOLDER_BYTES = 1478;

const PROVIDERS = [
  (domain: string) => `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
];

/** Un hôte simple : lettres, chiffres, tirets et points. Rien d'autre. */
const DOMAIN_RE = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63}){1,3}$/;

export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get('domain')?.toLowerCase().trim();

  // Le domaine vient d'un nom de Maison, donc de données ingérées : on ne le
  // concatène jamais dans une URL sortante sans l'avoir validé (SSRF).
  if (!domain || !DOMAIN_RE.test(domain)) {
    return new NextResponse(null, { status: 400 });
  }

  for (const buildUrl of PROVIDERS) {
    try {
      const response = await fetch(buildUrl(domain), { signal: AbortSignal.timeout(4000) });
      if (!response.ok) continue;

      const bytes = new Uint8Array(await response.arrayBuffer());
      // Trop petit pour être un logo, ou exactement le placeholder : on passe au
      // fournisseur suivant plutôt que de servir une image qui ne dit rien.
      if (bytes.byteLength < 100 || bytes.byteLength === DDG_PLACEHOLDER_BYTES) continue;

      return new NextResponse(bytes, {
        status: 200,
        headers: {
          'content-type': response.headers.get('content-type') ?? 'image/png',
          // Un favicon change rarement : un jour de cache navigateur/CDN évite
          // de re-solliciter le fournisseur à chaque affichage de liste.
          'cache-control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
        },
      });
    } catch {
      // Fournisseur injoignable : on tente le suivant, jamais d'erreur au client.
    }
  }

  // Aucun logo : 404 explicite, pour que le composant affiche son monogramme.
  return new NextResponse(null, { status: 404 });
}
