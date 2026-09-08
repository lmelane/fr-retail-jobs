import { describe, expect, it } from 'vitest';
import { isTrustedForAttestation, ATTESTATION_MIN_COVERAGE } from './attestation.js';

/**
 * LA RÈGLE (Loïc, 2026-09-08) : « seul un run complet et fiable peut attester
 * l'absence d'une offre ». Un run peut avoir collecté 500 offres et néanmoins
 * ne PAS avoir le droit de déclarer les 1 000 autres disparues.
 *
 * Ces tests décrivent le droit d'attester, pas la santé. Les deux notions sont
 * indépendantes : une source peut être DEGRADED sur la couverture d'un champ
 * (descriptions manquantes) tout en ayant vu la totalité de son board — elle
 * garde alors le droit d'attester.
 */
describe('isTrustedForAttestation', () => {
  it('unknown completion never proves absence, even with an OK status', () => {
    expect(isTrustedForAttestation({ status: 'OK', fetched: 100 })).toBe(false);
    expect(isTrustedForAttestation({ status: 'OK', complete: false, fetched: 100 })).toBe(false);
  });
  it('un run OK atteste', () => {
    expect(isTrustedForAttestation({ complete: true, status: 'OK' })).toBe(true);
  });

  describe('les échecs francs n’attestent jamais', () => {
    it.each(['BROKEN', 'TIMEOUT', 'ERROR', 'CHALLENGED'] as const)('%s → refus', (status) => {
      expect(isTrustedForAttestation({ complete: true, status })).toBe(false);
    });
  });

  /**
   * LE CAS LAGARDÈRE (20 lues sur 109 déclarées). Le run a écrit 20 offres, donc
   * la garde « silent zero » de la purge le laissait passer, et le refresh
   * fermait les 89 autres. C'est le trou que cette règle bouche.
   */
  it('un run tronqué n’atteste pas, même s’il a produit des offres', () => {
    expect(
      isTrustedForAttestation({ complete: true, status: 'DEGRADED', truncated: true, declaredTotal: 109, fetched: 20 }),
    ).toBe(false);
  });

  it('une couverture sous le plancher n’atteste pas', () => {
    expect(isTrustedForAttestation({ complete: true, status: 'DEGRADED', declaredTotal: 100, fetched: 50 })).toBe(false);
  });

  it('une couverture au-dessus du plancher atteste', () => {
    expect(isTrustedForAttestation({ complete: true, status: 'OK', declaredTotal: 100, fetched: 99 })).toBe(true);
  });

  it('le plancher lui-même atteste (borne incluse)', () => {
    const fetched = Math.ceil(100 * ATTESTATION_MIN_COVERAGE);
    expect(isTrustedForAttestation({ complete: true, status: 'OK', declaredTotal: 100, fetched })).toBe(true);
  });

  /**
   * Une source honnête qui n'annonce aucun total (LVMH, la plupart des flux
   * JSON) doit garder le droit d'attester : sinon plus aucune offre ne se
   * fermerait jamais et le catalogue se remplirait de postes morts.
   */
  it('sans total déclaré, un run sain atteste', () => {
    expect(isTrustedForAttestation({ complete: true, status: 'OK', fetched: 250 })).toBe(true);
  });

  /**
   * DEGRADED n'est PAS synonyme d'interdiction : une source qui a vu tout son
   * board mais perd ses descriptions reste légitime pour attester l'absence.
   * Confondre les deux fermerait la porte à toute expiration normale.
   */
  it('un DEGRADED de couverture de CHAMP atteste encore', () => {
    expect(isTrustedForAttestation({ complete: true, status: 'DEGRADED', fetched: 900, declaredTotal: 900 })).toBe(true);
  });

  /**
   * L'effondrement de volume est traité comme non fiable : passer de 1 700 à
   * 300 sans que la source l'annonce est le motif même de L'Oréal/Michael Page.
   */
  it('un effondrement de volume face au run précédent n’atteste pas', () => {
    expect(isTrustedForAttestation({ complete: true, status: 'DEGRADED', fetched: 300, previous: 1700 })).toBe(false);
  });

  it('une variation normale atteste', () => {
    expect(isTrustedForAttestation({ complete: true, status: 'OK', fetched: 1650, previous: 1700 })).toBe(true);
  });

  /** Une source neuve n'a pas de passé : rien à attester, mais rien à fermer non plus. */
  it('un run NEW n’atteste pas', () => {
    expect(isTrustedForAttestation({ complete: true, status: 'NEW', fetched: 40 })).toBe(false);
  });
});
