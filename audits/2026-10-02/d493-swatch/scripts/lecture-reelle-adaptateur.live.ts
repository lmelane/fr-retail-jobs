/**
 * LE VRAI CODE DE L'ADAPTATEUR CONTRE LE VRAI LISTING (D-493), fiches exceptées.
 *
 * `fetchSwatchGroupJobs` est exécuté tel quel ; seul `fetchText` est remplacé :
 *  - une URL de listing part réellement sur www.swatchgroup.com (identité `CatwalksBot`, 2,5 s entre deux requêtes) ;
 *  - une URL de fiche n'est PAS demandée : une fiche synthétique la remplace (331 requêtes de politesse épargnées ; le
 *    lecteur de fiche est inchangé par ce lot et couvert par `swatchgroup.test.ts`).
 * Écrit `../lecture-reelle-adaptateur.json`.
 *
 * Lancer depuis `apps/aggregator` :
 *   npx vitest run --config ../../audits/2026-10-02/d493-swatch/scripts/vitest.live.config.mts
 */
import { writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

vi.mock('../../../../apps/aggregator/src/lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchText } from '../../../../apps/aggregator/src/lib/http.js';
import { fetchSwatchGroupJobs } from '../../../../apps/aggregator/src/ats/adapters/swatchgroup.js';

const UA = 'CatwalksBot/1.0 (+https://catwalks.io/bot)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

it('lecture réelle du listing par l\'adaptateur', async () => {
  const requests: Array<{ url: string; at: string; status: number; cdn: string | null }> = [];
  vi.mocked(fetchText).mockImplementation(async (url: string) => {
    if (!url.includes('/job-finder')) {
      const id = /\/job\/(\d+)$/.exec(url)?.[1];
      return `<html><body><h1>Offre ${id}</h1><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: `Offre ${id}`, datePosted: '2026-10-01', description: 'Fiche synthétique : non demandée au site.' })}</script></body></html>`;
    }
    if (requests.length) await sleep(2500);
    const at = new Date().toISOString();
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7' }, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    const body = await res.text();
    requests.push({ url, at, status: res.status, cdn: /cdn-cache; desc=([A-Z_]+)/.exec(res.headers.get('server-timing') ?? '')?.[1] ?? null });
    if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
    return body;
  });
  const r = await fetchSwatchGroupJobs({ origin: 'https://www.swatchgroup.com', lang: 'fr' });
  const summary = {
    startedAt: requests[0]?.at, endedAt: requests.at(-1)?.at, listingRequests: requests.length,
    statuses: [...new Set(requests.map((q) => q.status))],
    cdn: requests.reduce<Record<string, number>>((acc, q) => ({ ...acc, [q.cdn ?? 'null']: (acc[q.cdn ?? 'null'] ?? 0) + 1 }), {}),
    complete: r.complete, declaredTotal: r.declaredTotal, jobs: r.jobs.length, truncated: r.truncated,
    termination: r.enumeration?.termination, issues: r.enumeration?.issues, rawCount: r.enumeration?.rawCount, scopes: r.enumeration?.scopes,
    ids: r.jobs.map((j) => Number(j.externalId)).sort((a, b) => a - b),
    requests,
  };
  writeFileSync(new URL('../lecture-reelle-adaptateur.json', import.meta.url), JSON.stringify(summary, null, 1));
  const { ids: _ids, requests: _requests, ...head } = summary;
  console.log(JSON.stringify(head, null, 1));
  expect(requests.length).toBeGreaterThan(0);
}, 600_000);
