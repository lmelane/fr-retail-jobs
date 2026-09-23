import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCareerConnectJob, careerConnectRequest, phenomDialect, enrichFromJobPosting } from './phenom.js';
import nativeEmployers from './fixtures/phenom-native-employers.json' with { type: 'json' };
import { recoverRetainedPublication } from '../../publication/recovery.js';

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
  it('preserves each native legal employer and reproduces it in offline recovery', () => {
    const origin = 'https://careers.hugoboss.com', localePath = 'global/en';
    expect(new Set(nativeEmployers.jobs.map(job => job.companyName)).size).toBe(3);
    for (const raw of nativeEmployers.jobs) {
      const job = parseCareerConnectJob(raw, origin, { localePath })!;
      expect(job.company).toBe(raw.companyName);
      expect(job.employerEvidence).toMatchObject({ rawName: raw.companyName, path: 'companyName' });
      expect(recoverRetainedPublication('phenom', raw, { externalId: job.externalId, url: job.url,
        observedAt: new Date('2026-09-23'), config: { origin, localePath, dialect: 'CAREER_CONNECT_WIDGETS' } }))
        .toMatchObject({ status: 'RECOVERABLE', job });
    }
    for (const companyName of [undefined, '', '  ', 123, { name: 'Other' }]) {
      expect(parseCareerConnectJob({ ...jobs[0], companyName }, origin, { localePath })!.company).toBeUndefined();
    }
  });
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


/**
 * LA DESCRIPTION COMPLÈTE — le teaser du listing n'en est pas une.
 *
 * Mesuré le 2026-09-14 : la description stockée avait une médiane de 313 caractères (Hugo Boss) et 287
 * (Skechers), plafonnée à ~418 — contre **4 619** pour `foot-locker-france`, sur la MÊME famille Phenom. Le
 * plafond signe une troncature d'API, pas des annonces courtes.
 *
 * La fiche publique porte un JSON-LD `JobPosting` — un standard public, observé, jamais un endpoint deviné :
 * 4 093 et 7 058 caractères de description, avec l'`identifier` qui permet de VÉRIFIER qu'on a lu la bonne
 * fiche. C'est la garde qui manquait au gabarit d'URL.
 */
describe('enrichissement par le JSON-LD de la fiche', () => {
  const page = (id: string, desc: string) => `<html><script type="application/ld+json">${JSON.stringify({
    '@type': 'JobPosting', title: 'T', description: desc,
    identifier: { '@type': 'PropertyValue', name: 'HUGO BOSS AG', value: id },
  })}</script></html>`;

  it('remplace le teaser par la description complète quand l\'identifiant CONCORDE', () => {
    const base = parseCareerConnectJob(jobs[0], 'https://careers.hugoboss.com', { localePath: 'global/en' })!;
    const long = 'Responsabilités détaillées. '.repeat(60);
    const out = enrichFromJobPosting(base, page(String(jobs[0].jobId), long), String(jobs[0].jobId));
    expect(out.description!.length).toBeGreaterThan(1000);
    expect(out.description).toContain('Responsabilités');
  });

  it('REFUSE la description d\'une AUTRE fiche — l\'identifiant doit concorder', () => {
    // Sans cette garde, une redirection silencieuse collerait la description d'une offre sur une autre.
    const base = parseCareerConnectJob(jobs[0], 'https://careers.hugoboss.com', { localePath: 'global/en' })!;
    const out = enrichFromJobPosting(base, page('999999', 'Description d\'une autre offre'), String(jobs[0].jobId));
    expect(out.description).toBe(base.description);
  });

  it('garde le teaser si la fiche ne porte AUCUN JSON-LD', () => {
    const base = parseCareerConnectJob(jobs[0], 'https://careers.hugoboss.com', { localePath: 'global/en' })!;
    const out = enrichFromJobPosting(base, '<html><body>rien</body></html>', String(jobs[0].jobId));
    expect(out.description).toBe(base.description);
  });

  it('retient l\'évidence de la fiche admise dans le RAW, comme DigitalRecruiters et Personio, pour que le lecteur la relise hors réseau', () => {
    // Lot F3b : le teaser seul ne dit pas ce que le collecteur a publié ; l'évidence (page, empreinte, JSON-LD) est retenue.
    const base = parseCareerConnectJob(jobs[0], 'https://careers.hugoboss.com', { localePath: 'global/en' })!;
    const long = 'Description de la fiche. '.repeat(60);
    // Prémisse : la fiche est plus riche que le teaser, l'enrichissement a donc lieu.
    expect(long.length).toBeGreaterThan(base.description!.length);
    const out = enrichFromJobPosting(base, page(String(jobs[0].jobId), long), String(jobs[0].jobId));
    expect(out.description).toBe(long.trim());
    expect(out.raw).toMatchObject({ jobSeqNo: jobs[0].jobSeqNo, postingEvidence: { pageUrl: base.url, jobPostingCount: 1, geographyConflict: false, employerFromJobPosting: false } });
    expect((out.raw as { postingEvidence: { htmlSha256: string } }).postingEvidence.htmlSha256).toMatch(/^[a-f0-9]{64}$/);
    // Une fiche refusée (identifiant discordant, aucun JSON-LD) ne laisse AUCUNE évidence : rien à relire, rien d'inventé.
    expect((enrichFromJobPosting(base, page('999999', 'autre'), String(jobs[0].jobId)).raw as Record<string, unknown>).postingEvidence).toBeUndefined();
    expect((enrichFromJobPosting(base, '<html></html>', String(jobs[0].jobId)).raw as Record<string, unknown>).postingEvidence).toBeUndefined();
  });

  it('ne remplace jamais par PLUS COURT, et ne retient alors aucune évidence : un teaser vaut mieux qu\'une régression', () => {
    const base = parseCareerConnectJob(jobs[0], 'https://careers.hugoboss.com', { localePath: 'global/en' })!;
    // Prémisse : le teaser est plus long que le texte de la fiche.
    expect(base.description!.length).toBeGreaterThan('court'.length);
    const out = enrichFromJobPosting(base, page(String(jobs[0].jobId), 'court'), String(jobs[0].jobId));
    expect(out.description).toBe(base.description);
    expect((out.raw as Record<string, unknown>).postingEvidence).toBeUndefined();
  });

  it('garde le teaser, sans évidence, quand la fiche se déclare à une AUTRE adresse que l\'offre : elle ne serait pas relisible', () => {
    const base = parseCareerConnectJob(jobs[0], 'https://careers.hugoboss.com', { localePath: 'global/en' })!;
    const text = 'Texte complet de la fiche. '.repeat(60);
    // Prémisse : la fiche est plus riche que le teaser ; seule son adresse décide.
    expect(text.length).toBeGreaterThan(base.description!.length);
    const elsewhere = `<html><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'T', description: text,
      url: 'https://careers.hugoboss.com/global/en/job/999999/ailleurs', identifier: { '@type': 'PropertyValue', value: String(jobs[0].jobId) } })}</script></html>`;
    const out = enrichFromJobPosting(base, elsewhere, String(jobs[0].jobId));
    expect(out.description).toBe(base.description);
    expect((out.raw as Record<string, unknown>).postingEvidence).toBeUndefined();
    const here = elsewhere.replace('https://careers.hugoboss.com/global/en/job/999999/ailleurs', base.url);
    expect(enrichFromJobPosting(base, here, String(jobs[0].jobId)).description).toBe(text.trim());
  });
});
