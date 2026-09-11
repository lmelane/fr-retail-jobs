import { describe, expect, it } from 'vitest';

import { enumerationVerdict, verdictToComplete } from './enumeration.js';
import { isTrustedForAttestation } from './attestation.js';

/**
 * Les cas sont les runs RÉELLEMENT archivés en production, mesurés le 2026-09-11 (lecture seule) : chaque
 * assertion porte les chiffres du `SourceRun` concerné, pas un exemple inventé.
 */
describe('verdict d\'énumération — seul un PARCOURS DÉMONTRÉ prouve', () => {
  it('un total déclaré ATTEINT ne prouve rien à lui seul : il faut la démonstration du parcours', () => {
    // Règle imposée le 2026-09-11. Un compteur atteint dit combien la source annonce, pas qu'on soit allé au bout.
    expect(enumerationVerdict({ declaredTotal: 2091, uniqueCollected: 2091, truncated: false })).toBe('UNKNOWN');
    // Avec la démonstration de l'adaptateur, c'est PROUVÉ — tapestry et VF restent PROVEN par ce chemin.
    expect(enumerationVerdict({ declaredTotal: 2091, uniqueCollected: 2091, adapterProvesCompletion: true })).toBe('PROVEN');
    expect(enumerationVerdict({ declaredTotal: 1273, uniqueCollected: 1273, adapterProvesCompletion: true })).toBe('PROVEN');
  });

  it('une unité d\'écart n\'est ni une troncature ni une preuve (kering 1 025/1 026)', () => {
    // Le ratio ne REFUTE pas (on est au-dessus du seuil) mais ne PROUVE pas non plus.
    expect(enumerationVerdict({ declaredTotal: 1026, uniqueCollected: 1025 })).toBe('UNKNOWN');
    expect(enumerationVerdict({ declaredTotal: 2000, uniqueCollected: 1999 })).toBe('UNKNOWN');
    // Le parcours démontré tranche, malgré l'écart d'une unité au compteur.
    expect(enumerationVerdict({ declaredTotal: 1026, uniqueCollected: 1025, adapterProvesCompletion: true })).toBe('PROVEN');
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

  it('un ATS SANS total est PROVEN dès que son protocole démontre la fin (teamtailor, recruitee, personio)', () => {
    // Teamtailor : `next_url: null` sur la dernière page. Recruitee / Personio : endpoint unique servi en entier.
    expect(enumerationVerdict({ uniqueCollected: 37, adapterProvesCompletion: true })).toBe('PROVEN');
    // Le même ATS sans démonstration de fin (plafond de pages atteint, continuation encore présente) : rien.
    expect(enumerationVerdict({ uniqueCollected: 4000, truncated: true })).toBe('REFUTED');
    expect(enumerationVerdict({ uniqueCollected: 4000 })).toBe('UNKNOWN');
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

describe('SEULE une énumération PROUVÉE autorise une fermeture', () => {
  it('rend son droit d\'attester à une source dont le parcours est démontré (tapestry, VF)', () => {
    const complete = verdictToComplete(enumerationVerdict({ declaredTotal: 2091, uniqueCollected: 2091, adapterProvesCompletion: true }));
    expect(complete).toBe(true);
    expect(isTrustedForAttestation({ status: 'OK', complete, declaredTotal: 2091, fetched: 2091, errors: 0, previous: 2086 })).toBe(true);
    // VF : 1 273/1 273 parcourues, 695 retenues qui ne concernent que certaines offres.
    const vf = verdictToComplete(enumerationVerdict({ declaredTotal: 1273, uniqueCollected: 1273, adapterProvesCompletion: true }));
    expect(isTrustedForAttestation({ status: 'DEGRADED', complete: vf, declaredTotal: 1273, fetched: 1273, errors: 0 })).toBe(true);
  });

  it('REFUSE toute fermeture sur une énumération INCONNUE, même avec un volume de référence stable (boots)', () => {
    const complete = verdictToComplete(enumerationVerdict({ uniqueCollected: 1472 }));
    expect(complete).toBeUndefined();
    // Un volume stable ne prouve pas que le même périmètre a été parcouru : 1 472 offres peuvent être d'autres.
    expect(isTrustedForAttestation({ status: 'OK', complete, fetched: 1472, errors: 0, previous: 1419 })).toBe(false);
    expect(isTrustedForAttestation({ status: 'OK', complete, fetched: 400, errors: 0, previous: 1419 })).toBe(false);
  });

  it('garde bloquée une source effondrée dont le parcours est pourtant démontré (swatch-group 61/61, 275 avant)', () => {
    // Contre-exemple à préserver : une chute de 78 % n'est pas une journée d'expirations. L'effondrement est un
    // indicateur de régression, et il REFUSE — il ne prouve jamais rien dans l'autre sens.
    const complete = verdictToComplete(enumerationVerdict({ declaredTotal: 61, uniqueCollected: 61, adapterProvesCompletion: true }));
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

describe('aucune référence ne remplace une preuve de parcours', () => {
  it('refuse une énumération inconnue, avec ou sans référence', () => {
    expect(isTrustedForAttestation({ status: 'OK', complete: undefined, fetched: 40, errors: 0 })).toBe(false);
    expect(isTrustedForAttestation({ status: 'OK', complete: undefined, fetched: 40, errors: 0, previous: null })).toBe(false);
    // Un run précédent existe : cela ne prouve toujours pas que le périmètre a été parcouru.
    expect(isTrustedForAttestation({ status: 'OK', complete: undefined, fetched: 1472, errors: 0, previous: 1419 })).toBe(false);
    // Un total déclaré couvert à 98 % : les 2 % non lus ne sont pas attestés.
    expect(isTrustedForAttestation({ status: 'OK', complete: undefined, declaredTotal: 1000, fetched: 980, errors: 0 })).toBe(false);
  });

  it('accepte une énumération PROUVÉE sans run précédent : elle porte sa propre preuve', () => {
    expect(isTrustedForAttestation({ status: 'OK', complete: true, fetched: 40, errors: 0 })).toBe(true);
  });
});

describe('un `fetched` INCONNU n\'est pas un `fetched` à zéro', () => {
  it('ne lit pas un effondrement dans une ligne archivée sans la colonne (98 sources, runs du 5-6 septembre)', () => {
    // a-p-c : jobs 20, previousJobs 20, volume stable — mais `fetched` est null, la colonne n'existait pas.
    // Compter null à 0 y lisait une chute de 100 % qui n'a jamais eu lieu. Avec un parcours démontré, la source
    // peut attester ; sans lui, elle ne peut pas — et c'est l'énumération qui décide, pas la colonne manquante.
    expect(isTrustedForAttestation({ status: 'OK', complete: true, fetched: undefined, previous: 20 })).toBe(true);
    expect(isTrustedForAttestation({ status: 'OK', complete: undefined, fetched: undefined, previous: 20 })).toBe(false);
  });

  it('garde l\'effondrement dès que `fetched` est réellement connu, parcours démontré ou non', () => {
    expect(isTrustedForAttestation({ status: 'OK', complete: true, fetched: 0, previous: 20 })).toBe(false);
    expect(isTrustedForAttestation({ status: 'OK', complete: true, fetched: 9, previous: 20 })).toBe(false);
    expect(isTrustedForAttestation({ status: 'OK', complete: true, fetched: 11, previous: 20 })).toBe(true);
  });
});
