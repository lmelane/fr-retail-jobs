import { describe, expect, it } from 'vitest';
import { urlVerrouillee } from '../lot0-v2-db.js';

/**
 * TÉMOINS DE L'ACCÈS D'AUDIT.
 *
 * Ces témoins portent sur la CONSTRUCTION de l'URL et sur le traitement des valeurs
 * contradictoires. Ils ne touchent aucune base : les épreuves qui exigent un serveur (refus
 * d'écriture, comportement du pool, réintroduction volontaire d'un défaut) appartiennent à la
 * base de test isolée et ne doivent JAMAIS viser la production — c'est précisément une tentative
 * d'écriture « de vérification » qui a créé des tables temporaires en production le 2026-09-20.
 */
describe('urlVerrouillee', () => {
  const BASE = 'postgresql://u:p@h:5432/db?sslmode=require';

  it('ajoute le verrou quand aucune option n\'est présente', () => {
    const out = urlVerrouillee(BASE);
    expect(out).toContain('options=-c%20default_transaction_read_only%3Don');
    // PRÉMISSE : l'URL de départ ne portait pas déjà le paramètre.
    expect(BASE).not.toContain('default_transaction_read_only');
    // Les paramètres existants survivent — en perdre un changerait la connexion en silence.
    expect(out).toContain('sslmode=require');
  });

  it('REFUSE une URL qui demande explicitement l\'écriture', () => {
    /*
     * LE DÉFAUT EXACT DE LA VERSION PRÉCÉDENTE. Elle testait la présence du NOM du paramètre
     * (`includes('default_transaction_read_only')`) et rendait donc l'URL inchangée lorsque sa
     * VALEUR disait `off` : le garde validait exactement ce qu'il devait interdire.
     */
    const contradictoire = `${BASE}&options=-c default_transaction_read_only%3Doff`;
    expect(() => urlVerrouillee(contradictoire)).toThrow(/contredit un accès d'audit/);

    // PRÉMISSE : le nom EST présent — c'est bien le cas que la présence seule laissait passer.
    expect(contradictoire).toContain('default_transaction_read_only');
  });

  it('refuse aussi les autres écritures de la valeur négative', () => {
    for (const v of ['off', 'false', '0', 'OFF', 'False'])
      expect(() => urlVerrouillee(`${BASE}&options=-c default_transaction_read_only%3D${v}`), v)
        .toThrow(/contredit/);
  });

  it('accepte une URL déjà correctement verrouillée, sans la modifier deux fois', () => {
    for (const v of ['on', 'true', '1'])
      expect(urlVerrouillee(`${BASE}&options=-c default_transaction_read_only%3D${v}`), v)
        .not.toMatch(/default_transaction_read_only.*default_transaction_read_only/);
  });

  it('préserve une option étrangère en ajoutant le verrou', () => {
    const out = urlVerrouillee(`${BASE}&options=-c statement_timeout%3D25000`);
    expect(out).toContain('statement_timeout');
    expect(out).toContain('default_transaction_read_only');
  });
});
