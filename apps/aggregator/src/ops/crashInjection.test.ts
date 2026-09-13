import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crashPointReached, resetCrashInjection, CRASH_POINTS } from '../lib/crashInjection.js';

/**
 * L'INJECTION D'INTERRUPTION DÉTERMINISTE — pour exercer le scénario B, et lui seul.
 *
 * P8 doit prouver qu'une interruption PENDANT LE POOL DE DÉTAILS ne laisse ni run orphelin, ni réservation
 * pendante, ni doublon. Les tentatives précédentes ont échoué pour une raison qui n'a été comprise qu'en
 * lisant les adaptateurs :
 *
 *   · `--crash-after=2` se déclenche après DEUX transactions commitées — c'est une seconde profondeur
 *     d'écriture partielle (scénario C), pas une interruption pendant la lecture des détails ;
 *   · le harnais nominal utilisait `damart` (Teamtailor) et `nikin` (Recruitee). Or Teamtailor déclare en
 *     toutes lettres « No detail fetch needed » et Recruitee lit tout en UN appel. **Ces deux sources n'ont
 *     aucun pool de détails** : le scénario B ne pouvait pas s'y produire, quelle que soit l'injection.
 *
 * Le vrai pool est celui d'iCIMS (`icims.ts` : `pLimit` + `Promise.all` de `fetchText`), exécuté INTÉGRALEMENT
 * avant toute persistance. C'est là que l'injection doit mordre.
 *
 * Ce que ces tests fixent, et qui n'est pas cosmétique : l'injection est **inerte par défaut**. Un mécanisme
 * capable de tuer un processus ne doit jamais pouvoir s'armer par accident en production — il s'arme
 * uniquement sur une variable d'environnement explicite, et il ne connaît qu'une liste FERMÉE de points.
 */
// L'ordre compte : on efface l'environnement AVANT de réinitialiser. L'inverse relit une valeur invalide et
// fait échouer le nettoyage lui-même — ce qui est d'ailleurs la preuve que le refus fonctionne.
afterEach(() => { delete process.env.P8_CRASH_AT; delete process.env.P8_CRASH_AFTER; resetCrashInjection(); });

describe('injection d\'interruption — inerte par défaut, déterministe une fois armée', () => {
  it('sans variable, ne se déclenche JAMAIS — quel que soit le nombre de passages', () => {
    resetCrashInjection();
    for (let i = 0; i < 100; i++) {
      expect(crashPointReached(CRASH_POINTS.DURING_DETAIL_POOL)).toBe(false);
    }
  });

  it('armée sur un AUTRE point, ne se déclenche pas sur celui-ci', () => {
    process.env.P8_CRASH_AT = CRASH_POINTS.BEFORE_PERSIST;
    resetCrashInjection();
    expect(crashPointReached(CRASH_POINTS.DURING_DETAIL_POOL)).toBe(false);
  });

  it('armée sur DURING_DETAIL_POOL, se déclenche — après le seuil, pas avant', () => {
    // Le seuil existe pour que l'arrêt tombe AU MILIEU du pool : se déclencher au premier détail ne
    // prouverait pas qu'un pool partiellement consommé se reprend proprement.
    process.env.P8_CRASH_AT = CRASH_POINTS.DURING_DETAIL_POOL;
    process.env.P8_CRASH_AFTER = '3';
    resetCrashInjection();
    expect(crashPointReached(CRASH_POINTS.DURING_DETAIL_POOL)).toBe(false); // 1
    expect(crashPointReached(CRASH_POINTS.DURING_DETAIL_POOL)).toBe(false); // 2
    expect(crashPointReached(CRASH_POINTS.DURING_DETAIL_POOL)).toBe(false); // 3
    expect(crashPointReached(CRASH_POINTS.DURING_DETAIL_POOL)).toBe(true);  // 4 : au-delà du seuil
  });

  it('un seuil ABSENT vaut 0 : déclenchement au premier passage', () => {
    process.env.P8_CRASH_AT = CRASH_POINTS.DURING_DETAIL_POOL;
    resetCrashInjection();
    expect(crashPointReached(CRASH_POINTS.DURING_DETAIL_POOL)).toBe(true);
  });

  it('un point INCONNU est refusé — la liste est fermée, pas une chaîne libre', () => {
    process.env.P8_CRASH_AT = 'DROP_DATABASE';
    expect(() => resetCrashInjection()).toThrow(/inconnu/i);
  });

  it('le compteur est propre à CHAQUE point : deux points ne partagent pas leur seuil', () => {
    process.env.P8_CRASH_AT = CRASH_POINTS.DURING_DETAIL_POOL;
    process.env.P8_CRASH_AFTER = '1';
    resetCrashInjection();
    // Des passages sur un autre point ne doivent pas consommer le seuil de celui-ci.
    crashPointReached(CRASH_POINTS.BEFORE_PERSIST);
    crashPointReached(CRASH_POINTS.BEFORE_PERSIST);
    expect(crashPointReached(CRASH_POINTS.DURING_DETAIL_POOL)).toBe(false); // 1er passage réel
    expect(crashPointReached(CRASH_POINTS.DURING_DETAIL_POOL)).toBe(true);
  });

  it('les points nommés existent bien dans le code qu\'ils prétendent instrumenter', () => {
    // Un point de crash qui ne correspond à aucun appel réel donnerait une preuve vide.
    expect(Object.values(CRASH_POINTS)).toContain('DURING_DETAIL_POOL');
    expect(Object.values(CRASH_POINTS)).toContain('BEFORE_PERSIST');
  });

  it('DURING_DETAIL_POOL est CÂBLÉ dans le pool d\'iCIMS, et avant la lecture du détail', () => {
    // La preuve qui compte : le point est appelé DANS le pool, pas seulement défini. Deux tentatives
    // précédentes ont échoué parce que les sources exercées (Teamtailor, Recruitee) n'ont AUCUN pool de
    // détails — une injection définie mais jamais atteinte aurait produit un run nominal pris pour une preuve.
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../ats/adapters/icims.ts'), 'utf8');
    expect(src).toContain('crashPointReached(CRASH_POINTS.DURING_DETAIL_POOL)');
    // …et placé AVANT le `fetchText` du détail : après, il n'exercerait plus le pool mais son épilogue.
    const inject = src.indexOf('crashPointReached(CRASH_POINTS.DURING_DETAIL_POOL)');
    const detailFetch = src.indexOf('enrichPostingEvidence(job, await fetchText(job.url)');
    expect(inject).toBeGreaterThan(-1);
    expect(detailFetch).toBeGreaterThan(-1);
    expect(inject).toBeLessThan(detailFetch);
  });

  it('le pool d\'iCIMS est bien un pool BORNÉ : le scénario B a un sens sur cette source', () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../ats/adapters/icims.ts'), 'utf8');
    expect(src).toContain('pLimit(');
    expect(src).toContain('Promise.all(');
  });

  it('Teamtailor n\'a AUCUN pool de détails — d\'où l\'échec des tentatives précédentes', () => {
    // Ce test grave la cause racine : ce n'était pas l'injection qui était mauvaise, c'était la SOURCE.
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../ats/adapters/teamtailor.ts'), 'utf8');
    expect(src).not.toContain('pLimit');
    expect(src).toMatch(/No detail fetch needed/i);
  });
});
