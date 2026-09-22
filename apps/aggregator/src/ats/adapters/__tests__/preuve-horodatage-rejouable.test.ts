import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * L'HORODATAGE D'UNE PREUVE DE PAGE DOIT ÊTRE REJOUABLE.
 *
 * ── LE DÉFAUT MESURÉ ───────────────────────────────────────────────────────────────────────────
 *
 * La validation native rejoue une capture enregistrée et compare le résultat à son manifeste.
 * Sept adaptateurs horodataient leur `pageEvidence` avec `new Date()` — l'heure du REJEU, pas
 * celle de la collecte. La comparaison échouait donc toujours, et la source était rejetée en
 * `REPLAY_RESULT_CHANGED`.
 *
 * Mesuré le 2026-09-21 sur `sezane` (workable) et `bash-talents` :
 *
 *     sortie identique     : true      (115/115 et 50/50 offres, contenu conforme)
 *     sha256 de la page    : identique
 *     métadonnées idem     : FALSE     — sur le seul champ `pageEvidence.checkedAt`
 *
 * Onze sources du registre portaient ce verdict. La donnée était bonne ; c'est l'horodatage qui
 * rendait la preuve irrejouable.
 *
 * ── LE MÉCANISME EXISTE DÉJÀ ───────────────────────────────────────────────────────────────────
 *
 * `captureObservedAt()` (`capture/context.ts:37`) lit l'instant FIGÉ du contexte de capture, que
 * `replayExtraction` repose à `batch.startedAt` lors d'un rejeu. Vingt-deux adaptateurs
 * l'utilisaient déjà : c'est la norme du projet, pas une invention de ce lot.
 *
 * Ce témoin lit les sources : c'est le seul moyen de garder la règle pour TOUS les adaptateurs,
 * y compris ceux qui n'existent pas encore.
 */
const DOSSIER = new URL('../', import.meta.url);

describe('horodatage des preuves de page', () => {
  it('aucun adaptateur n\'horodate une preuve avec `new Date()`', () => {
    const fautifs: string[] = [];
    for (const nom of readdirSync(DOSSIER).filter((f) => f.endsWith('.ts') && !f.includes('.test.'))) {
      const source = readFileSync(new URL(nom, DOSSIER), 'utf8');
      /*
       * `checkedAt: new Date()` fige l'heure du REJEU. Seul `captureObservedAt()` — ou une valeur
       * qui en dérive — rend la preuve comparable à son manifeste.
       */
      if (/checkedAt:\s*new Date\(\)/.test(source)) fautifs.push(nom);
    }
    expect(fautifs, `adaptateurs à corriger : ${fautifs.join(', ')}`).toEqual([]);
  });

  it('PRÉMISSE : le motif recherché attrape bien la forme fautive', () => {
    /*
     * Sans cette vérification, un témoin dont l'expression ne correspondrait à rien passerait au
     * vert en ne testant rien — le faux négatif rassurant.
     */
    expect(/checkedAt:\s*new Date\(\)/.test('pageEvidence.push({ checkedAt: new Date().toISOString() })')).toBe(true);
    expect(/checkedAt:\s*new Date\(\)/.test('pageEvidence.push({ checkedAt: observedAt.toISOString() })')).toBe(false);
  });
});
