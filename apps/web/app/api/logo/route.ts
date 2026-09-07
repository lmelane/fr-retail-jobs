import { NextResponse } from 'next/server';
import { imageSize } from '@/lib/image-size';
import { bestLogo } from '@/lib/logo-choice';

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
 * Deux fournisseurs interrogés en parallèle : DuckDuckGo (sans clé, respectueux
 * de la vie privée — décision D9) et Google. Aucun des deux ne reçoit
 * d'information sur le visiteur : la requête part du serveur.
 *
 * Second défaut, mesuré le 2026-09-07 : le fournisseur de secours n'était
 * jamais atteint tant que le premier répondait 200, même avec une vignette de
 * 16 px. 57 Maisons sur 120 affichaient une image floue alors qu'une nette
 * existait chez l'autre — Louis Vuitton 16 px là où Google en servait 64.
 */

/** Le placeholder « domaine inconnu » de DuckDuckGo, à l'octet près. */
const DDG_PLACEHOLDER_BYTES = 1478;

const PROVIDERS = [
  (domain: string) => `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
];

/** Un hôte simple : lettres, chiffres, tirets et points. Rien d'autre. */
const DOMAIN_RE = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63}){1,3}$/;

type Logo = { bytes: ArrayBuffer; type: string; width: number; opaque: boolean };

/** Une image utilisable chez un fournisseur, ou `null` — jamais d'exception. */
async function fetchLogo(url: string): Promise<Logo | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    // Trop petit pour être un logo, ou exactement le placeholder : on ignore.
    if (buffer.byteLength < 100 || buffer.byteLength === DDG_PLACEHOLDER_BYTES) return null;

    // Format que l'on ne sait pas mesurer : largeur 0, donc retenu seulement
    // faute de mieux — et refusé par le seuil, qui ne devine jamais.
    const bytes = new Uint8Array(buffer);
    const width = imageSize(bytes)?.width ?? 0;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    return { bytes: buffer, type: response.headers.get('content-type') ?? 'image/png', width, opaque: isJpeg };
  } catch {
    // Fournisseur injoignable : l'autre peut suffire, jamais d'erreur au client.
    return null;
  }
}

export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get('domain')?.toLowerCase().trim();

  // Le domaine vient d'un nom de Maison, donc de données ingérées : on ne le
  // concatène jamais dans une URL sortante sans l'avoir validé (SSRF).
  if (!domain || !DOMAIN_RE.test(domain)) {
    return new NextResponse(null, { status: 400 });
  }

  // Les deux fournisseurs sont interrogés EN PARALLÈLE et on garde la plus
  // grande image. Aucun des deux ne domine l'autre (mesuré le 2026-09-07 sur
  // les 120 Maisons les plus actives) : Google couvre plus de domaines et
  // gagne 53 fois en netteté, mais il plafonne à 64 px là où DuckDuckGo sert
  // l'icône réelle du site — Ulta Beauty 1024 px, Crocs et GANT 256 px, Canada
  // Goose 144 px que Google ignore. Prendre le premier qui répond, ou n'en
  // garder qu'un, dégrade l'un ou l'autre de ces groupes.
  const candidates = await Promise.all(PROVIDERS.map((buildUrl) => fetchLogo(buildUrl(domain))));
  // Sous le seuil de lisibilité, `bestLogo` rend null : le monogramme de la
  // Maison vaut mieux qu'une image baveuse (D9).
  const best = bestLogo(candidates);
  if (!best) return new NextResponse(null, { status: 404 });

  return new NextResponse(best.bytes, {
    status: 200,
    headers: {
      'content-type': best.type,
      // Un favicon change rarement : un jour de cache navigateur/CDN évite
      // de re-solliciter le fournisseur à chaque affichage de liste.
      'cache-control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
    },
  });
}
