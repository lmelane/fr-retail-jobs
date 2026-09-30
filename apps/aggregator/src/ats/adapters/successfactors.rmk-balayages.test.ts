import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { fetchRmkV2Jobs } from './successfactors.js';

/*
 * Douglas (jobs.douglas.group, SAP RMK v2), langue de_DE : les réponses réelles de l'API de liste, archivées en
 * production, verbatim, avec la clé de leur RawBlob (le SHA-256 du corps, vérifié ci-dessous). Chaque RUN a deux
 * captures de la source, à deux minutes d'écart : celle de la requalification d'accès, puis celle de l'ingestion.
 *  - RUN du 28/09 : 82fde906 (17:12, 308/308 au 5e balayage) puis fcc05a25 (17:14, ingestion, 305/308 après 4
 *    balayages ; le 4e n'ajoute rien, la lecture s'arrête, douglas-sf passe en DEGRADED « troncature : 311 »).
 *  - RUN du 27/09 : 466db27f (16:42, 313/313 au 3e balayage) puis c8bd937f (16:43, ingestion, 308/313 après 3
 *    balayages ; le 3e n'ajoute rien — DEGRADED « troncature : 313 »).
 * Fixtures : `scripts/ops/mesures/rmk-balayages.mts --runs=<RUN> --exporter=<fichier>`.
 *
 * Le rejeu sert, dans l'ordre, les balayages de la capture d'ingestion, puis ceux de l'autre capture du même RUN :
 * des réponses réelles du même listing, au même total, quelques minutes plus tôt. Chaque requête de l'adaptateur
 * doit demander exactement la page que la réponse servie a répondue — sinon le rejeu échoue.
 */
type Archived = { capture: string; sequence: number; locale: string; page: number; sha256: string; body: string };
type RmkPage = { totalJobs: number; jobSearchResult?: Array<{ response?: { id?: string | number } }> };
const load = (day: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./__fixtures__/successfactors-rmk-douglas-de-${day}.json.gz`, import.meta.url))).toString('utf8')) as Archived[];
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** Les balayages d'une capture, dans l'ordre des séquences : une page 0 en ouvre un. */
const sweepsOf = (rows: Archived[], capture: string) => {
  const sweeps: Archived[][] = [];
  for (const row of rows.filter(r => r.capture.startsWith(capture)).sort((a, b) => a.sequence - b.sequence)) {
    if (row.page === 0) sweeps.push([]);
    sweeps.at(-1)!.push(row);
  }
  return sweeps;
};
const idsOf = (rows: Archived[]) => new Set(rows.flatMap(r => ((JSON.parse(r.body) as RmkPage).jobSearchResult ?? []).map(x => String(x.response?.id))));

/** Sert les réponses dans l'ordre ; refuse une requête qui ne demande pas la page archivée à cette position. */
function replay(queue: Archived[]) {
  let served = 0;
  vi.mocked(fetchJson).mockImplementation(async (_url: string, init?: RequestInit) => {
    const asked = JSON.parse(String(init?.body)) as { locale: string; pageNumber: number };
    const next = queue[served];
    if (!next) throw new Error(`rejeu épuisé à la requête ${served + 1}`);
    if (asked.locale !== next.locale || asked.pageNumber !== next.page) throw new Error(`rejeu désaligné : ${asked.locale}/${asked.pageNumber} demandé, ${next.locale}/${next.page} archivé`);
    served++;
    return JSON.parse(next.body);
  });
  return () => served;
}
const run = () => fetchRmkV2Jobs('https://jobs.douglas.group', ['de_DE'], 'sfstd_marketingBrand_obj');
beforeEach(() => vi.resetAllMocks());

describe.each([
  { day: '20260928', ingestion: 'fcc05a25', other: '82fde906', total: 308, stoppedAt: 305, sweeps: 4 },
  { day: '20260927', ingestion: 'c8bd937f', other: '466db27f', total: 313, stoppedAt: 308, sweeps: 3 },
])('SAP RMK v2 — Douglas de_DE, RUN du $day : un balayage qui n\'ajoute rien n\'est pas la fin', ({ day, ingestion, other, total, stoppedAt, sweeps }) => {
  const rows = load(day);
  const own = sweepsOf(rows, ingestion);
  const later = sweepsOf(rows, other);

  it('prémisse : réponses archivées intactes ; l\'ingestion s\'est arrêtée sous le total sur un balayage sans nouvel identifiant ; les manquants étaient publiés', () => {
    for (const row of rows) expect(sha256(row.body)).toBe(row.sha256);
    expect(rows.every(r => r.locale === 'de_DE' && (JSON.parse(r.body) as RmkPage).totalJobs === total)).toBe(true);
    expect(own).toHaveLength(sweeps);
    const before = idsOf(own.slice(0, -1).flat()), after = idsOf(own.flat());
    expect(after.size).toBe(stoppedAt);
    expect(after.size).toBe(before.size); // le dernier balayage n'ajoute rien : c'est lui qui arrêtait la lecture
    const missing = [...idsOf(later.flat())].filter(id => !after.has(id));
    expect(missing.length).toBe(total - stoppedAt); // les identifiants manquants sont servis par le même listing
    expect(idsOf(rows).size).toBe(total);
  });

  it('la lecture continue au-delà du balayage stérile et atteint le total déclaré', async () => {
    const served = replay([...own.flat(), ...later.flat()]);
    const r = await run();
    expect(r.enumeration?.scopes).toEqual([expect.objectContaining({ scope: 'de_DE', declaredTotal: total, uniqueIds: total, complete: true })]);
    expect(r.complete).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.jobs).toHaveLength(total);
    expect(r.enumeration?.issues).toEqual([]);
    expect(served()).toBeGreaterThan(own.flat().length);
  });
});

describe('SAP RMK v2 — la relecture reste bornée', () => {
  it('un listing qui ne rend jamais le total : 24 balayages au plus, langue non prouvée', async () => {
    const own = sweepsOf(load('20260928'), 'fcc05a25');
    const cycle = Array.from({ length: 6 }, () => own.flat()).flat(); // les 4 balayages réels, répétés : 305 à jamais
    const served = replay(cycle);
    const r = await run();
    expect(served()).toBe(24 * own[0].length);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.scopes?.[0]).toMatchObject({ declaredTotal: 308, uniqueIds: 305, complete: false });
    expect(r.enumeration?.issues).toContain('LOCALE_ENUMERATION_UNPROVEN:de_DE');
  });
});
