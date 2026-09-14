import { describe, it, expect } from 'vitest';
import {
  accessDecision, ACCESS_SURFACES, isPublicJobSurface,
  type AccessSurface,
} from '../lib/accessDecision.js';
import { CRAWLER_IDENTITY, BOT_INFO_URL } from '../lib/crawlerIdentity.js';

/**
 * LA DÉCISION D'ACCÈS — D62, 2026-09-13.
 *
 * Avant cette décision, `robotsVerdict` faisait tout : il observait ET décidait. Un `Disallow: /` mettait
 * donc une source en pause, quelle que soit la nature de la surface et quelle que soit l'autorisation du
 * propriétaire.
 *
 * Le cas qui l'a imposé : `api.smartrecruiters.com` sert `Disallow: /` pour tous sauf LinkedInBot, alors que
 * 46 sources du catalogue y lisent des offres PUBLIQUES, dans un périmètre que le propriétaire déclare
 * autorisé. Un seul champ ne pouvait pas porter les deux vérités sans en écraser une.
 *
 * Trois champs distincts, donc : ce qu'on a OBSERVÉ, sur quoi on se FONDE, ce qu'on DÉCIDE. La règle
 * cardinale est qu'aucun des trois ne réécrit les autres — en particulier, une décision favorable ne
 * transforme jamais un `DISALLOWED` observé en `ALLOWED`.
 */
describe('décision d\'accès — observer, fonder, décider sont trois choses', () => {
  it('surface publique + autorisation propriétaire → ALLOWED, même si robots interdit', () => {
    const d = accessDecision({ robotsObserved: 'DISALLOWED', accessSurface: 'PUBLIC_ATS_JOB_API' });
    expect(d.effectiveAccessDecision).toBe('ALLOWED');
    expect(d.authorizationBasis).toBe('OWNER_SECTOR_AUTHORIZATION');
  });

  it('le robots OBSERVÉ n\'est jamais réécrit par la décision', () => {
    // Le fait mesuré reste le fait mesuré : c'est ce qui permet d'expliquer plus tard pourquoi on a collecté.
    const d = accessDecision({ robotsObserved: 'DISALLOWED', accessSurface: 'PUBLIC_ATS_JOB_API' });
    expect(d.robotsObserved).toBe('DISALLOWED');
  });

  it('surface PRIVÉE → NOT_AUTHORIZED, même si robots autorise', () => {
    // L'autorisation sectorielle ne couvre pas les données candidat : un robots permissif n'y change rien.
    const d = accessDecision({ robotsObserved: 'ALLOWED', accessSurface: 'PRIVATE_OR_INTERNAL' });
    expect(d.effectiveAccessDecision).toBe('NOT_AUTHORIZED');
    expect(d.authorizationBasis).toBe('NONE');
  });

  it('porte l\'identité du crawler et l\'URL du bot', () => {
    const d = accessDecision({ robotsObserved: 'ALLOWED', accessSurface: 'PUBLIC_OFFICIAL_HTML' });
    expect(d.crawlerIdentity).toBe(CRAWLER_IDENTITY);
    expect(d.botInfoUrl).toBe(BOT_INFO_URL);
  });

  it('porte la portée et la date de la décision propriétaire', () => {
    const d = accessDecision({ robotsObserved: 'DISALLOWED', accessSurface: 'PUBLIC_SITEMAP' });
    expect(d.ownerDecisionScope).toBe('LUXURY_FASHION_BEAUTY_RETAIL_WATCHES_PUBLIC_JOBS');
    expect(d.ownerDecisionAt).toBe('2026-09-13');
  });

  it('toutes les surfaces publiques décidées par la même règle — aucune liste d\'ATS', () => {
    // La décision se prend sur la SURFACE, jamais sur le nom commercial de l'éditeur.
    const publiques = ACCESS_SURFACES.filter((s) => s !== 'PRIVATE_OR_INTERNAL');
    for (const s of publiques) {
      expect(isPublicJobSurface(s)).toBe(true);
      expect(accessDecision({ robotsObserved: 'DISALLOWED', accessSurface: s }).effectiveAccessDecision).toBe('ALLOWED');
    }
    expect(isPublicJobSurface('PRIVATE_OR_INTERNAL')).toBe(false);
  });

  it('les neuf surfaces de la décision sont présentes, ni plus ni moins', () => {
    expect([...ACCESS_SURFACES].sort()).toEqual(([
      'PRIVATE_OR_INTERNAL', 'PUBLIC_ATS_HTML', 'PUBLIC_ATS_JOB_API', 'PUBLIC_JS_RENDERED_PAGE',
      'PUBLIC_OFFICIAL_API', 'PUBLIC_OFFICIAL_HTML', 'PUBLIC_PORTAL_JSON', 'PUBLIC_SITEMAP',
      'PUBLIC_XML_OR_RSS',
    ] as AccessSurface[]).sort());
  });

  it('UNREACHABLE reste UNREACHABLE : on ne décide pas sur ce qu\'on n\'a pas lu', () => {
    // Un robots injoignable n'autorise rien et n'interdit rien — il n'a pas été lu (D60). La surface publique
    // et l'autorisation restent valables, mais l'observation ne doit pas être maquillée en lecture.
    const d = accessDecision({ robotsObserved: 'UNREACHABLE', accessSurface: 'PUBLIC_OFFICIAL_HTML' });
    expect(d.robotsObserved).toBe('UNREACHABLE');
    expect(d.effectiveAccessDecision).toBe('ALLOWED');
  });
});
