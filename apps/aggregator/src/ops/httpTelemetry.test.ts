import { describe, it, expect, beforeEach } from 'vitest';
import { recordAttempt, recordResponse, recordFailure, snapshotHosts, resetHosts } from '../observability/httpTelemetry.js';

/**
 * LA TÉLÉMÉTRIE PAR HÔTE — parce qu'un total ne dit pas où le temps passe.
 *
 * P8 demande quelle famille ATS consomme le plus. Cette question n'a pas de réponse sur un compte global :
 * c'est l'hôte qui impose la latence et qui throttle. Ces tests fixent ce que la mesure doit distinguer, et
 * surtout ce qu'elle ne doit jamais inventer.
 */
describe('télémétrie HTTP par hôte', () => {
  beforeEach(() => resetHosts());

  it('sépare les hôtes, jamais un total unique', () => {
    recordAttempt('https://a.example/x', false);
    recordResponse('https://a.example/x', 200, 100, '500');
    recordAttempt('https://b.example/y', false);
    recordResponse('https://b.example/y', 200, 300, '900');
    const hosts = snapshotHosts();
    expect(hosts.map((h) => h.host).sort()).toEqual(['a.example', 'b.example']);
    expect(hosts.find((h) => h.host === 'b.example')!.p50Ms).toBe(300);
  });

  it('distingue une tentative d\'une RE-tentative', () => {
    recordAttempt('https://a.example/x', false);
    recordAttempt('https://a.example/x', true);
    const [h] = snapshotHosts();
    expect(h.attempts).toBe(2);
    expect(h.retries).toBe(1); // une re-tentative est une tentative, pas une tentative de plus non comptée
  });

  it('distingue un TIMEOUT d\'une erreur réseau — un hôte lent n\'est pas un hôte cassé', () => {
    recordFailure('https://a.example/x', 'timeout');
    recordFailure('https://a.example/x', 'error');
    const [h] = snapshotHosts();
    expect(h.timeouts).toBe(1);
    expect(h.errors).toBe(1);
  });

  it('compte les statuts séparément : un 404 attendu n\'est pas une erreur mais doit se voir', () => {
    for (const s of [200, 200, 404, 429]) { recordAttempt('https://a.example/x', false); recordResponse('https://a.example/x', s, 10, null); }
    const [h] = snapshotHosts();
    expect(h.statuses).toEqual({ '200': 2, '404': 1, '429': 1 });
  });

  it('une taille non annoncée reste NULL, jamais 0', () => {
    recordAttempt('https://a.example/x', false);
    recordResponse('https://a.example/x', 200, 10, null);
    const [h] = snapshotHosts();
    // « je ne sais pas » et « rien » sont deux informations différentes : les confondre fausse tout coût/octet.
    expect(h.bytesDeclared).toBeNull();
    expect(h.responsesWithoutLength).toBe(1);
  });

  it('additionne les tailles annoncées et compte celles qui manquent', () => {
    recordAttempt('https://a.example/1', false); recordResponse('https://a.example/1', 200, 10, '100');
    recordAttempt('https://a.example/2', false); recordResponse('https://a.example/2', 200, 10, null);
    const [h] = snapshotHosts();
    expect(h.bytesDeclared).toBe(100);
    expect(h.responsesWithoutLength).toBe(1);
  });

  it('les percentiles sont null sur un échantillon vide, jamais 0', () => {
    recordAttempt('https://a.example/x', false); // aucune réponse
    const [h] = snapshotHosts();
    expect(h.p50Ms).toBeNull();
    expect(h.p95Ms).toBeNull();
    expect(h.maxMs).toBeNull();
  });

  it('p50 / p95 / max sont cohérents sur un échantillon connu', () => {
    for (const ms of [10, 20, 30, 40, 50, 60, 70, 80, 90, 1000]) {
      recordAttempt('https://a.example/x', false);
      recordResponse('https://a.example/x', 200, ms, null);
    }
    const [h] = snapshotHosts();
    expect(h.p50Ms).toBe(50);
    expect(h.maxMs).toBe(1000);
    expect(h.p95Ms).toBe(1000); // la queue lente doit être VISIBLE, c'est tout l'intérêt du p95
  });

  it('le débit par hôte n\'est calculé que si la fenêtre est connue', () => {
    recordAttempt('https://a.example/x', false);
    recordResponse('https://a.example/x', 200, 10, null);
    expect(snapshotHosts()[0]!.requestsPerSecond).toBeNull();
    expect(snapshotHosts(2)[0]!.requestsPerSecond).toBe(0.5);
  });

  it('resetHosts repart de zéro — un second passage n\'hérite pas du premier', () => {
    recordAttempt('https://a.example/x', false);
    resetHosts();
    expect(snapshotHosts()).toEqual([]);
  });

  it('une URL invalide ne fait pas tomber la mesure', () => {
    recordAttempt('pas-une-url', false);
    expect(snapshotHosts()[0]!.host).toBe('url-invalide');
  });
});
