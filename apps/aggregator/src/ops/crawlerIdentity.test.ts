import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRAWLER_IDENTITY, BOT_INFO_URL } from '../lib/crawlerIdentity.js';

/**
 * L'IDENTITÉ DU CRAWLER — décision propriétaire D62 du 2026-09-13.
 *
 * L'opérateur du collecteur est Catwalks. Son identité doit être VRAIE sur tous les modes de collecte, et
 * elle ne doit jamais emprunter celle d'un tiers.
 *
 * Le cas qui l'a imposé : `api.smartrecruiters.com` sert `User-agent: LinkedInBot / Allow: /v1/companies/`
 * puis `User-agent: * / Disallow: /`. La tentation technique — se déclarer LinkedInBot pour tomber dans
 * l'exception — est explicitement interdite : notre droit d'accès repose sur l'autorisation du propriétaire
 * et sur la nature publique des offres, **jamais sur l'identité d'un tiers**.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('identité du crawler (D62)', () => {
  it('est CatwalksBot/1.0 et porte l\'URL d\'information', () => {
    expect(CRAWLER_IDENTITY).toBe('CatwalksBot/1.0 (+https://catwalks.io/bot)');
    expect(BOT_INFO_URL).toBe('https://catwalks.io/bot');
  });

  it('n\'emprunte JAMAIS l\'identité d\'un tiers', () => {
    // Interdits nommés par la décision : se déclarer LinkedInBot pour tomber dans l'exception de
    // SmartRecruiters serait une usurpation, pas une autorisation.
    for (const usurpe of ['LinkedInBot', 'Googlebot', 'IndeedBot', 'bingbot', 'Slurp']) {
      expect(CRAWLER_IDENTITY).not.toContain(usurpe);
    }
  });

  it('ne porte plus l\'ancienne marque : l\'opérateur est Catwalks', () => {
    // « Mode Careers » est le produit ; Catwalks est l'opérateur. Un UA qui nomme le produit désigne mal
    // l'entité responsable, que l'éditeur doit pouvoir contacter.
    expect(CRAWLER_IDENTITY).not.toMatch(/modecareers/i);
    expect(CRAWLER_IDENTITY).toMatch(/^CatwalksBot\//);
  });

  it('le transport HTTP utilise CETTE identité, pas une chaîne recopiée', () => {
    const http = readFileSync(resolve(SRC, 'lib/http.ts'), 'utf8');
    expect(http).toContain('CRAWLER_IDENTITY');
    // L'ancienne valeur ne doit plus être codée en dur : deux identités finiraient par diverger.
    expect(http).not.toContain('CatwalksJobsBot/0.1');
  });

  it('AUCUN adaptateur ne déclare sa propre identité — elle vient du module partagé', () => {
    // Mesuré le 2026-09-14 : 17 adaptateurs portaient leur propre `Mozilla/5.0 … Chrome/…`. Une identité que
    // chaque adaptateur peut redéfinir n'est pas une identité : l'éditeur voit 18 crawlers différents, et D62
    // ne s'applique qu'au chemin qu'on a pensé à corriger.
    const dir = resolve(SRC, 'ats/adapters');
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => /['"`]Mozilla\/5\.0/.test(readFileSync(resolve(dir, f), 'utf8')));
    expect(offenders, `adaptateurs déclarant leur propre UA : ${offenders.join(', ')}`).toEqual([]);
  });

  it('la lecture de robots.txt s\'annonce sous l\'identité Catwalks, jamais sous l\'ancienne marque', () => {
    // `ModeCareersBot` est explicitement interdit par D62 : l'opérateur est Catwalks, pas le produit — et
    // c'est sous ce nom que l'éditeur nous évalue dans son robots.txt.
    const src = readFileSync(resolve(SRC, 'lib/candidateChecks.ts'), 'utf8');
    expect(src).not.toMatch(/ModeCareersBot/);
    expect(src).toContain('CRAWLER_IDENTITY');
  });

  it('aucune source du dépôt ne déclare un User-Agent de tiers', () => {
    // Garde de non-régression : le jour où quelqu'un « résout » un blocage en se faisant passer pour un
    // moteur, ce test échoue.
    for (const f of ['lib/http.ts', 'lib/browser.ts']) {
      const src = readFileSync(resolve(SRC, f), 'utf8');
      expect(src, `${f} ne doit pas déclarer LinkedInBot`).not.toMatch(/['"`][^'"`]*LinkedInBot/i);
    }
  });
});
