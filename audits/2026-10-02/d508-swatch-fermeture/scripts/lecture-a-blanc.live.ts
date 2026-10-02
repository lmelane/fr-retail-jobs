/**
 * D-508 §6 — LA LECTURE DU SITE POUR LE PASSAGE À BLANC DE LA FERMETURE AUTOMATIQUE (lecture seule, aucune base).
 *
 * Le code réel est exécuté : `fetchSwatchGroupJobs` (identifiants canoniques déclarés seulement si la preuve tient),
 * puis le contrat des identifiants (`normalizeAdapterResult`) et la preuve d'énumération que lit le refresh
 * (`enumerationEvidence`). Seul `fetchText` est remplacé :
 *  - une URL de listing part réellement sur www.swatchgroup.com (identité `CatwalksBot`, 2,5 s entre deux requêtes) ;
 *  - une fiche n'est PAS demandée (331 requêtes épargnées) : l'ensemble des offres absentes ne dépend que du listing.
 *    À la réouverture, une fiche illisible retire à la collecte son droit d'attester (aucune fermeture ce jour-là).
 * Écrit `../lecture-site.json`. Lancer depuis `apps/aggregator` :
 *   npx vitest run --config ../../audits/2026-10-02/d508-swatch-fermeture/scripts/vitest.live.config.mts
 */
import { writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

vi.mock('../../../../apps/aggregator/src/lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchText } from '../../../../apps/aggregator/src/lib/http.js';
import { fetchSwatchGroupJobs } from '../../../../apps/aggregator/src/ats/adapters/swatchgroup.js';
import { normalizeAdapterResult } from '../../../../apps/aggregator/src/ats/index.js';
import { enumerationEvidence } from '../../../../apps/aggregator/src/pipeline/refreshPlan.js';

const UA = 'CatwalksBot/1.0 (+https://catwalks.io/bot)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

it('lecture réelle du listing Swatch Group pour la liste à blanc', async () => {
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
  const r = normalizeAdapterResult(await fetchSwatchGroupJobs({ origin: 'https://www.swatchgroup.com', lang: 'fr' }));
  const evidence = enumerationEvidence('swatch-group', 'lecture-a-blanc', { enumeration: r.enumeration });
  const summary = {
    startedAt: requests[0]?.at, endedAt: requests.at(-1)?.at, listingRequests: requests.length,
    statuses: [...new Set(requests.map((q) => q.status))],
    cdn: requests.reduce<Record<string, number>>((acc, q) => ({ ...acc, [q.cdn ?? 'null']: (acc[q.cdn ?? 'null'] ?? 0) + 1 }), {}),
    complete: r.complete, declaredTotal: r.declaredTotal, jobs: r.jobs.length, termination: r.enumeration?.termination, issues: r.enumeration?.issues,
    canonicalContractDeclared: evidence.canonicalContractDeclared, canonicalContractBroken: evidence.canonicalContractBroken,
    canonicalSet: [...evidence.canonicalSet].sort((a, b) => Number(a) - Number(b)),
    requests,
  };
  writeFileSync(new URL('../lecture-site.json', import.meta.url), JSON.stringify(summary, null, 1));
  const { canonicalSet, requests: _r, ...head } = summary;
  console.log(JSON.stringify({ ...head, canonicalSet: canonicalSet.length }, null, 1));
  expect(requests.length).toBeGreaterThan(0);
}, 600_000);
