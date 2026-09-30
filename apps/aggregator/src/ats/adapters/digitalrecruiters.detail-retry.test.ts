import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchJson, fetchText } from '../../lib/http.js';
import { fetchDigitalRecruitersJobs } from './digitalrecruiters.js';

/*
 * Réponses réelles de Monoprix, corps archivés en production (le SHA-256 de chaque fichier est la clé du RawBlob) :
 *  - la page 4 de l'API de liste du 29/09/2026 à 17:01 (lot 3677b0e4), qui liste l'annonce 4438631 ;
 *  - la fiche de cette annonce le même jour à 17:02:01 : HTTP 404 « Not found » (séquence 388) ;
 *  - la même fiche la veille, 28/09 à 17:44 (lot 4cce4cbd, séquence 395) : JSON-LD, « Groupe MONOPRIX ».
 * Le 29/09, sans relecture, l'offre est sortie sans description ni employeur, a été refusée pour identité
 * (PORTAL_OWNER_NOT_CERTIFIED) et a fait passer monoprix en DEGRADED ; elle était en ligne le soir même. Les deux
 * autres 404 de fiche DigitalRecruiters mesurés depuis le 23/09 (Monoprix 25/09, Lacoste 28/09) répondaient 200 deux
 * minutes plus tard (`scripts/ops/mesures/fiches-en-echec.mts`).
 */
const fixture = (name: string) => gunzipSync(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url))).toString('utf8');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const listingText = fixture('digitalrecruiters-monoprix-liste-p4-20260929.json.gz');
const notFound = fixture('digitalrecruiters-monoprix-4438631-404-20260929.json.gz');
const detail = fixture('digitalrecruiters-monoprix-4438631-fiche-20260928.html.gz');
const listing = JSON.parse(listingText) as { count: number; items: Array<{ job_ad_id: number; url: string }> };
const TARGET = '4438631';
const TARGET_URL = 'https://recrutement.monoprix.fr/fr/annonce/4438631-employee-employe-de-rayon-textile-92600-asnieres-sur-seine';
/** La configuration du registre, telle quelle ; seul le délai de relecture est raccourci pour le test. */
const config = { domainName: 'recrutement.monoprix.fr', employerFromJobPosting: true, detailRetryDelayMs: 0 };

/**
 * L'API sert la page 4 réelle, ses 100 diffusions verbatim ; seul son compteur (741) est ramené à la page, pour que
 * le test porte sur l'étape des fiches et non sur la pagination. Chaque fiche répond, lecture après lecture, ce que
 * `plan(url)` prévoit : `404` lève comme le transport (statut définitif, jamais relu par lui), `fiche` rend la fiche
 * archivée de 4438631, `vide` une page sans JobPosting (les 99 autres, dont les fiches ne sont pas archivées ici).
 */
function serve(plan: (url: string) => Array<'404' | 'fiche' | 'vide'>) {
  vi.mocked(fetchJson).mockResolvedValueOnce({ ...listing, count: listing.items.length });
  const calls = new Map<string, number>();
  vi.mocked(fetchText).mockImplementation(async (url: string) => {
    const n = calls.get(url) ?? 0; calls.set(url, n + 1);
    const steps = plan(url);
    const answer = steps[Math.min(n, steps.length - 1)];
    if (answer === '404') throw new Error(`HTTP 404 for ${url}`);
    return answer === 'fiche' ? detail : '<html><body></body></html>';
  });
  return calls;
}
const target = (jobs: Array<{ externalId: string }>) => jobs.find(job => job.externalId === TARGET) as
  { description?: string; company?: string; employerEvidence?: { rawName: string; rule: string } } | undefined;
beforeEach(() => vi.resetAllMocks());

