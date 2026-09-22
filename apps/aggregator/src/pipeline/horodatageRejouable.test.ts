import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { captureExtraction, replayExtraction } from '../capture/batch.js';
import { compareExtractionResult } from '../capture/manifest.js';
import { captureObservedAt } from '../capture/context.js';
import { fetchJson } from '../lib/http.js';
import type { AdapterResult } from '../types.js';

/**
 * MÊME CAPTURE LOGIQUE → MÊMES MÉTADONNÉES AU REJEU.
 *
 * ── POURQUOI CE TÉMOIN EXISTE ──────────────────────────────────────────────────────────────────
 *
 * Un garde statique cherchant `new Date()` dans les sources a été écrit d'abord. Il est passé au
 * VERT alors que le défaut était toujours là : il gardait la FORME du code, pas le comportement.
 * Seul un rejeu réel l'a montré. Ce témoin-ci exerce donc le trajet complet —
 *
 *     capture → pageEvidence → manifeste → rejeu → comparaison des métadonnées
 *
 * — et exige `matchesRecordedMetadata`. Il tient sur un cas MULTIPAGE, parce que c'est là que le
 * défaut se voyait : chaque page portait l'heure de sa propre lecture, donc treize valeurs
 * distinctes chez `sezane`, irreproductibles par construction.
 *
 * ── LA SÉMANTIQUE QU'IL PROTÈGE (arbitrage du 2026-09-21, option C) ────────────────────────────
 *
 *   `pageEvidence.checkedAt` → référence temporelle STABLE de l'extraction (`batch.startedAt`),
 *                              reposée à l'identique par `captureExtraction` et `replayExtraction`.
 *   `RawCapture.capturedAt`  → heure PRÉCISE de réception de chaque réponse native.
 *
 * Les deux ne doivent pas converger : `checkedAt` n'est pas une copie du transport. Voir le
 * commentaire de `captureObservedAt` (`capture/context.ts`).
 */
const db = new PrismaClient();
const PAGES = 3;
const origine = 'https://horodatage.example.com';

/**
 * Un adaptateur multipage RÉDUIT À L'ESSENTIEL : il lit N pages et construit sa preuve comme les
 * vrais adaptateurs. C'est `checkedAt` qui est sous test, pas la logique de pagination.
 */
async function collecteMultipage(): Promise<AdapterResult> {
  const pageEvidence: NonNullable<AdapterResult['enumeration']>['pageEvidence'] = [];
  const jobs: AdapterResult['jobs'] = [];
  for (let page = 0; page < PAGES; page++) {
    const url = `${origine}/jobs?page=${page}`;
    const charge = await fetchJson<{ ids: string[] }>(url);
    const ids = charge.ids;
    jobs.push(...ids.map(id => ({ externalId: id, title: `Conseiller ${id}`, url: `${origine}/jobs/${id}`, raw: { id } })));
    pageEvidence.push({
      url,
      // LE CHAMP SOUS TEST : l'instant logique du lot, pas l'heure courante.
      checkedAt: captureObservedAt().toISOString(),
      sha256: createHash('sha256').update(JSON.stringify(charge)).digest('hex'),
      offset: page * 2, pagination: null, ids, canonicalIds: ids,
      publisherCounter: `page-${page}`, componentCounters: [],
    });
  }
  return { jobs, complete: true, truncated: false,
    enumeration: { method: 'fixture', endpoint: origine, pages: PAGES, rawCount: jobs.length,
      termination: 'exhausted', pageEvidence } };
}

/** Sert une charge utile DISTINCTE par page : deux pages identiques masqueraient l'écart. */
function servirLesPages() {
  vi.stubGlobal('fetch', vi.fn(async (entree: string | URL) => {
    const page = Number(new URL(String(entree)).searchParams.get('page') ?? 0);
    return new Response(JSON.stringify({ ids: [`${page}a`, `${page}b`] }),
      { headers: { 'content-type': 'application/json' } });
  }));
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => db.$disconnect());

describe('horodatage rejouable des preuves de page', () => {
  it('le rejeu d\'une capture NEUVE retrouve les mêmes métadonnées', async () => {
    servirLesPages();
    const sourceKey = `horodatage-${randomUUID()}`;
    const live = await captureExtraction(db, sourceKey, {}, undefined, () => collecteMultipage());
    const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey } });

    /*
     * PRÉMISSE — sans elle, ce témoin pourrait passer au vert sur un cas monopage qui n'exerce
     * pas le défaut. Le défaut mesuré tenait précisément à N pages lues à N instants distincts.
     */
    expect(live.enumeration?.pageEvidence).toHaveLength(PAGES);
    expect(new Set(live.enumeration!.pageEvidence!.map(p => p.sha256)).size).toBe(PAGES);

    servirLesPages();
    const rejoue = await replayExtraction(db, batch.id, () => collecteMultipage());
    const comparaison = await compareExtractionResult(db, batch.id, rejoue);

    expect(comparaison.matchesRecordedMetadata).toBe(true);
    expect(comparaison.exact).toBe(true);
  });

  it('les preuves d\'un même lot partagent la référence stable, distincte de l\'heure courante', async () => {
    /*
     * L'INVARIANT DE L'OPTION C, énoncé positivement : un lot logique porte UNE référence. C'est
     * ce qui rend le manifeste rejouable — et ce que `new Date()` cassait, en horodatant chaque
     * page à l'instant de sa lecture.
     */
    servirLesPages();
    const sourceKey = `horodatage-${randomUUID()}`;
    const avant = Date.now();
    const live = await captureExtraction(db, sourceKey, {}, undefined, () => collecteMultipage());
    const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey } });

    const horodatages = new Set(live.enumeration!.pageEvidence!.map(p => p.checkedAt));
    expect(horodatages.size).toBe(1);
    expect([...horodatages][0]).toBe(batch.startedAt.toISOString());

    /*
     * Et cette référence n'est PAS « maintenant » : elle vient du lot. Le rejeu, qui s'exécutera
     * plus tard, la retrouvera donc à l'identique — ce qu'un `new Date()` ne pouvait pas faire.
     */
    expect(batch.startedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(batch.startedAt.getTime()).toBeGreaterThanOrEqual(avant - 1000);
  });
});
