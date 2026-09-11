import { describe, expect, it } from 'vitest';

import { enumerationVerdict, verdictToComplete } from './enumeration.js';
import { isTrustedForAttestation } from './attestation.js';

/**
 * Les cas sont les runs RÉELLEMENT archivés en production, mesurés le 2026-09-11 (lecture seule) : chaque
 * assertion porte les chiffres du `SourceRun` concerné, pas un exemple inventé.
 */
describe('verdict d\'énumération', () => {
  it('PROUVE une source qui a lu tout ce qu\'elle déclare (tapestry 2 091/2 091)', () => {
    expect(enumerationVerdict({ declaredTotal: 2091, uniqueCollected: 2091, truncated: false })).toBe('PROVEN');
  });

  it('PROUVE une unité d\'écart sur un total déclaré (kering 1 025/1 026, knitwell 1 999/2 000)', () => {
    // Le défaut : `unique === declaredTotal` refusait la complétude sur une lecture à 99,9 %.
    expect(enumerationVerdict({ declaredTotal: 1026, uniqueCollected: 1025 })).toBe('PROVEN');
    expect(enumerationVerdict({ declaredTotal: 2000, uniqueCollected: 1999 })).toBe('PROVEN');
  });

  it('dit INCONNU quand la source ne déclare aucun total (boots 1 472, pvh 1 358, adidas 1 069)', () => {
    // Le défaut : « inconnu » était rendu comme « incomplet », ce qui retirait le droit d'attester.
    for (const n of [1472, 1358, 1069]) expect(enumerationVerdict({ uniqueCollected: n })).toBe('UNKNOWN');
  });

  it('RÉFUTE une troncature, même si le total déclaré semble atteint', () => {
    // ulta-jibe : 9 964 collectées sur 9 966 déclarées, MAIS arrêtée sur un plafond de pages.
    expect(enumerationVerdict({ declaredTotal: 9966, uniqueCollected: 9964, truncated: true })).toBe('REFUTED');
  });

  it('RÉFUTE une couverture sous le seuil (oniverse 483/734)', () => {
    expect(enumerationVerdict({ declaredTotal: 734, uniqueCollected: 483 })).toBe('REFUTED');
    // Le cas fondateur de la règle : lagardere-travel-retail, 20 écrites pour 109 déclarées.
    expect(enumerationVerdict({ declaredTotal: 109, uniqueCollected: 20 })).toBe('REFUTED');
  });

  it('accepte l\'affirmation d\'un adaptateur sans total déclaré (Greenhouse documente son board complet)', () => {
    expect(enumerationVerdict({ uniqueCollected: 40, adapterProvesCompletion: true })).toBe('PROVEN');
  });

  it('une ligne ILLISIBLE est du DOUTE quand personne ne l\'a qualifiée — donc INCONNU, jamais réfuté', () => {
    // Total déclaré atteint, mais l'adaptateur n'affirme rien et une ligne n'a pas pu être lue : elle peut
    // contenir n'importe quoi. C'est du doute, pas une preuve d'incomplétude.
    expect(enumerationVerdict({ declaredTotal: 40, uniqueCollected: 40, unreadableRows: 1 })).toBe('UNKNOWN');
  });

  it('mais un adaptateur qui AFFIRME son énumération a qualifié ses propres rejets : sa preuve tient', () => {
    // Règle posée le 2026-09-09 : une page expirée encore listée dans un sitemap est un TÉMOIN de
    // l'énumération, pas un trou dedans. PVH 1 374 offres pour 1 440 pages listées, Boots 1 489/1 610,
    // NARS 53/158 étaient déclarées partielles pour des pages que l'adaptateur avait précisément classées.
    expect(enumerationVerdict({ uniqueCollected: 40, adapterProvesCompletion: true, unreadableRows: 1 })).toBe('PROVEN');
    expect(enumerationVerdict({ declaredTotal: 1440, uniqueCollected: 1374, adapterProvesCompletion: true })).toBe('PROVEN');
  });

  it('un total déclaré à ZÉRO face à des offres collectées est une contradiction, pas une absence', () => {
    // Signature d'un en-tête de pagination manquant lu comme un zéro : on sait que le compteur ment.
    expect(enumerationVerdict({ declaredTotal: 0, uniqueCollected: 1 })).toBe('REFUTED');
  });

  it('un adaptateur qui REFUSE explicitement la preuve l\'emporte sur un total atteint', () => {
    expect(enumerationVerdict({ declaredTotal: 1, uniqueCollected: 1, adapterProvesCompletion: false })).toBe('REFUTED');
  });

  it('une troncature l\'emporte sur l\'affirmation de l\'adaptateur', () => {
    expect(enumerationVerdict({ uniqueCollected: 40, adapterProvesCompletion: true, truncated: true })).toBe('REFUTED');
  });

  it('INCONNU ne devient jamais false — c\'est toute la correction', () => {
    expect(verdictToComplete('UNKNOWN')).toBeUndefined();
    expect(verdictToComplete('PROVEN')).toBe(true);
    expect(verdictToComplete('REFUTED')).toBe(false);
  });
});

