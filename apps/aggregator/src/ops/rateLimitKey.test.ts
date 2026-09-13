import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimitKeyFor, observedHost } from '../lib/rateLimitKey.js';
import { record429, stopOnFirst429, noteRequest, rateLimitHits, resetRateLimitSignal } from '../observability/rateLimitSignal.js';

/**
 * LA CLÉ DE LIMITATION — un tenant n'est pas toujours un hostname, et l'hébergeur n'est jamais le tenant.
 *
 * Les deux mesures qui imposent cette distinction :
 *  · `fastretailing.wd3` : 4 sources, 1 hostname, 3 × 429 → hostname = tenant, protection juste suffisante ;
 *  · `urbn-hub` : 1 source, 8 sous-domaines iCIMS, 1 398 requêtes → hostname ≠ tenant, protection 8× trop
 *    permissive.
 */
describe('rateLimitKey — le budget de l\'éditeur, pas le nom d\'hôte', () => {
  it('1. les huit sous-domaines URBN partagent UN budget', () => {
    const urls = [
      'https://stores-na-urbn.icims.com/jobs/1', 'https://homeoffice-na-urbn.icims.com/jobs/2',
      'https://stores-eu-urbn.icims.com/jobs/3', 'https://supplychain-na-urbn.icims.com/jobs/4',
      'https://menusandvenues-na-urbn.icims.com/jobs/5', 'https://homeoffice-eu-urbn.icims.com/jobs/6',
      'https://hub-urbn.icims.com/jobs/7', 'https://supplychain-eu-urbn.icims.com/jobs/8',
    ];
    const keys = new Set(urls.map((u) => rateLimitKeyFor(u)));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('tenant:urbn.icims');
  });

  it('2. deux clients iCIMS INDÉPENDANTS gardent deux budgets — jamais un « icims.com » global', () => {
    const urbn = rateLimitKeyFor('https://stores-na-urbn.icims.com/jobs/1');
    const autre = rateLimitKeyFor('https://careers-autreclient.icims.com/jobs/1');
    expect(urbn).not.toBe(autre);
    // Le piège : regrouper par eTLD+1 punirait un tiers innocent pour la charge d'un autre.
    expect(autre).not.toContain('tenant:icims');
  });

  it('3. quatre sources Fast Retailing partagent UN budget', () => {
    const urls = ['a', 'b', 'c', 'd'].map((s) => `https://fastretailing.wd3.myworkdayjobs.com/${s}`);
    const keys = new Set(urls.map((u) => rateLimitKeyFor(u)));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('tenant:fastretailing.workday');
  });

  it('3b. deux tenants Workday distincts gardent deux budgets, même instance', () => {
    expect(rateLimitKeyFor('https://mecca.wd3.myworkdayjobs.com/x'))
      .not.toBe(rateLimitKeyFor('https://fastretailing.wd3.myworkdayjobs.com/x'));
  });

  it('3c. le même tenant Workday sur deux instances (wd1/wd5) partage son budget', () => {
    // L'instance est un centre de données, pas un client : la séparer accorderait deux budgets à un seul.
    expect(rateLimitKeyFor('https://knitwellgroup.wd1.myworkdayjobs.com/x'))
      .toBe(rateLimitKeyFor('https://knitwellgroup.wd5.myworkdayjobs.com/y'));
  });

  it('4. sans clé explicite ni tenant connu : repli CONSERVATEUR sur le hostname', () => {
    const k = rateLimitKeyFor('https://careers.am-vintage.com/annonce/1');
    expect(k).toBe('host:careers.am-vintage.com');
    // Conservateur = ne regroupe rien par défaut ; un regroupement erroné ralentirait un tiers.
    expect(rateLimitKeyFor('https://autre.am-vintage.com/x')).not.toBe(k);
  });

  it('5. une clé explicite de configuration prime sur toute déduction', () => {
    const k = rateLimitKeyFor('https://stores-na-urbn.icims.com/jobs/1', 'urbn-group');
    expect(k).toBe('explicit:urbn-group');
  });

  it('6. le hostname observé reste disponible, séparément, pour le diagnostic', () => {
    const url = 'https://stores-na-urbn.icims.com/jobs/1';
    expect(observedHost(url)).toBe('stores-na-urbn.icims.com');
    expect(rateLimitKeyFor(url)).toBe('tenant:urbn.icims');
    // Les deux ne doivent pas se confondre : l'un mesure, l'autre protège.
    expect(observedHost(url)).not.toBe(rateLimitKeyFor(url));
  });

  it('une URL invalide ne fait pas tomber la clé', () => {
    expect(rateLimitKeyFor('pas-une-url')).toContain('host:');
  });
});

