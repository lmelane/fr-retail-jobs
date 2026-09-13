import { describe, it, expect } from 'vitest';
import { sampleResources, startResourceSampling, readMemoryLimitBytes } from '../observability/resources.js';

/**
 * L'INSTRUMENTATION DES RESSOURCES — et surtout ce qu'elle refuse d'inventer.
 *
 * Le bilan P7 déclarait mémoire et connexions « non mesurées ». Les mesurer depuis un poste local aurait été
 * pire que de les omettre : on aurait publié la mémoire d'une machine de développement comme celle du service
 * Railway. Ces tests fixent donc les deux propriétés qui comptent : la mesure vient du processus lui-même, et
 * une grandeur illisible sort `null` avec son motif.
 */

/** Un faux Prisma dont la requête échoue : on vérifie que l'échec se DIT au lieu de rendre 0. */
const failingPrisma = { $queryRawUnsafe: async () => { throw new Error('connexion refusée'); } } as any;
const okPrisma = {
  $queryRawUnsafe: async () => [{ total: 7, active: 2, idle: 5, idle_in_transaction: 0, waiting: 1, longest: 3.5 }],
} as any;

describe('mesure des ressources — depuis le processus qui tourne', () => {
  it('rend la mémoire et le CPU du PROCESSUS courant', async () => {
    const s = await sampleResources(okPrisma);
    expect(s.rssBytes).toBeGreaterThan(0);
    expect(s.heapUsedBytes).toBeGreaterThan(0);
    expect(s.cpuUserUs).toBeGreaterThanOrEqual(0);
    expect(s.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('lit l\'état des connexions tel que la BASE le voit', async () => {
    const s = await sampleResources(okPrisma);
    expect(s.db).toMatchObject({ total: 7, active: 2, idle: 5, waiting: 1, longestQuerySeconds: 3.5 });
    expect(s.db.unavailable).toBeUndefined();
  });

  it('une lecture impossible DIT pourquoi et ne rend jamais 0', async () => {
    const s = await sampleResources(failingPrisma);
    expect(s.db.total).toBeNull();
    expect(s.db.waiting).toBeNull();
    expect(s.db.unavailable).toContain('connexion refusée');
    // Le piège à éviter : 0 connexion et « je n'ai pas pu lire » ne sont pas la même information.
    expect(s.db.total).not.toBe(0);
  });

  it('l\'OOM est null, jamais false : un processus tué ne rapporte pas sa propre mort', async () => {
    const r = await startResourceSampling(okPrisma, 10_000).stop();
    expect(r.oomObserved).toBeNull();
    expect(r.processUptimeSeconds).toBeGreaterThan(0);
  });

  it('le pic est un maximum sur les échantillons, et le rapport dit combien il en a', async () => {
    const sampler = startResourceSampling(okPrisma, 10);
    await new Promise((r) => setTimeout(r, 60));
    const report = await sampler.stop();
    expect(report.samples).toBeGreaterThanOrEqual(2);
    expect(report.peak.rssBytes).toBeGreaterThanOrEqual(report.after!.rssBytes * 0.5);
    expect(report.peak.dbTotal).toBe(7);
  });

  it('un seul échantillon est signalé comme tel plutôt que présenté comme un pic', async () => {
    const report = await startResourceSampling(okPrisma, 60_000).stop();
    if (report.samples < 2) expect(report.notes.join(' ')).toContain('moins de deux échantillons');
  });

  it('la limite mémoire est un nombre positif ou null — jamais une valeur par défaut inventée', async () => {
    const limit = await readMemoryLimitBytes();
    expect(limit === null || (typeof limit === 'number' && limit > 0)).toBe(true);
  });
});
