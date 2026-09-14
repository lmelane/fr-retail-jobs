import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCareerConnectJob, careerConnectRequest, phenomDialect } from './phenom.js';

/**
 * PHENOM N'EST PAS UNE API UNIFORME — deux dialectes, choisis par CONFIGURATION.
 *
 * Mesuré le 2026-09-14 : le même chemin `/api/jobs` rend HTTP 200 chez Foot Locker et **HTTP 500** chez Hugo
 * Boss et Skechers. J'en avais conclu « source bloquée », ce qui était faux : les deux portails servent leurs
 * offres par `POST /widgets` (`ddoKey: refineSearch`), le dialecte CareerConnect — Hugo Boss **784** offres,
 * Skechers **1 656**.
 *
 * *Un 500 sur un endpoint qu'on a deviné ne dit rien de la source.* D'où la règle testée ici : le dialecte est
 * une **configuration explicite**, jamais une cascade d'endpoints essayés jusqu'à ce que l'un réponde — une
 * telle cascade masquerait une panne réelle en la faisant passer pour un changement de dialecte.
 *
 * La fixture est une réponse RÉELLE de `careers.hugoboss.com`, capturée le 2026-09-14.
 */
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const payload = JSON.parse(readFileSync(resolve(FIXTURES, 'phenom-careerconnect-hugoboss.json'), 'utf8'));
const jobs = payload.refineSearch.data.jobs as any[];

describe('dialecte Phenom — choisi par configuration', () => {
  it('par défaut : le dialecte historique de Foot Locker', () => {
    expect(phenomDialect({})).toBe('FOOTLOCKER_API_JOBS');
    expect(phenomDialect({ origin: 'https://careers.footlocker.com' })).toBe('FOOTLOCKER_API_JOBS');
  });

  it('CareerConnect quand la configuration le déclare', () => {
    expect(phenomDialect({ dialect: 'CAREER_CONNECT_WIDGETS' })).toBe('CAREER_CONNECT_WIDGETS');
  });

  it('REFUSE un dialecte inconnu plutôt que de retomber sur un défaut', () => {
    // Retomber silencieusement sur Foot Locker enverrait une requête qui rend 500 et ferait croire à une
    // source cassée — exactement l'erreur de diagnostic qu'on corrige.
    expect(() => phenomDialect({ dialect: 'DEVINE' })).toThrow(/dialecte/i);
  });
});

describe('requête CareerConnect', () => {
  it('interroge /widgets en POST avec le ddoKey déclaré par la page', () => {
    const r = careerConnectRequest('https://careers.hugoboss.com', { from: 0, size: 100 });
    expect(r.url).toBe('https://careers.hugoboss.com/widgets');
    expect(r.method).toBe('POST');
    expect(r.body.ddoKey).toBe('refineSearch');
    expect(r.body.jobs).toBe(true);
  });

  it('pagine par `from`, jamais par `page` : le dialecte Foot Locker ignorerait `from`', () => {
    expect(careerConnectRequest('https://x.com', { from: 700, size: 100 }).body.from).toBe(700);
    expect(careerConnectRequest('https://x.com', { from: 700, size: 100 }).body).not.toHaveProperty('page');
  });

  it('demande le périmètre MONDIAL par défaut — une locale ne doit pas réduire la source', () => {
    // Mesuré : Skechers rend 1 656 en `lang=fr country=France` comme en `lang=en country=global`. Le backend
    // sert le monde ; on demande explicitement global pour ne pas dépendre de ce comportement.
    const b = careerConnectRequest('https://x.com', { from: 0, size: 100 }).body;
    expect(b.country).toBe('global');
  });
});

describe('normalisation d\'une offre CareerConnect réelle', () => {
  it('lit les trois offres de la fixture', () => {
    expect(jobs).toHaveLength(3);
    expect(payload.refineSearch.totalHits).toBe(784);
  });

  it('l\'identifiant externe est le jobSeqNo natif, stable et unique', () => {
    const j = parseCareerConnectJob(jobs[0], 'https://careers.hugoboss.com');
    expect(j).not.toBeNull();
    // `jobSeqNo` porte le tenant et la langue : c'est l'identifiant que l'éditeur expose, on ne le fabrique pas.
    expect(j!.externalId).toBe(String(jobs[0].jobSeqNo));
    expect(j!.externalId).toMatch(/^HUBOGLOBAL\d+/);
  });

  it('reprend titre, pays et date sans les inventer', () => {
    const j = parseCareerConnectJob(jobs[0], 'https://careers.hugoboss.com', { localePath: 'global/en' })!;
    expect(j.title).toBe(jobs[0].title);
    expect(j.country).toBeTruthy();
    expect(j.url).toContain('careers.hugoboss.com');
  });

  it('l\'URL publique porte le PRÉFIXE DE LOCALE — sans lui, le site redirige vers l\'accueil', () => {
    // Mesuré sur 19 offres Hugo Boss : `/job/<id>/<slug>` rend HTTP 200 mais redirige silencieusement vers
    // `/global/en`. Un « 200 » n'est pas une preuve : la page doit porter l'identifiant de l'offre.
    // Vérifié : `/global/en/job/144427/x` la porte, `/job/HUBOGLOBAL…` non.
    const j = parseCareerConnectJob(jobs[0], 'https://careers.hugoboss.com', { localePath: 'global/en' })!;
    expect(j.url).toContain('/global/en/job/');
    expect(j.url).toContain(String(jobs[0].jobId));
  });

  it('sans locale déclarée, l\'URL n\'est PAS fabriquée : une destination fausse est pire qu\'absente', () => {
    const j = parseCareerConnectJob(jobs[0], 'https://careers.hugoboss.com')!;
    expect(j.url).toBe('');
  });

  it('REFUSE une entrée sans identifiant — jamais d\'offre sans identité', () => {
    expect(parseCareerConnectJob({ title: 'Sans id' } as any, 'https://x.com')).toBeNull();
    expect(parseCareerConnectJob({ jobSeqNo: 'X1' } as any, 'https://x.com')).toBeNull();
  });

  it('les trois offres de la fixture ont des identifiants distincts', () => {
    const ids = jobs.map((j) => parseCareerConnectJob(j, 'https://careers.hugoboss.com')?.externalId);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every(Boolean)).toBe(true);
  });
});
