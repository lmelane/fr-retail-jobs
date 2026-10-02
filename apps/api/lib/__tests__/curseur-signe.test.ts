import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURSEUR_MAX, CURSEUR_SECRET_VARIABLE, CurseurInvalideError, decoderCurseur, empreinteCriteres, encoderCurseur } from '../curseur';

/**
 * TÉMOINS — le curseur signé (lecture D-492 du 02/10/2026, suites du classement, écart connu n° 1).
 *
 * Le jeton `apres=` reste dans l'adresse. La version 2 y écrivait en clair l'empreinte NON SALÉE des critères, préférences
 * de classement comprises : `empreinteCriteres` étant public et déterministe, qui lisait le jeton pouvait essayer des
 * préférences (métiers, lieux, contrat, salaire) jusqu'à retrouver la même empreinte. Et la clé (dont le score de la
 * dernière offre) y était lisible et modifiable. Chacun de ces témoins est rouge sur la version 2.
 */
const SECRET_A = 'secret-de-test-A-0123456789abcdefghijklmnopqrstuv';
const SECRET_B = 'secret-de-test-B-0123456789abcdefghijklmnopqrstuv';
/** Des critères de la forme de `empreintePlan`, préférences et salaire compris. */
const criteres = (montant: number) => ({ version: 'v', perimetre: 'FR', q: 'vendeur', tri: 'pertinence',
  preferences: { metiers: ['sales-advisor'], lieux: ['Paris'], contrats: ['PERMANENT'], salaire: { montant, devise: 'EUR', periode: 'YEAR' } } });
const CLE = [1_790_000_000, 0, 0, -73.25, -1_790_000_000, 'job_123'] as const;

describe('le curseur ne révèle ni les préférences ni sa clé, et ne se forge pas', () => {
  let avant: string | undefined;
  beforeEach(() => { avant = process.env[CURSEUR_SECRET_VARIABLE]; process.env[CURSEUR_SECRET_VARIABLE] = SECRET_A; });
  afterEach(() => { if (avant === undefined) delete process.env[CURSEUR_SECRET_VARIABLE]; else process.env[CURSEUR_SECRET_VARIABLE] = avant; });

  it('PRÉMISSE : deux salaires différents donnent deux empreintes différentes (l’empreinte porte bien les préférences)', () => {
    expect(empreinteCriteres(criteres(45_000))).not.toBe(empreinteCriteres(criteres(46_000)));
  });

  it('le jeton ne contient ni l’empreinte des critères, ni la clé, ni aucun texte lisible', () => {
    const h = empreinteCriteres(criteres(45_000));
    const jeton = encoderCurseur(h, CLE);
    const octets = Buffer.from(jeton, 'base64url');
    for (const vu of [octets.toString('latin1'), octets.toString('utf8'), jeton]) {
      expect(vu).not.toContain(h);
      expect(vu).not.toContain('job_123');
      expect(vu).not.toContain('-73.25');
      expect(vu).not.toContain('"k"');
    }
    // L'attaque de la version 2 : essayer des salaires jusqu'à retrouver l'empreinte lue dans le jeton.
    const trouves = [40_000, 45_000, 50_000].filter((m) => jeton.includes(empreinteCriteres(criteres(m)))
      || octets.toString('latin1').includes(empreinteCriteres(criteres(m))));
    expect(trouves).toEqual([]);
    expect(jeton.length).toBeLessThanOrEqual(CURSEUR_MAX);
  });

  it('un jeton servi se relit sous les mêmes critères, et deux jetons de la même clé diffèrent', () => {
    const h = empreinteCriteres(criteres(45_000));
    expect(decoderCurseur(encoderCurseur(h, CLE), h, CLE.length)).toEqual([...CLE]);
    expect(encoderCurseur(h, CLE)).not.toBe(encoderCurseur(h, CLE));
  });

  it('rejoué sous d’autres préférences (un autre salaire) : refusé', () => {
    const jeton = encoderCurseur(empreinteCriteres(criteres(45_000)), CLE);
    expect(() => decoderCurseur(jeton, empreinteCriteres(criteres(46_000)), CLE.length)).toThrow(CurseurInvalideError);
  });

  it('forgé sans le secret : la forme de la version 2 (empreinte et clé en clair) est refusée', () => {
    const h = empreinteCriteres(criteres(45_000));
    for (const v of [2, 3]) {
      const forge = Buffer.from(JSON.stringify({ v, h, k: [...CLE] }), 'utf8').toString('base64url');
      expect(() => decoderCurseur(forge, h, CLE.length)).toThrow(CurseurInvalideError);
    }
  });

  it('modifié d’un seul octet, n’importe où : refusé', () => {
    const h = empreinteCriteres(criteres(45_000));
    const octets = Buffer.from(encoderCurseur(h, CLE), 'base64url');
    for (let i = 1; i < octets.length; i++) {
      const altere = Buffer.from(octets);
      altere[i] ^= 0x01;
      expect(() => decoderCurseur(altere.toString('base64url'), h, CLE.length), `octet ${i}`).toThrow(CurseurInvalideError);
    }
  });

  it('chiffré sous un autre secret (celui d’un attaquant, ou d’avant une rotation) : refusé', () => {
    const h = empreinteCriteres(criteres(45_000));
    process.env[CURSEUR_SECRET_VARIABLE] = SECRET_B;
    const etranger = encoderCurseur(h, CLE);
    process.env[CURSEUR_SECRET_VARIABLE] = SECRET_A;
    expect(() => decoderCurseur(etranger, h, CLE.length)).toThrow(CurseurInvalideError);
  });

  it('un secret trop court ne sert pas : une clé propre au processus, et l’absence est dite une seule fois', () => {
    const h = empreinteCriteres(criteres(45_000));
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      process.env[CURSEUR_SECRET_VARIABLE] = 'zq9-trop-bref';
      const jeton = encoderCurseur(h, CLE);
      delete process.env[CURSEUR_SECRET_VARIABLE];
      expect(decoderCurseur(jeton, h, CLE.length)).toEqual([...CLE]);
      // Le secret trop court n'a pas servi : sous le secret A, ce jeton est étranger.
      process.env[CURSEUR_SECRET_VARIABLE] = SECRET_A;
      expect(() => decoderCurseur(jeton, h, CLE.length)).toThrow(CurseurInvalideError);
      expect(journal.mock.calls.filter(([m]) => String(m).includes('curseur.secret_absent'))).toHaveLength(1);
      expect(journal.mock.calls.flat().join(' ')).not.toContain('zq9');
    } finally {
      journal.mockRestore();
    }
  });
});
