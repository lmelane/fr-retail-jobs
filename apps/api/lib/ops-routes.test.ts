import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as vueEnsemble } from '@/app/api/ops/vue-ensemble/route';
import { GET as sources } from '@/app/api/ops/sources/route';
import { GET as source } from '@/app/api/ops/sources/[cle]/route';
import { GET as couverture } from '@/app/api/ops/couverture/route';
import { GET as fileRevue } from '@/app/api/ops/file-revue/route';
import { GET as pourquoi } from '@/app/api/ops/pourquoi/route';

/**
 * D-522 §5 — les gardes des routes de pilotage, sans base : la clé `CATALOGUE_OPS_KEY` seule, FERMÉE sans elle même hors
 * production (les routes publiques, elles, se désarment sur un poste local), et les entrées refusées AVANT toute lecture.
 * Une route qui interrogerait la base rendrait 200, 500 ou 503, jamais 400 ni 401 : les refus ci-dessous viennent du garde.
 */
const req = (chemin: string, cle?: string) => new NextRequest(`http://catalogue.test${chemin}`, { headers: cle ? { authorization: `Bearer ${cle}` } : {} });
const params = (cle: string) => ({ params: Promise.resolve({ cle }) });
const TOUTES = [
  ['vue-ensemble', () => vueEnsemble(req('/api/ops/vue-ensemble', 'cle-ops'))],
  ['sources', () => sources(req('/api/ops/sources', 'cle-ops'))],
  ['source', () => source(req('/api/ops/sources/dior', 'cle-ops'), params('dior'))],
  ['couverture', () => couverture(req('/api/ops/couverture', 'cle-ops'))],
  ['file-revue', () => fileRevue(req('/api/ops/file-revue', 'cle-ops'))],
  ['pourquoi', () => pourquoi(req('/api/ops/pourquoi?ref=abc', 'cle-ops'))],
] as const;

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgresql://personne@127.0.0.1:1/catalogue_test');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('routes de pilotage : la clé', () => {
  it.each(TOUTES)('%s : sans CATALOGUE_OPS_KEY, 503 même hors production (aucun désarmement local)', async (_nom, appel) => {
    vi.stubEnv('CATALOGUE_OPS_KEY', '');
    expect(process.env.NODE_ENV).not.toBe('production');
    const r = await appel();
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: 'Le pilotage du catalogue n’est pas configuré.' });
  });

  it.each(TOUTES)('%s : la clé du site ou du backend est refusée en 401', async (nom) => {
    vi.stubEnv('CATALOGUE_OPS_KEY', 'cle-ops');
    vi.stubEnv('CATALOGUE_API_KEY', 'cle-site');
    vi.stubEnv('CATALOGUE_API_KEY_BACKEND', 'cle-backend');
    for (const cle of ['cle-site', 'cle-backend', undefined, 'cle-op']) {
      const chemin = nom === 'source' ? '/api/ops/sources/dior' : nom === 'pourquoi' ? '/api/ops/pourquoi?ref=abc' : `/api/ops/${nom}`;
      const handler = { 'vue-ensemble': vueEnsemble, sources, couverture, 'file-revue': fileRevue, pourquoi, source: null }[nom];
      const r = handler ? await handler(req(chemin, cle)) : await source(req(chemin, cle), params('dior'));
      expect(r.status, `${nom} ${cle ?? 'sans clé'}`).toBe(401);
      expect(JSON.stringify(await r.json())).not.toContain('cle-ops');
    }
  });

  it('la bonne clé passe le garde (la suite dépend de la base : jamais 401 ni 403)', async () => {
    vi.stubEnv('CATALOGUE_OPS_KEY', 'cle-ops');
    const r = await couverture(req('/api/ops/couverture', 'cle-ops'));
    expect([401, 403]).not.toContain(r.status);
    expect(r.headers.get('cache-control')).toBe('no-store');
  }, 30_000);
});

describe('routes de pilotage : les entrées refusées avant toute lecture', () => {
  beforeEach(() => vi.stubEnv('CATALOGUE_OPS_KEY', 'cle-ops'));

  it.each(['', '   ', 'a'.repeat(601), 'x\u0001y', 'https://exa mple.com/%'])('pourquoi refuse « %s » en 400', async (ref) => {
    const r = await pourquoi(req(`/api/ops/pourquoi?ref=${encodeURIComponent(ref)}`, 'cle-ops'));
    expect(r.status).toBe(400);
  });

  it.each(['../etc', 'a b', 'é', '-debut', 'x'.repeat(121), "dior'--"])('source refuse la clé « %s » en 400', async (cle) => {
    const r = await source(req(`/api/ops/sources/${encodeURIComponent(cle)}`, 'cle-ops'), params(cle));
    expect(r.status).toBe(400);
  });
});
