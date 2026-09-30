import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { compileOccupationManifest, type CompiledOccupationTaxonomy } from '@catwalks/db/occupations';
import { CurseurInconnuError, conceptsDe, comptes, curseurConcept, pageConcepts } from '../taxonomie-export';

/**
 * Lot 2E de D-475 (plan §3.7) : l'export versionné que le backend tire par paquets. Témoins sur le manifeste v3 réel
 * (`catwalks-occupations-20260929-v3`, celui que la production sert depuis le 30/09/2026).
 */
const MANIFESTE = join(__dirname, '..', '..', '..', '..', 'audits', '2026-09-28', 'curation-v3', '6-manifeste-v3.json');
let v3: CompiledOccupationTaxonomy;
beforeAll(() => {
  v3 = compileOccupationManifest(JSON.parse(readFileSync(MANIFESTE, 'utf8')));
});

describe('les concepts de la version active', () => {
  it('rend tous les domaines, familles et métiers du manifeste, une fois chacun, dans un ordre stable', () => {
    const concepts = conceptsDe(v3);
    expect(comptes(concepts)).toEqual({ domaines: v3.manifest.groups.length, familles: v3.manifest.families.length, metiers: v3.manifest.occupations.length });
    // Prémisse chiffrée : la v3 porte 4 domaines, 33 familles, 253 métiers (plan §3.1).
    expect(comptes(concepts)).toEqual({ domaines: 4, familles: 33, metiers: 253 });
    const curseurs = concepts.map(curseurConcept);
    expect(new Set(curseurs).size).toBe(curseurs.length);
    expect(conceptsDe(v3).map(curseurConcept)).toEqual(curseurs);
  });

  it('chaque métier nomme sa famille, chaque famille son domaine, et ils existent', () => {
    const concepts = conceptsDe(v3);
    const familles = new Set(concepts.filter((c) => c.type === 'famille').map((c) => c.cle));
    const domaines = new Set(concepts.filter((c) => c.type === 'domaine').map((c) => c.cle));
    for (const c of concepts) {
      if (c.type === 'metier') expect(familles.has(c.parent ?? ''), c.cle).toBe(true);
      if (c.type === 'famille') expect(domaines.has(c.parent ?? ''), c.cle).toBe(true);
      if (c.type === 'domaine') expect(c.parent).toBeNull();
    }
  });

  it('porte le libellé court par langue et les variantes de recherche (« Conseiller de vente », « Vendeur »)', () => {
    const conseiller = conceptsDe(v3).find((c) => c.type === 'metier' && c.cle === 'sales-advisor')!;
    expect(conseiller.libelles.fr).toBe('Conseiller de vente');
    expect(conseiller.parent).toBe('retail-client-advisor');
    expect(conseiller.variantes).toContain('Vendeur');
    expect(new Set(conseiller.variantes).size).toBe(conseiller.variantes.length);
  });
});

describe('la pagination par curseur', () => {
  it('assemble exactement la liste entière, sans trou ni doublon, et finit par `suivant: null`', () => {
    const concepts = conceptsDe(v3);
    const limite = 37;
    // Prémisse : plusieurs pages, sinon ce témoin ne teste pas le curseur.
    expect(concepts.length).toBeGreaterThan(3 * limite);
    const lus: string[] = [];
    let apres: string | null = null;
    for (let tours = 0; tours < 100; tours++) {
      const page = pageConcepts(concepts, apres, limite);
      lus.push(...page.concepts.map(curseurConcept));
      if (!page.suivant) break;
      apres = page.suivant;
    }
    expect(lus).toEqual(concepts.map(curseurConcept));
  });

  it('un curseur inconnu de la version (version changée en cours de chargement) est refusé, jamais ignoré', () => {
    expect(() => pageConcepts(conceptsDe(v3), 'metier:cle-qui-n-existe-pas', 10)).toThrow(CurseurInconnuError);
  });

  it('une page qui tombe pile sur la fin rend `suivant: null`', () => {
    const concepts = conceptsDe(v3);
    const page = pageConcepts(concepts, curseurConcept(concepts[concepts.length - 3]), 2);
    expect(page.concepts).toHaveLength(2);
    expect(page.suivant).toBeNull();
  });
});

describe('la route GET /api/taxonomie/export', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('@/lib/taxonomie-export'); });
  const requete = (query: string, cle = 'cle-backend') =>
    new NextRequest(`https://catalogue.test/api/taxonomie/export?${query}`, { headers: { authorization: `Bearer ${cle}` } });
  async function route() {
    vi.stubEnv('CATALOGUE_API_KEY', 'cle-site');
    vi.stubEnv('CATALOGUE_API_KEY_BACKEND', 'cle-backend');
    vi.doMock('@/lib/taxonomie-export', async (orig) => {
      const vrai = await orig<typeof import('../taxonomie-export')>();
      return { ...vrai, versionActive: vi.fn(async () => ({ version: { releaseId: v3.manifest.id, empreinte: 'e'.repeat(64) }, taxonomie: v3, apprise: null })) };
    });
    return (await import('../../app/api/taxonomie/export/route')).GET;
  }

  it('refuse la clé du site (401) : l’export est au backend seul', async () => {
    const GET = await route();
    expect((await GET(requete('partie=entete', 'cle-site'))).status).toBe(401);
  });

  it('l’entête dit la version, l’empreinte, la table apprise (aucune) et les comptes', async () => {
    const GET = await route();
    const r = await GET(requete('partie=entete'));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ contrat: 1, taxonomie: { releaseId: 'catwalks-occupations-20260929-v3', empreinte: 'e'.repeat(64) }, apprise: null,
      comptes: { domaines: 4, familles: 33, metiers: 253 } });
  });

  it('chaque page de concepts porte la version qu’elle sert', async () => {
    const GET = await route();
    const corps = await (await GET(requete('partie=concepts&limite=50'))).json();
    expect(corps.taxonomie.releaseId).toBe('catwalks-occupations-20260929-v3');
    expect(corps.concepts).toHaveLength(50);
    expect(corps.suivant).toBe(curseurConcept(corps.concepts[49]));
  });

  it('sans table apprise active, la partie apprise est vide et finie', async () => {
    const GET = await route();
    expect(await (await GET(requete('partie=apprise'))).json()).toMatchObject({ apprise: null, entrees: [], suivant: null });
  });

  it('refuse une partie, une limite ou un curseur hors forme', async () => {
    const GET = await route();
    expect((await GET(requete('partie=tout'))).status).toBe(400);
    expect((await GET(requete('partie=concepts&limite=0'))).status).toBe(400);
    expect((await GET(requete('partie=concepts&limite=201'))).status).toBe(400);
    expect((await GET(requete('partie=concepts&limite=1e3'))).status).toBe(400);
    expect((await GET(requete('partie=concepts&apres=metier:inconnu'))).status).toBe(409);
    expect((await GET(requete('partie=signalements&ids=a;b'))).status).toBe(400);
  });
});
