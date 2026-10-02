import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { semerVilles, viderVilles, VILLES_TEMOINS } from '../__fixtures__/villes';

/**
 * LA CLÉ DU BACKEND LIT LA FORME RECONNUE D'UN LIEU — lecture D-492 sous D-496 (« Paris » et « Paris (75) », finitions
 * de la V2), 02/10/2026.
 *
 * Le backend réunit « Paris » et « Paris (75) » là où le site ne passe pas (préférences et recherches récentes déjà en
 * base, alertes de l'onboarding et de la conversion, liste des recherches récentes). Il lit pour cela la première
 * suggestion de lieu du même nom qui porte une subdivision (`lieux/formes-reconnues.ts` du backend :
 * `GET /api/suggest?type=city&q=<nom>&marche=XX`, `x-catwalks-client: 2`, sa clé). Avant ce lot, sa clé y recevait 401.
 *
 * La portée ouverte est la plus petite qui serve ce besoin : `type=city` seulement. Les intitulés, les Maisons et les
 * métiers restent au site seul (une clé de serveur n'a rien à lire qu'elle ne consomme pas).
 */
const SITE = 'cle-du-site-suggest';
const BACKEND = 'cle-du-backend-suggest';

const appel = (params: Record<string, string>, cle?: string, contrat2 = true): NextRequest =>
  new NextRequest(`http://catalogue.test/api/suggest?${new URLSearchParams(params).toString()}`, {
    headers: { ...(cle ? { authorization: `Bearer ${cle}` } : {}), ...(contrat2 ? { 'x-catwalks-client': '2' } : {}) },
  });

describe('/api/suggest — la portée de la clé du backend', () => {
  let GET: (r: NextRequest) => Promise<Response>;
  beforeAll(async () => {
    ({ GET } = await import('../../app/api/suggest/route'));
  });
  beforeEach(() => {
    vi.stubEnv('CATALOGUE_API_KEY', SITE);
    vi.stubEnv('CATALOGUE_API_KEY_BACKEND', BACKEND);
  });
  afterEach(() => vi.unstubAllEnvs());

  // Sans `marche`, une requête qui a passé le garde reçoit 400 (périmètre obligatoire) sans toucher la base : la
  // réponse dit donc, sans base, si le garde a laissé passer (400) ou refusé (401).
  it('la clé du backend passe le garde sur les suggestions de lieu (type=city), et seulement là', async () => {
    expect((await GET(appel({ type: 'city', q: 'Paris' }, BACKEND))).status).toBe(400);
    for (const type of ['title', 'company', 'metier', '', 'CITY', 'city ']) {
      const r = await GET(appel({ type, q: 'Paris' }, BACKEND));
      expect(r.status, `type=${JSON.stringify(type)}`).toBe(401);
    }
    // Sans `type` du tout : le chemin des intitulés, réservé au site.
    expect((await GET(appel({ q: 'Paris' }, BACKEND))).status).toBe(401);
  });

  it('la clé du site garde tous les types ; une autre clé, ou aucune, est refusée partout', async () => {
    for (const type of ['city', 'title', 'company', 'metier']) {
      expect((await GET(appel({ type, q: 'Paris' }, SITE))).status, `site, type=${type}`).toBe(400);
      expect((await GET(appel({ type, q: 'Paris' }, 'autre-cle'))).status, `autre, type=${type}`).toBe(401);
      expect((await GET(appel({ type, q: 'Paris' }))).status, `aucune, type=${type}`).toBe(401);
    }
  });

  it('en production, sans clé du backend configurée, la clé du site sert encore les lieux', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CATALOGUE_API_KEY_BACKEND', '');
    expect((await GET(appel({ type: 'city', q: 'Paris' }, SITE))).status).toBe(400);
    expect((await GET(appel({ type: 'city', q: 'Paris' }, BACKEND))).status).toBe(401);
  });
});

const url = process.env.DATABASE_URL ?? '';
const actif = (() => {
  try {
    return Boolean(url) && /test/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
})();

/**
 * Le chemin complet, sur une vraie base de lieux : la clé du backend, la requête que le backend envoie, et la règle
 * qu'il applique à la réponse (la première suggestion du même nom qui porte une subdivision) rendent « Paris (75) ».
 */
describe.skipIf(!actif)('/api/suggest — la forme reconnue lue avec la clé du backend, sur une vraie base', () => {
  let GET: (r: NextRequest) => Promise<Response>;
  let prisma: import('@prisma/client').PrismaClient;
  beforeAll(async () => {
    ({ prisma } = await import('@catwalks/db'));
    ({ GET } = await import('../../app/api/suggest/route'));
    await semerVilles(prisma, VILLES_TEMOINS);
  }, 120_000);
  afterAll(async () => {
    await viderVilles(prisma);
    await prisma.$disconnect();
  });
  beforeEach(() => {
    vi.stubEnv('CATALOGUE_API_KEY', SITE);
    vi.stubEnv('CATALOGUE_API_KEY_BACKEND', BACKEND);
  });
  afterEach(() => vi.unstubAllEnvs());

  const sansAccents = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const nomDe = (v: string) => sansAccents(v.replace(/\s*\([^()]{1,60}\)\s*$/, ''));
  const formeReconnue = (suggestions: string[], nom: string) =>
    suggestions.find((s) => /\(([^()]{1,60})\)\s*$/.test(s) && nomDe(s) === nomDe(nom)) ?? null;

  it('PRÉMISSE — la base porte Paris en France ET aux États-Unis (un homonyme que le marché doit départager)', async () => {
    const [{ pays }] = await prisma.$queryRaw<{ pays: string[] }[]>`SELECT array_agg(DISTINCT "countryCode" ORDER BY "countryCode") AS pays FROM "GeoCity" WHERE name = 'Paris'`;
    expect(pays).toEqual(['FR', 'US']);
  });

  it('« Paris » sur le marché FR : 200, et la forme reconnue est « Paris (75) » ; sur le marché US, « Paris (TX) »', async () => {
    const fr = await GET(appel({ type: 'city', q: 'Paris', marche: 'FR' }, BACKEND));
    expect(fr.status).toBe(200);
    expect(formeReconnue(((await fr.json()) as { suggestions: string[] }).suggestions, 'Paris')).toBe('Paris (75)');
    const us = await GET(appel({ type: 'city', q: 'Paris', marche: 'US' }, BACKEND));
    expect(formeReconnue(((await us.json()) as { suggestions: string[] }).suggestions, 'Paris')).toBe('Paris (TX)');
  });

  it('la même requête avec la clé du site rend la même liste (une seule vérité pour les deux appelants)', async () => {
    const lire = async (cle: string) => ((await (await GET(appel({ type: 'city', q: 'Paris', marche: 'FR' }, cle))).json()) as { suggestions: string[] }).suggestions;
    expect(await lire(BACKEND)).toEqual(await lire(SITE));
  });
});