describe('le verdict nourrit le droit d\'attester sans l\'affaiblir', () => {
  it('rend son droit d\'attester à une source qui a tout lu (tapestry)', () => {
    const complete = verdictToComplete(enumerationVerdict({ declaredTotal: 2091, uniqueCollected: 2091 }));
    expect(isTrustedForAttestation({ status: 'OK', complete, declaredTotal: 2091, fetched: 2091, errors: 0, previous: 2086 })).toBe(true);
  });

  it('laisse INCONNU passer la porte, l\'effondrement restant le seul arbitre (boots)', () => {
    const complete = verdictToComplete(enumerationVerdict({ uniqueCollected: 1472 }));
    // Volume stable face au dernier run productif : la source peut attester.
    expect(isTrustedForAttestation({ status: 'OK', complete, fetched: 1472, errors: 0, previous: 1419 })).toBe(true);
    // Effondrement : refusé, alors même que l'énumération est « inconnue ».
    expect(isTrustedForAttestation({ status: 'OK', complete, fetched: 400, errors: 0, previous: 1419 })).toBe(false);
  });

  it('garde bloquée une source effondrée dont l\'énumération est pourtant PROUVÉE (swatch-group 61/61, 275 avant)', () => {
    // Contre-exemple à préserver : une chute de 78 % n'est pas une journée d'expirations.
    const complete = verdictToComplete(enumerationVerdict({ declaredTotal: 61, uniqueCollected: 61 }));
    expect(complete).toBe(true);
    expect(isTrustedForAttestation({ status: 'OK', complete, declaredTotal: 61, fetched: 61, errors: 0, previous: 275 })).toBe(false);
  });

  it('garde bloquée une source tronquée (ulta-jibe)', () => {
    const complete = verdictToComplete(enumerationVerdict({ declaredTotal: 9966, uniqueCollected: 9964, truncated: true }));
    expect(isTrustedForAttestation({ status: 'DEGRADED', complete, declaredTotal: 9966, fetched: 9964, truncated: true, errors: 0 })).toBe(false);
  });

  it('garde bloqué un run BROKEN quel que soit le verdict (l-oreal-professionnel, 0 offre sans erreur)', () => {
    expect(isTrustedForAttestation({ status: 'BROKEN', complete: true, fetched: 0, errors: 0, previous: 1711 })).toBe(false);
  });
});

describe('le trou ouvert par l\'acceptation d\'INCONNU est fermé', () => {
  it('refuse une énumération inconnue SANS aucune référence — ni total déclaré, ni run précédent', () => {
    // Sinon un premier run d'une source qui ne déclare rien gagnerait le droit de faire disparaître des offres
    // sur la foi de rien du tout.
    expect(isTrustedForAttestation({ status: 'OK', complete: undefined, fetched: 40, errors: 0 })).toBe(false);
    expect(isTrustedForAttestation({ status: 'OK', complete: undefined, fetched: 40, errors: 0, previous: null })).toBe(false);
  });

  it('accepte une énumération PROUVÉE sans run précédent : elle porte sa propre preuve', () => {
    expect(isTrustedForAttestation({ status: 'OK', complete: true, fetched: 40, errors: 0 })).toBe(true);
  });

  it('accepte une énumération inconnue dès qu\'une référence existe', () => {
    expect(isTrustedForAttestation({ status: 'OK', complete: undefined, fetched: 1472, errors: 0, previous: 1419 })).toBe(true);
    expect(isTrustedForAttestation({ status: 'OK', complete: undefined, declaredTotal: 1000, fetched: 980, errors: 0 })).toBe(true);
  });
});

describe('un `fetched` INCONNU n\'est pas un `fetched` à zéro', () => {
  it('ne lit pas un effondrement dans une ligne archivée sans la colonne (98 sources, runs du 5-6 septembre)', () => {
    // a-p-c : jobs 20, previousJobs 20, volume parfaitement stable — mais `fetched` est null, la colonne
    // n'existait pas encore. Compter null à 0 y lisait une chute de 100 % qui n'a jamais eu lieu.
    expect(isTrustedForAttestation({ status: 'OK', complete: undefined, fetched: undefined, previous: 20 })).toBe(true);
  });

  it('garde l\'effondrement dès que `fetched` est réellement connu', () => {
    expect(isTrustedForAttestation({ status: 'OK', complete: undefined, fetched: 0, previous: 20 })).toBe(false);
    expect(isTrustedForAttestation({ status: 'OK', complete: undefined, fetched: 9, previous: 20 })).toBe(false);
    expect(isTrustedForAttestation({ status: 'OK', complete: undefined, fetched: 11, previous: 20 })).toBe(true);
  });
});
