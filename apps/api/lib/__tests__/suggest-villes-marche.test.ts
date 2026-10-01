import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { estCodeMarche, type Perimetre } from '@catwalks/db/marches';
import { exigerPerimetre } from '../perimetre';
import { semerVilles, viderVilles, VILLES_TEMOINS, type VilleTemoin } from '../__fixtures__/villes';

/**
 * TÉMOIN — LE CLOISONNEMENT DES VILLES PAR MARCHÉ (arbitrage CEO, option A), étendu au lot 6 : le périmètre est
 * obligatoire, et il peut couvrir plusieurs pays (DE sert DE et AT) ou un pays sans marché mesuré (BG).
 *
 * « Je sélectionne FR → je ne vois que des villes FR ; je sélectionne US → uniquement des villes US. » Cloisonnement
 * strict, comme Indeed.
 *
 * Depuis D-496 (01/10/2026), les villes viennent de la base mondiale de villes (`GeoCity`, GeoNames), plus du texte des
 * offres : la déduction du pays d'une ville d'offre sans pays (Levallois, Bedford, Panzurville) n'a plus d'objet et ses
 * cas sont retirés. Le cloisonnement, lui, est gardé ici, sur une vraie base, parce qu'il vit dans le SQL
 * (`n."countryCode" = ANY(périmètre)`).
 */
const url = process.env.DATABASE_URL ?? '';
const nomBase = (() => {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();
const actif = Boolean(url) && /test/i.test(nomBase);

const ville = (id: number, name: string, pays: string, lat: number, lon: number, pop: number, subdivision: string | null = null): VilleTemoin =>
  ({ id, name, pays, a1: null, a2: null, a1nom: null, subdivision, lat, lon, pop, fc: 'PPL' });
const VILLES: readonly VilleTemoin[] = [
  ...VILLES_TEMOINS,
  ville(2988621, 'Pantin', 'FR', 48.89437, 2.40935, 52922, '93'),
  ville(10794003, 'Panjin', 'CN', 41.121, 122.0739, 1166481),
  ville(2789388, 'Paal', 'BE', 51.03988, 5.17233, 11935),
  ville(2855745, 'Paderborn', 'DE', 51.71905, 8.75439, 142161),
  ville(2769225, 'Pasching', 'AT', 48.25931, 14.20369, 2409),
  ville(728378, 'Pazardzhik', 'BG', 42.19934, 24.33318, 55220),
];

describe.skipIf(!actif)('suggestCities — cloisonnement par périmètre', () => {
  let suggestCities: (q: string, perimetre: Perimetre) => Promise<string[]>;
  let prisma: import('@prisma/client').PrismaClient;
  const P = (code: string) => exigerPerimetre(code);

  beforeAll(async () => {
    ({ prisma } = await import('@catwalks/db'));
    ({ suggestCities } = await import('../suggestions'));
    await semerVilles(prisma, VILLES);
  }, 120_000);

  afterAll(async () => {
    if (!actif) return;
    await viderVilles(prisma);
    await prisma.$disconnect();
  });

  it('PRÉMISSE — « Paris » existe dans deux pays de la base, et « Pa » dans sept', async () => {
    const [{ pays }] = await prisma.$queryRaw<{ pays: string[] }[]>`SELECT array_agg(DISTINCT "countryCode" ORDER BY "countryCode") AS pays FROM "GeoCity" WHERE name = 'Paris'`;
    expect(pays).toEqual(['FR', 'US']);
    expect(new Set(VILLES.filter((v) => v.name.startsWith('Pa')).map((v) => v.pays)).size).toBeGreaterThanOrEqual(7);
  });

  it('marché FR — « Paris » ne rend QUE la ville française', async () => {
    // La ville, puis ses arrondissements (D-499) : aucun Paris d'un autre pays.
    expect(await suggestCities('Paris', P('FR'))).toEqual(['Paris (75)', 'Paris 15e (75)', 'Paris 9e (75)']);
  });

  it('marché FR — une ville purement américaine est absente', async () => {
    expect(await suggestCities('Aus', P('FR'))).toEqual([]);
    expect(await suggestCities('Pan', P('FR'))).toEqual(['Pantin (93)']);
  });

  it('marché US — les villes américaines, et elles seules', async () => {
    expect(await suggestCities('Aus', P('US'))).toEqual(['Austin (TX)']);
    expect(await suggestCities('Pan', P('US'))).toEqual([]);
    expect(await suggestCities('Paris', P('US'))).toEqual(['Paris (TX)', 'Paris (KY)']);
  });

  it('un périmètre à deux pays sert les villes des deux — DE sert l’Autriche', async () => {
    // Prémisse : le marché DE couvre bien DE et AT.
    expect(P('DE').pays).toEqual(['DE', 'AT']);
    expect(await suggestCities('Pa', P('DE'))).toEqual(['Paderborn', 'Pasching']);
    expect(await suggestCities('Pad', P('FR'))).toEqual([]);
  });

  it('un pays sans marché mesuré est servi comme périmètre, jamais fondu dans le monde', async () => {
    expect(estCodeMarche('BG')).toBe(false);
    expect(await suggestCities('Pa', P('BG'))).toEqual(['Pazardzhik']);
  });

  it.each([['CN', 'Panjin'], ['BE', 'Paal']] as const)(
    '%s — les suggestions locales sont présentes et les villes étrangères exclues',
    async (code, nom) => {
      expect(estCodeMarche(code), 'le marché doit être enregistré').toBe(true);
      expect(await suggestCities('Pa', P(code))).toEqual([nom]);
      expect(await suggestCities('Pa', P('FR'))).not.toContain(nom);
    },
  );

  it('la frappe ne peut pas devenir un joker LIKE, ni une lettre seule', async () => {
    expect(await suggestCities('%%', P('FR'))).toEqual([]);
    expect(await suggestCities('P%', P('FR'))).toEqual([]);
    expect(await suggestCities('_a', P('FR'))).toEqual([]);
    expect(await suggestCities('P.', P('FR'))).toEqual([]);
  });
});
