import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import { cleAttendue, refuserSiCleInvalide } from '../cle-api';

const requete = (autorisation?: string): NextRequest =>
  ({ headers: new Headers(autorisation ? { authorization: autorisation } : {}) }) as NextRequest;

afterEach(() => {
  delete process.env.CATALOGUE_API_KEY;
});

/**
 * D-422 — seul catwalks.io appelle l'API du catalogue. Sans garde, 3 338
 * requêtes suffisaient à aspirer 83 431 offres.
 */
describe('le garde de clé (D-422)', () => {
  it('laisse passer la bonne clé', () => {
    process.env.CATALOGUE_API_KEY = 'cle-secrete-de-test';
    expect(refuserSiCleInvalide(requete('Bearer cle-secrete-de-test'), 'r1')).toBeNull();
    // La casse du schéma ne doit pas bloquer un appelant légitime.
    expect(refuserSiCleInvalide(requete('bearer cle-secrete-de-test'), 'r2')).toBeNull();
  });

  it('refuse en 401 : aucune clé, clé vide, mauvaise clé, mauvais schéma', async () => {
    process.env.CATALOGUE_API_KEY = 'cle-secrete-de-test';
    for (const entete of [undefined, 'Bearer ', 'Bearer mauvaise', 'Basic cle-secrete-de-test', 'cle-secrete-de-test']) {
      const r = refuserSiCleInvalide(requete(entete), 'r');
      expect(r, `refus attendu pour ${entete ?? 'aucun en-tête'}`).not.toBeNull();
      expect(r!.status).toBe(401);
    }
  });

  it("le refus ne révèle JAMAIS la clé attendue", async () => {
    process.env.CATALOGUE_API_KEY = 'cle-tres-secrete-123';
    const r = refuserSiCleInvalide(requete('Bearer faux'), 'r');
    const corps = await r!.json();
    expect(JSON.stringify(corps)).not.toContain('cle-tres-secrete-123');
    expect(r!.headers.get('www-authenticate')).toBe('Bearer');
  });

  it("sans CATALOGUE_API_KEY, le garde est désarmé : le site continue d'être servi", () => {
    // Délibéré : une variable oubliée ne doit pas éteindre le catalogue.
    expect(cleAttendue()).toBeNull();
    expect(refuserSiCleInvalide(requete(), 'r')).toBeNull();
  });

  it('une clé plus courte ou plus longue est refusée (comparaison à temps constant)', () => {
    process.env.CATALOGUE_API_KEY = 'abcdef';
    expect(refuserSiCleInvalide(requete('Bearer abcde'), 'r')).not.toBeNull();
    expect(refuserSiCleInvalide(requete('Bearer abcdefg'), 'r')).not.toBeNull();
  });
});

/**
 * Le témoin qui compte : une route ajoutée demain sans garde serait une porte
 * ouverte, et personne ne le verrait. Il ÉCHOUE si une route oublie le garde.
 */
describe('aucune route ne peut oublier le garde', () => {
  it('les 8 routes protégées appellent refuserSiCleInvalide, /api/health non (D-422 §3)', () => {
    const racine = join(__dirname, '..', '..', 'app', 'api');
    const routes: string[] = [];
    const parcourir = (dossier: string) => {
      for (const e of readdirSync(dossier, { withFileTypes: true })) {
        const chemin = join(dossier, e.name);
        if (e.isDirectory()) parcourir(chemin);
        else if (e.name === 'route.ts') routes.push(chemin);
      }
    };
    parcourir(racine);

    // Prémisse : il y a bien 9 routes (dont `/api/marches`, lot 6, et `/api/sitemap/emplois`, lot 9), sinon ce témoin ne teste rien.
    expect(routes).toHaveLength(9);

    for (const chemin of routes) {
      const source = readFileSync(chemin, 'utf8');
      const estSante = chemin.includes('health');
      expect(source.includes('refuserSiCleInvalide'), `${chemin} : garde ${estSante ? 'interdit' : 'manquant'}`).toBe(!estSante);
    }
  });
});
