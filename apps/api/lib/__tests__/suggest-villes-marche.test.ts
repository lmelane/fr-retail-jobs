import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { estCodeMarche, type Perimetre } from '@catwalks/db/marches';
import { exigerPerimetre } from '../perimetre';

/**
 * TÉMOIN — LE CLOISONNEMENT DES VILLES PAR MARCHÉ (arbitrage CEO, option A),
 * étendu au lot 6 : le périmètre est obligatoire, et il peut couvrir plusieurs
 * pays (DE sert DE et AT) ou un pays sans marché mesuré (JP).
 *
 * « Je sélectionne FR → je ne vois que des villes FR ; je sélectionne US →
 * uniquement des villes US. » Cloisonnement strict, comme Indeed.
 *
 * ── POURQUOI CE TÉMOIN PARLE À UNE VRAIE BASE ─────────────────────────────
 *
 * Parce que le défaut qu'il garde vit dans le SQL, et nulle part ailleurs. La
 * déduction du pays est une CTE avec un `HAVING COUNT(DISTINCT …) = 1` et un
 * `COALESCE` dont l'abstention repose sur la logique ternaire de SQL
 * (`NULL = ANY(...)` est faux). Une doublure de Prisma ne prouverait que ce
 * qu'on lui a fait dire : elle passerait au vert avec un `HAVING` inversé.
 *
 * ── LE JEU D'ESSAI EST CONSTRUIT POUR EXERCER CHAQUE BRANCHE ──────────────
 *
 *   PARIS      FR + US + ES  → la ville multi-pays ; 288 comme elle en prod
 *   AUSTIN     US seul       → la ville qui ne doit apparaître QU'en US
 *   LEVALLOIS  sans pays, vue ailleurs en FR seul   → DÉDUCTIBLE → FR
 *   BEDFORD    sans pays, vue ailleurs en GB ET US  → AMBIGUË → nulle part
 *   ZURVILLE   sans pays, vue nulle part ailleurs   → SANS OCCURRENCE → idem
 *   PADERBORN  AT                                   → servie par le marché DE
 *   PAKKO      JP                                   → servie par le périmètre JP, sans marché
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

/** Un identifiant de semis reconnaissable : le nettoyage ne touche que lui. */
const MARQUEUR = 'temoin-villes-marche';

type Semis = { ville: string; pays: string | null; n: number };

const SEMIS: readonly Semis[] = [
  { ville: 'Paris', pays: 'FR', n: 5 },
  { ville: 'Paris', pays: 'US', n: 2 },
  { ville: 'Paris', pays: 'ES', n: 1 },
  { ville: 'Austin', pays: 'US', n: 4 },
  { ville: 'Pantin', pays: 'FR', n: 3 },
  { ville: 'Panjin', pays: 'CN', n: 6 },
  { ville: 'Paal', pays: 'BE', n: 7 },
  { ville: 'Paderborn', pays: 'AT', n: 2 },
  { ville: 'Pakko', pays: 'JP', n: 2 },
  { ville: 'Levallois', pays: null, n: 3 },
  { ville: 'Levallois', pays: 'FR', n: 1 },
  { ville: 'Bedford', pays: null, n: 3 },
  { ville: 'Bedford', pays: 'GB', n: 1 },
  { ville: 'Bedford', pays: 'US', n: 1 },
  { ville: 'Panzurville', pays: null, n: 3 },
];

