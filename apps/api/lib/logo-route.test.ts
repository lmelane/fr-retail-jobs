import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/logo/route';
import { imageSize } from './image-size';
import { MIN_LOGO_PX } from './logo-choice';

/**
 * `/api/logo` de bout en bout, fournisseurs simulés : ce que le site affiche
 * dépend du statut rendu ici (200 = le logo, 404 = le monogramme).
 *
 * Mesure du 25/09/2026 : Lovisa, première Maison sans logo (1 282 offres),
 * reçoit un PNG de 31×32 px de DuckDuckGo ET de Google. Le seuil lisait la
 * seule largeur : 31 < 32, donc 404, alors que l'image s'affiche comme un
 * favicon de 32 px (la pastille est en `object-fit: contain`).
 */

/** Un PNG valide de dimensions données, au-delà des 100 octets sous lesquels la route ignore une réponse. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(160);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** Les deux fournisseurs servent la même image, comme pour Lovisa. */
function fournisseurs(image: Uint8Array) {
  const appels: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    appels.push(url);
    return new Response(image.slice(), { status: 200, headers: { 'content-type': 'image/png' } });
  }));
  return appels;
}

const logo = (domain: string, size = 64) => GET(new NextRequest(`http://api.test/api/logo?domain=${domain}&size=${size}`));

beforeEach(() => {
  // Hors production et sans clé configurée, le garde laisse passer (cle-api.ts) : on teste le choix du logo.
  vi.stubEnv('CATALOGUE_API_KEY', '');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('/api/logo — le côté qui décide est le plus grand', () => {
  it('sert le logo de Lovisa (31×32 chez les deux fournisseurs) au lieu du monogramme', async () => {
    const image = png(31, 32);
    // Prémisse : l'image atteint le seuil par sa hauteur SEULEMENT. Sinon ce témoin ne toucherait pas le défaut.
    expect(imageSize(image)).toEqual({ width: 31, height: 32 });
    expect(31).toBeLessThan(MIN_LOGO_PX);
    const appels = fournisseurs(image);

    const carte = await logo('lovisa.com', 64);
    expect(appels).toHaveLength(2);
    expect(carte.status).toBe(200);
    expect(new Uint8Array(await carte.arrayBuffer())).toEqual(image);
    // La fiche (48 px, demandée en 96) applique le même seuil.
    expect((await logo('lovisa.com', 96)).status).toBe(200);
  });

  it('garde le monogramme pour un favicon de 16 px (décision D9, inchangée)', async () => {
    fournisseurs(png(16, 16));
    expect((await logo('rituals.com')).status).toBe(404);
  });

  it("garde le monogramme quand aucun côté n'atteint 32 px (Soeur 20×30, Petrol Industries 25×21)", async () => {
    fournisseurs(png(20, 30));
    expect((await logo('soeur.fr')).status).toBe(404);
    fournisseurs(png(25, 21));
    expect((await logo('petrolindustries.com')).status).toBe(404);
  });
});