describe('DigitalRecruiters : une fiche en échec est relue une fois, plus tard (Monoprix, 29/09/2026)', () => {
  it('prémisse : réponses archivées ; la fiche lue porte description et employeur ; sans relecture, l\'offre du 29/09 sort sans l\'un ni l\'autre', async () => {
    expect(sha256(listingText)).toBe('a133074f8f83bacd057673b222fbef78b02acc53fd059613c7a877eb6530422c');
    expect(sha256(notFound)).toBe('4092dc3d6467a0ec3a7ede3382e7aa92c7b88098ef3d086694e8dbcc04d69c0c');
    expect(sha256(detail)).toBe('8673749a4d54aa6a7574ba056f551fa522477990f3884ab8905f304e7f5e1ead');
    expect(JSON.parse(notFound)).toMatchObject({ statusCode: 404, message: 'Not found' });
    expect(listing.count).toBe(741);
    expect(listing.items.filter(item => String(item.job_ad_id) === TARGET)).toHaveLength(1);
    // La fiche du 28/09, lue seule : c'est ce que l'offre porte quand sa fiche répond.
    const read = serve(url => url === TARGET_URL ? ['fiche'] : ['vide']);
    const ok = target((await fetchDigitalRecruitersJobs(config)).jobs);
    expect(read.get(TARGET_URL)).toBe(1);
    expect(ok?.description?.length).toBeGreaterThan(500);
    expect(ok).toMatchObject({ company: 'Groupe MONOPRIX', employerEvidence: { rawName: 'Groupe MONOPRIX', rule: 'EXPLICIT_JOBPOSTING_EMPLOYER' } });
    // Ce que le 29/09 a produit : fiche en 404, l'entrée de liste seule, sans description ni employeur.
    vi.resetAllMocks();
    serve(url => url === TARGET_URL ? ['404'] : ['vide']);
    const lost = target((await fetchDigitalRecruitersJobs(config)).jobs);
    expect(lost).toBeDefined();
    expect(lost?.description).toBeUndefined();
    expect(lost?.company).toBeUndefined();
  });

  it('une fiche toujours en échec après la relecture : lue deux fois, jamais plus, l\'entrée de liste reste', async () => {
    const calls = serve(url => url === TARGET_URL ? ['404'] : ['vide']);
    const job = target((await fetchDigitalRecruitersJobs(config)).jobs);
    expect(calls.get(TARGET_URL)).toBe(2);
    expect(job?.description).toBeUndefined();
  });

  it('un 404 passager : la fiche est relue après le délai, l\'offre garde sa description et « Groupe MONOPRIX »', async () => {
    const calls = serve(url => url === TARGET_URL ? ['404', 'fiche'] : ['vide']);
    const job = target((await fetchDigitalRecruitersJobs(config)).jobs);
    expect(calls.get(TARGET_URL)).toBe(2);
    expect(job?.description?.length).toBeGreaterThan(500);
    expect(job).toMatchObject({ company: 'Groupe MONOPRIX', employerEvidence: { rawName: 'Groupe MONOPRIX', rule: 'EXPLICIT_JOBPOSTING_EMPLOYER' } });
    // Les fiches qui ont répondu ne sont pas relues.
    expect([...calls.entries()].filter(([url, n]) => url !== TARGET_URL && n !== 1)).toEqual([]);
  });

  it('au-delà de la borne (plus de 5 fiches en échec sur 100) : aucune relecture, le RUN n\'est pas allongé', async () => {
    const failing = new Set(listing.items.slice(0, 6).map(item => `https://recrutement.monoprix.fr/fr/annonce/${item.url}`));
    // Prémisse : six adresses distinctes, toutes des fiches de la liste.
    expect(failing.size).toBe(6);
    const calls = serve(url => failing.has(url) ? ['404', 'fiche'] : ['vide']);
    await fetchDigitalRecruitersJobs(config);
    expect([...failing].map(url => calls.get(url))).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('toutes les fiches en échec (panne entière) : aucune relecture', async () => {
    const calls = serve(() => ['404', 'fiche']);
    const result = await fetchDigitalRecruitersJobs(config);
    expect(result.jobs.length).toBeGreaterThan(1);
    expect([...calls.values()].every(n => n === 1)).toBe(true);
  });
});