describe.skipIf(!actif)('suggestCities — cloisonnement par périmètre', () => {
  let suggestCities: (q: string, perimetre: Perimetre) => Promise<string[]>;
  let prisma: import('@prisma/client').PrismaClient;
  const P = (code: string) => exigerPerimetre(code);

  beforeAll(async () => {
    ({ prisma } = await import('@catwalks/db'));
    ({ suggestCities } = await import('../suggestions'));
    await nettoyer();

    const entreprise = await prisma.company.create({
      data: { name: MARQUEUR, canonicalKey: MARQUEUR, fashionjobsUrl: `https://example.invalid/${MARQUEUR}` },
    });
    let i = 0;
    await prisma.job.createMany({
      data: SEMIS.flatMap((s) =>
        Array.from({ length: s.n }, () => {
          const numero = i++;
          return {
            companyId: entreprise.id,
            externalId: `${MARQUEUR}-${numero}`,
            source: 'UNKNOWN' as const,
            title: 'Conseiller de vente',
            url: `https://example.invalid/${MARQUEUR}/${numero}`,
            city: s.ville,
            countryCode: s.pays,
            isActive: true,
          };
        }),
      ),
    });
    const jobs = await prisma.job.findMany({ where: { companyId: entreprise.id }, select: { id: true, externalId: true, url: true } });
    await prisma.jobSource.createMany({ data: jobs.map(job => ({ jobId: job.id, externalId: job.externalId,
      sourceKey: MARQUEUR, sourceTier: 'ATS_OFFICIAL', url: job.url })) });
  }, 120_000);

  afterAll(async () => {
    if (!actif) return;
    await nettoyer();
    await prisma.$disconnect();
  });

  async function nettoyer() {
    await prisma.jobSource.deleteMany({ where: { job: { externalId: { startsWith: MARQUEUR } } } }); await prisma.job.deleteMany({ where: { externalId: { startsWith: MARQUEUR } } });
    await prisma.company.deleteMany({ where: { name: MARQUEUR } });
  }

  it('PRÉMISSE — le jeu d’essai exerce réellement chaque branche', async () => {
    const parPays = await prisma.job.groupBy({
      by: ['countryCode'],
      where: { externalId: { startsWith: MARQUEUR }, city: 'Paris' },
      _count: { _all: true },
    });
    expect(parPays.length).toBeGreaterThan(1);
    expect(parPays.map((p) => p.countryCode).sort()).toEqual(['ES', 'FR', 'US']);

    const paysConnus = async (ville: string) =>
      (await prisma.job.groupBy({ by: ['countryCode'], where: { externalId: { startsWith: MARQUEUR }, city: ville, countryCode: { not: null } } }))
        .map((r) => r.countryCode).sort();
    const orpheline = async (ville: string) =>
      prisma.job.count({ where: { externalId: { startsWith: MARQUEUR }, city: ville, countryCode: null } });

    expect(await orpheline('Levallois')).toBeGreaterThan(0);
    expect(await paysConnus('Levallois')).toEqual(['FR']);
    expect(await orpheline('Bedford')).toBeGreaterThan(0);
    expect(await paysConnus('Bedford')).toEqual(['GB', 'US']);
    expect(await orpheline('Panzurville')).toBeGreaterThan(0);
    expect(await paysConnus('Panzurville')).toEqual([]);
  });

  it('marché FR — « Paris » ne rend QUE la ville française', async () => {
    const villes = await suggestCities('Paris', P('FR'));
    expect(villes).toContain('Paris');
    expect(villes.filter((v) => v.toLowerCase() === 'paris')).toHaveLength(1);
  });

  it('marché FR — une ville purement américaine est absente', async () => {
    expect(await suggestCities('Aus', P('FR'))).not.toContain('Austin');
    expect(await suggestCities('Pan', P('FR'))).toContain('Pantin');
  });

  it('marché US — les villes américaines, et elles seules', async () => {
    expect(await suggestCities('Aus', P('US'))).toContain('Austin');
    expect(await suggestCities('Pan', P('US'))).not.toContain('Pantin');
    expect(await suggestCities('Paris', P('US'))).toContain('Paris');
  });

  it('ville DÉDUCTIBLE — un seul pays ailleurs, donc rattachée à ce marché', async () => {
    expect(await suggestCities('Levallois', P('FR'))).toContain('Levallois');
    expect(await suggestCities('Levallois', P('US'))).not.toContain('Levallois');
  });

  it('ville AMBIGUË — deux pays possibles, donc absente de tous les marchés', async () => {
    expect(await prisma.job.count({ where: { externalId: { startsWith: MARQUEUR }, city: 'Bedford', countryCode: 'GB' } })).toBe(1);
    expect(await suggestCities('Bedford', P('FR'))).not.toContain('Bedford');
  });

  it('ville SANS OCCURRENCE ailleurs — abstention, jamais de pays inventé', async () => {
    expect(await suggestCities('Panzurville', P('FR'))).not.toContain('Panzurville');
    expect(await suggestCities('Panzurville', P('US'))).not.toContain('Panzurville');
  });

  it('un périmètre à deux pays sert les villes des deux — DE sert l’Autriche', async () => {
    // Prémisse : le marché DE couvre bien DE et AT.
    expect(P('DE').pays).toEqual(['DE', 'AT']);
    expect(await suggestCities('Pad', P('DE'))).toContain('Paderborn');
    expect(await suggestCities('Pad', P('FR'))).not.toContain('Paderborn');
  });

  it('un pays sans marché mesuré est servi comme périmètre, jamais fondu dans le monde', async () => {
    // Prémisse : JP n'est pas un marché du registre.
    expect(estCodeMarche('JP')).toBe(false);
    expect(await suggestCities('Pak', P('JP'))).toEqual(['Pakko']);
    expect(await suggestCities('Pa', P('JP'))).toEqual(['Pakko']);
  });

  it.each([['CN', 'Panjin'], ['BE', 'Paal']] as const)(
    '%s — les suggestions locales sont présentes et les villes étrangères exclues',
    async (code, ville) => {
      expect(estCodeMarche(code), 'le marché doit être enregistré').toBe(true);
      expect(await suggestCities('Pa', P(code))).toEqual([ville]);
      expect(await suggestCities('Pa', P('FR'))).not.toContain(ville);
    },
  );

  it('la frappe ne peut pas devenir un joker LIKE', async () => {
    expect(await suggestCities('%%', P('FR'))).toEqual([]);
    expect(await suggestCities('P%', P('FR'))).toEqual([]);
    expect(await suggestCities('_a', P('FR'))).toEqual([]);
  });
});
