import { describe, expect, it } from 'vitest';

import { safeJsonLd } from '../safe-json-ld';

/**
 * Le rendu SÛR d'un contenu externe (P5, item 7).
 *
 * Les titres et descriptions viennent de flux ATS tiers. Le JSON-LD est injecté par
 * `dangerouslySetInnerHTML` — c'est inévitable pour un bloc `application/ld+json` — donc la seule protection est
 * l'échappement. Sans lui, une description contenant `</script>` fermerait le bloc et injecterait du balisage
 * dans la page (XSS stocké).
 *
 * Ce test existait comme COMMENTAIRE dans le code source, pas comme test. Mesuré le 2026-09-11 : le corpus de
 * production ne contient aujourd'hui **aucune** description hostile (0 `<script`, 0 `<iframe`, 0 `javascript:`
 * sur 78 932 offres actives), ce qui signifie qu'un contrôle en production ne peut RIEN prouver ici — il
 * passerait même si l'échappement était retiré. D'où une épreuve sur charge hostile réelle.
 */
describe('safeJsonLd — un contenu externe ne peut pas sortir de son bloc', () => {
  it('neutralise une fermeture de script dans une description', () => {
    const payload = { description: 'Vendeur H/F</script><script>alert(1)</script>' };
    const out = safeJsonLd(payload);
    // Plus aucun `<` littéral : le bloc ne peut pas être refermé par le contenu.
    expect(out).not.toContain('<');
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c');
    // Et la donnée reste intègre une fois relue : on échappe, on ne mutile pas.
    expect(JSON.parse(out).description).toBe(payload.description);
  });

  it('neutralise les séparateurs de ligne U+2028 / U+2029', () => {
    // Terminateurs de ligne JavaScript : ils casseraient le script sans être visibles.
    const out = safeJsonLd({ title: 'Conseiller de vente' });
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
    expect(JSON.parse(out).title).toBe('Conseiller de vente');
  });

  it('laisse intact un contenu ordinaire', () => {
    const out = safeJsonLd({ title: 'Conseiller de vente — 35h', city: 'Saint-Étienne' });
    expect(JSON.parse(out)).toEqual({ title: 'Conseiller de vente — 35h', city: 'Saint-Étienne' });
  });

  it('échappe aussi une balise ouvrante, pas seulement la fermeture', () => {
    const out = safeJsonLd({ description: '<img src=x onerror=alert(1)>' });
    expect(out).not.toContain('<img');
    expect(JSON.parse(out).description).toBe('<img src=x onerror=alert(1)>');
  });
});