describe('429 comme signal de capacité, et arrêt franc des passages de mesure', () => {
  beforeEach(() => { resetRateLimitSignal(); delete process.env.P8_STOP_ON_FIRST_429; });

  const hit = (retryAfter: string | null) => record429({
    rateLimitKey: 'tenant:fastretailing.workday', host: 'fastretailing.wd3.myworkdayjobs.com',
    sourceKey: 'uniqlo-us-retail', url: 'https://fastretailing.wd3.myworkdayjobs.com/x',
    attempt: 1, retryAfterRaw: retryAfter, appliedDelayMs: 20_000, activeConcurrency: 4,
  });

  it('1. mode actif : le premier 429 demande l\'arrêt', () => {
    process.env.P8_STOP_ON_FIRST_429 = '1';
    expect(hit('30').shouldStop).toBe(true);
  });

  it('2. mode inactif : le pipeline garde sa politique de retry', () => {
    // Un cron qui s'arrêterait au premier 429 abandonnerait des offres pour un incident transitoire.
    expect(hit('30').shouldStop).toBe(false);
    expect(stopOnFirst429()).toBe(false);
  });

  it('3. Retry-After présent : la valeur BRUTE est archivée', () => {
    hit('120');
    expect(rateLimitHits()[0]!.retryAfterRaw).toBe('120');
  });

  it('4. Retry-After absent : null déclaré, jamais un zéro inventé', () => {
    hit(null);
    const h = rateLimitHits()[0]!;
    expect(h.retryAfterRaw).toBeNull();
    // Un hôte muet et un hôte qui demande 0 s ne se confondent pas.
    expect(h.retryAfterRaw).not.toBe('0');
    expect(h.appliedDelayMs).toBeGreaterThan(0);
  });

  it('archive la pression qui a précédé le refus — c\'est elle qui situe la limite', () => {
    for (let i = 0; i < 7; i++) noteRequest('tenant:fastretailing.workday');
    hit('10');
    const h = rateLimitHits()[0]!;
    expect(h.requestsLast5s).toBe(7);
    expect(h.requestsLast60s).toBe(7);
    expect(h.activeConcurrency).toBe(4);
  });

  it('un retry réussi ne rend pas la cadence recommandable : le 429 reste archivé', () => {
    hit('30');
    expect(rateLimitHits()).toHaveLength(1);
  });
});

describe('la porte applique réellement le budget par tenant', () => {
  it('5b/6b. huit sous-domaines URBN : UN sémaphore, pas huit', async () => {
    const { withHostGate } = await import('../lib/hostGate.js');
    const subs = ['stores-na', 'homeoffice-na', 'stores-eu', 'supplychain-na',
                  'menusandvenues-na', 'homeoffice-eu', 'hub', 'supplychain-eu'];
    let active = 0; let peak = 0;
    await Promise.all(subs.map((s) => withHostGate(`https://${s}-urbn.icims.com/j`, async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 300));
      active--;
      return null;
    })));
    // Avant le correctif : 8 hôtes → 8 budgets → les 8 en parallèle. Après : un seul budget, plafond 4.
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('deux tenants distincts ne se bloquent PAS l\'un l\'autre', async () => {
    const { withHostGate } = await import('../lib/hostGate.js');
    let active = 0; let peak = 0;
    const urls = [...Array(4)].map((_, i) => `https://stores-na-urbn.icims.com/${i}`)
      .concat([...Array(4)].map((_, i) => `https://mecca.wd3.myworkdayjobs.com/${i}`));
    await Promise.all(urls.map((u) => withHostGate(u, async () => {
      active++; peak = Math.max(peak, active);
      // 300 ms : DÉLIBÉRÉMENT plus long que l'écart de 80 ms entre départs. Une tâche plus courte que
      // l'écart se termine avant que la suivante ne parte, et le pic mesuré vaut 1 — on mesurerait alors
      // l'écart, pas la concurrence. (Erreur commise avec des tâches de 30 ms : pic 1 au lieu de 8.)
      await new Promise((r) => setTimeout(r, 300));
      active--;
      return null;
    })));
    // Deux budgets indépendants : 4 + 4 simultanés, sans qu'un tenant pénalise l'autre.
    expect(peak).toBeGreaterThan(4);
  });
});
