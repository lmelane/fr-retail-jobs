import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SignalementInvalideError, lireIds, lireSignalement } from '../signalements-metier';

/** Lot 2E de D-475 (plan §3.7, D-475 §31 b) : le signal « métier manquant » remis par le backend. */
const valide = {
  id: 'sig_cm1a2b3c4d',
  offreId: 'cmoffre123',
  titre: 'Conseiller·ère clienteling horlogerie',
  metierChoisi: 'sales-advisor',
  commentaire: 'Poste de clienteling pur, sans vente en boutique.',
  signaleLe: '2026-09-30T21:00:00.000Z',
};

describe('la lecture du signal', () => {
  it('relit un signal valide, trim compris', () => {
    const s = lireSignalement({ ...valide, titre: `  ${valide.titre}  ` });
    expect(s).toMatchObject({ id: valide.id, offreId: valide.offreId, titre: valide.titre, metierChoisi: 'sales-advisor' });
    expect(s.signaleLe.toISOString()).toBe(valide.signaleLe);
  });

  it('accepte un signal sans métier choisi ni commentaire', () => {
    expect(lireSignalement({ ...valide, metierChoisi: null, commentaire: undefined })).toMatchObject({ metierChoisi: null, commentaire: null });
  });

  it.each([
    ['id', { id: '../x' }],
    ['offreId', { offreId: '' }],
    ['titre', { titre: '   ' }],
    ['titre', { titre: 'x'.repeat(501) }],
    ['metierChoisi', { metierChoisi: 'Sales Advisor' }],
    ['metierChoisi', { metierChoisi: 42 }],
    ['commentaire', { commentaire: 'x'.repeat(1_001) }],
    ['signaleLe', { signaleLe: 'hier' }],
  ])('refuse %s hors forme, nommé par son chemin', (chemin, champ) => {
    try {
      lireSignalement({ ...valide, ...champ });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SignalementInvalideError);
      expect((e as SignalementInvalideError).chemin).toBe(chemin);
    }
  });

  it('les ids demandés sont bornés à 100 et doivent être des identifiants', () => {
    expect(lireIds('a,b,,a')).toEqual(['a', 'b']);
    expect(() => lireIds(Array.from({ length: 101 }, (_, i) => `s${i}`).join(','))).toThrow(SignalementInvalideError);
    expect(() => lireIds('a,b c')).toThrow(SignalementInvalideError);
    expect(lireIds(null)).toEqual([]);
  });
});

describe('la route POST /api/metiers/signalements', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('@/lib/signalements-metier'); });
  const enregistrer = vi.fn(async () => ({ cree: true }));
  async function route() {
    vi.stubEnv('CATALOGUE_API_KEY', 'cle-site');
    vi.stubEnv('CATALOGUE_API_KEY_BACKEND', 'cle-backend');
    vi.doMock('@/lib/signalements-metier', async (orig) => ({ ...(await orig<typeof import('../signalements-metier')>()), enregistrerSignalement: enregistrer }));
    return (await import('../../app/api/metiers/signalements/route')).POST;
  }
  const requete = (corps: string, cle = 'cle-backend') =>
    new NextRequest('https://catalogue.test/api/metiers/signalements', { method: 'POST', body: corps, headers: { authorization: `Bearer ${cle}`, 'content-type': 'application/json' } });

  it('201 à la première remise, 200 quand le signal était déjà reçu (idempotent)', async () => {
    const POST = await route();
    enregistrer.mockResolvedValueOnce({ cree: true }).mockResolvedValueOnce({ cree: false });
    expect((await POST(requete(JSON.stringify(valide)))).status).toBe(201);
    const r = await POST(requete(JSON.stringify(valide)));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ recu: true, id: valide.id, cree: false });
  });

  it('refuse la clé du site : le signal ne passe jamais par une surface publique', async () => {
    const POST = await route();
    enregistrer.mockClear();
    expect((await POST(requete(JSON.stringify(valide), 'cle-site'))).status).toBe(401);
    expect(enregistrer).not.toHaveBeenCalled();
  });

  it('400 pour un JSON illisible ou un champ hors forme, 413 au-delà de 8 Ko, sans rien écrire', async () => {
    const POST = await route();
    enregistrer.mockClear();
    expect((await POST(requete('{pas du json'))).status).toBe(400);
    expect((await POST(requete(JSON.stringify({ ...valide, metierChoisi: 'X Y' })))).status).toBe(400);
    expect((await POST(requete(JSON.stringify({ ...valide, commentaire: 'é'.repeat(5_000) })))).status).toBe(413);
    expect(enregistrer).not.toHaveBeenCalled();
  });

  it('503 si la base refuse, sans faire croire que le signal est reçu', async () => {
    const POST = await route();
    enregistrer.mockRejectedValueOnce(new Error('relation "OccupationMissingSignal" does not exist'));
    const r = await POST(requete(JSON.stringify(valide)));
    expect(r.status).toBe(503);
    expect(await r.json()).not.toHaveProperty('recu');
  });
});
