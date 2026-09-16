import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandCompanyTerm } from '../groups.js';

/**
 * AUDIT DÉFENSIF DU 14/09/2026 — les deux défauts, et pourquoi ils partent
 * ENSEMBLE.
 *
 * 1. `q` était borné en LONGUEUR (200 caractères) mais pas en NOMBRE DE
 *    TERMES. « a b c d… » donne 100 termes, et chaque terme coûtait une
 *    requête SQL dédiée sur `Company`, toutes lancées en parallèle. Une URL
 *    publique déclenchait donc 100 requêtes concurrentes — et le moteur n'a
 *    aucun plafond par IP, seule la clé le protège.
 *
 * 2. Le référentiel des groupes était lu au MAUVAIS CHEMIN
 *    (`data/maisons.csv` au lieu de `data/reference/maisons.csv`), et le
 *    `catch` avalait l'échec. Conséquence produit : « sandro » n'atteignait
 *    plus les offres classées « SMCP ».
 *
 * LE LIEN ENTRE LES DEUX, et c'est le cœur de ce témoin : tant que le fichier
 * restait introuvable, l'expansion rendait un seul terme, donc l'amplification
 * du défaut 1 restait faible PAR ACCIDENT. Réparer le chemin seul aurait
 * multiplié par ~15 le nombre de clauses SQL d'une requête. Un correctif qui
 * ressemble à un bugfix anodin devient alors un vecteur de déni de service.
 *
 * Ces témoins gardent les DEUX ensemble : si quelqu'un retire la borne en
 * gardant le fichier, ils rougissent.
 */
describe('bornes de la recherche (audit 14/09/2026)', () => {
  it('le référentiel des groupes est LU : le chemin est le bon', () => {
    // Prémisse : sans expansion, le témoin suivant ne prouverait rien.
    const brut = expandCompanyTerm('sandro');
    expect(brut.length, 'le CSV doit être lisible, sinon le chemin est de nouveau cassé').toBeGreaterThan(1);
    // Le cas produit qui a motivé l'expansion : une marque atteint son groupe.
    expect(brut.map((v) => v.toLowerCase())).toContain('smcp');
  });

  it("le fichier vit bien dans reference/, pas à la racine de data/", () => {
    // Le défaut exact : un chemin qui a l'air juste et ne l'est pas.
    const bon = join(process.cwd(), '..', 'aggregator', 'data', 'reference', 'maisons.csv');
    expect(() => readFileSync(bon, 'utf8')).not.toThrow();
    expect(readFileSync(bon, 'utf8').split('\n')[0]).toContain('name,canonical_slug');
  });

  it("l'expansion d'un terme très partagé reste BORNÉE", () => {
    /*
     * « l'oreal » était le pire cas mesuré par l'audit : 55 marques rattachées.
     * L'expansion peut légitimement être large — ce qui compte, c'est qu'elle
     * ne soit pas multipliée par un nombre de termes illimité.
     */
    const grand = expandCompanyTerm("l'oreal");
    expect(grand.length).toBeGreaterThan(1);
    // Aucune assertion de plafond ici : la borne vit sur les TERMES, pas sur
    // l'expansion d'un terme. Ce témoin documente l'ordre de grandeur réel.
    expect(grand.length).toBeLessThan(500);
  });

  it('un terme inconnu ne rend que lui-même', () => {
    expect(expandCompanyTerm('zzzz-maison-inexistante')).toEqual(['zzzz-maison-inexistante']);
  });

  it('LE PLAFOND DE TERMES existe dans la source du moteur de recherche', () => {
    /*
     * Lu dans la source plutôt qu'exercé par une requête : `searchSummary`
     * exige une base, et ce témoin doit tourner partout, y compris là où les
     * tests de base s'auto-ignorent — c'est-à-dire là où le défaut est passé.
     */
    // Le plan borne les termes (lot 6) ; la requête d'alias, qui multiplie les clauses par terme, porte son LIMIT.
    const plan = readFileSync(join(process.cwd(), 'lib', 'search-plan.ts'), 'utf8');
    expect(plan, 'le découpage de q doit être borné').toMatch(/MAX_TERMES\s*=\s*\d+/);
    expect(plan, 'le slice doit être appliqué au découpage').toMatch(/split\(\/\\s\+\/\)[\s\S]{0,60}slice\(0,\s*MAX_TERMES\)/);
    const src = readFileSync(join(process.cwd(), 'lib', 'job-search-query.ts'), 'utf8');
    expect(src, 'la requête alias doit porter un LIMIT').toMatch(/old\.name ILIKE [^\n]*\) LIMIT \d+/);
  });
});
