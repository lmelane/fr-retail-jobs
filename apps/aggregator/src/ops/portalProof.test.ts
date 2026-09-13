import { describe, it, expect } from 'vitest';
import { portalProof, isOnOfficialDomain, excerptAround, sha256Of } from '../certification/portalProof.js';

/**
 * LA PREUVE DE PORTAIL — ce qui se prouve, ce qui se réfute, ce qui reste invérifiable.
 *
 * D60 refuse qu'un portail soit certifié parce que son domaine ressemble à celui de la Maison. La vague 1 de
 * P9 a montré pourquoi sur deux cas réels : `kult-olymp-hades` appelle
 * `jpweltersgorgensgmbhcobekleidungskg.recruitee.com`, `oak-essentials` le board Greenhouse `jennikayne`.
 * Aucune comparaison de domaines n'aurait rapproché ces tenants de leur Maison.
 *
 * La règle testée ici est donc : **seule la page officielle rapproche, et son silence refuse.**
 */
const OK = {
  requestedUrl: 'https://armandthiery.fr/', finalUrl: 'https://armandthiery.fr/',
  httpStatus: 200, officialDomain: 'armandthiery.fr',
  body: '<a href="https://armandthiery.flatchr.io/fr/company/armandthiery/">Nos offres</a>',
  mustContain: 'armandthiery.flatchr.io',
};

describe('preuve de portail — fail-closed', () => {
  it('PROUVE quand la page officielle nomme le board configuré', () => {
    const p = portalProof(OK);
    expect(p.verdict).toBe('PROVEN');
    expect(p.sha256).toBe(sha256Of(OK.body));
    expect(p.excerpt).toContain('armandthiery.flatchr.io');
  });

  it('RÉFUTE quand la page ne nomme pas le board — le silence ne prouve rien', () => {
    const p = portalProof({ ...OK, mustContain: 'jennikayne' });
    expect(p.verdict).toBe('REFUTED');
    expect(p.reason).toContain('jennikayne');
    // Le hachage existe quand même : on archive ce qu'on a lu, y compris pour justifier un refus.
    expect(p.sha256).not.toBeNull();
  });

  it('RÉFUTE quand la page nomme un AUTRE tenant', () => {
    const p = portalProof({ ...OK, body: '<a href="https://autremaison.flatchr.io/fr/company/autre/">Offres</a>' });
    expect(p.verdict).toBe('REFUTED');
  });

  it('le cas kult-olymp-hades : le domaine ne suffit pas, l\'entité juridique doit être NOMMÉE', () => {
    const sans = portalProof({
      requestedUrl: 'https://www.kult-olymp-hades.de/', finalUrl: 'https://www.kult-olymp-hades.de/',
      httpStatus: 200, officialDomain: 'kult-olymp-hades.de',
      body: '<h1>KULT | OLYMP&HADES</h1><a href="/karriere">Karriere</a>',
      mustContain: 'jpweltersgorgensgmbhcobekleidungskg',
    });
    expect(sans.verdict).toBe('REFUTED');

    const avec = portalProof({
      requestedUrl: 'https://www.kult-olymp-hades.de/karriere', finalUrl: 'https://www.kult-olymp-hades.de/karriere',
      httpStatus: 200, officialDomain: 'kult-olymp-hades.de',
      body: '<a href="https://jpweltersgorgensgmbhcobekleidungskg.recruitee.com/">Zu unseren Stellen</a>',
      mustContain: 'jpweltersgorgensgmbhcobekleidungskg',
    });
    expect(avec.verdict).toBe('PROVEN');
  });

  it('RÉFUTE une redirection SORTIE du domaine officiel', () => {
    // Une page qui finit ailleurs ne dit plus ce que la Maison publie.
    const p = portalProof({ ...OK, finalUrl: 'https://parked-domain.example/' });
    expect(p.verdict).toBe('REFUTED');
    expect(p.reason).toMatch(/domaine officiel/);
  });

  it('INVÉRIFIABLE sur une page non lue — jamais confondu avec une réfutation', () => {
    // Confondre « je n'ai pas pu lire » et « la page dit non » ferait abandonner une Maison pour une panne.
    for (const status of [403, 404, 500, 503]) {
      const p = portalProof({ ...OK, httpStatus: status, body: '' });
      expect(p.verdict).toBe('UNVERIFIABLE');
      expect(p.sha256).toBeNull();
    }
  });

  it('INVÉRIFIABLE sur une page vide en HTTP 200', () => {
    expect(portalProof({ ...OK, body: '   ' }).verdict).toBe('UNVERIFIABLE');
  });

  it('accepte un sous-domaine du domaine officiel, refuse un domaine qui le contient seulement', () => {
    expect(isOnOfficialDomain('https://careers.lacoste.com/x', 'lacoste.com')).toBe(true);
    expect(isOnOfficialDomain('https://www.lacoste.com/', 'lacoste.com')).toBe(true);
    // Piège classique : `lacoste.com.evil.example` n'est PAS lacoste.com.
    expect(isOnOfficialDomain('https://lacoste.com.evil.example/', 'lacoste.com')).toBe(false);
    expect(isOnOfficialDomain('https://notlacoste.com/', 'lacoste.com')).toBe(false);
  });

  it('la concordance ignore la casse — un board se nomme, il ne s\'orthographie pas', () => {
    expect(portalProof({ ...OK, body: '<a href="https://ARMANDTHIERY.FLATCHR.IO/x">o</a>' }).verdict).toBe('PROVEN');
  });

  it('l\'extrait montre le contexte, pas seulement la chaîne trouvée', () => {
    const e = excerptAround('avant '.repeat(40) + 'CIBLE' + ' après'.repeat(40), 'CIBLE');
    expect(e).toContain('CIBLE');
    expect(e!.length).toBeGreaterThan('CIBLE'.length);
  });
});
