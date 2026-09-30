import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { fetchWorkdayJobs } from './workday.js';

/**
 * D-482 (30/09/2026) — deux énumérations Workday réfutées par NOTRE lecture, rejouées sur les pages réelles archivées
 * (`scripts/ops/extraire-pages-workday.mts`, corps exacts, empreinte de chaque corps et du fichier vérifiée).
 *
 *  · Nordstrom, 29/09 : le total change pendant la lecture (1 329 → 1 328) ; la seconde passe entière le prouve.
 *  · Mango, 26/09 et 29/09 : deux lignes sans chemin au même contenu, à des rangs fixes, sont deux lignes annoncées.
 */
type Page = { sequence: number; offset: number; sha256: string; body: string };
type Posting = { externalPath?: string; bulletFields?: string[]; title?: string };
type Listing = { total?: number; jobPostings?: Posting[] };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function fixture(name: string, fileSha: string): Page[] {
  const gz = readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url));
  expect(sha(gz)).toBe(fileSha);
  const pages = JSON.parse(gunzipSync(gz).toString('utf8')) as Page[];
  for (const page of pages) expect(sha(page.body)).toBe(page.sha256);
  return pages;
}
const parse = (page: Page) => JSON.parse(page.body) as Listing;
const idOf = (job: Posting) => job.externalPath?.split('/').filter(Boolean).pop();
/** Sert chaque offset selon son rang de lecture : la n-ième lecture d'un offset rend `plan(offset, n)`. */
function serve(plan: (offset: number, read: number) => Listing) {
  const reads = new Map<number, number>();
  vi.mocked(fetchJson).mockImplementation(async (_url: string, init?: RequestInit) => {
    const { offset } = JSON.parse(String(init?.body)) as { offset: number };
    const read = reads.get(offset) ?? 0; reads.set(offset, read + 1);
    return plan(offset, read);
  });
  return reads;
}
beforeEach(() => vi.resetAllMocks());

describe('Nordstrom, 29/09/2026 — le total change pendant la lecture : une seconde passe entière', () => {
  const pages = () => fixture('workday-nordstrom-liste-20260929.json.gz', '6924661579b8ebf05a59ef22ca94ae952af8dd098f18b3217362823279c7be8e');
  const config = { tenant: 'nordstrom', site: 'nordstrom_careers', origin: 'https://nordstrom.wd501.myworkdayjobs.com', withDescriptions: false };

  it('prémisse : la page 0 annonce 1 329, les pages 0 à 1 320 servent 1 328 offres distinctes, la page 1 340 ressert la tête sous un total de 1 328', () => {
    const all = pages();
    expect(all).toHaveLength(68);
    expect(all.map((p) => p.offset)).toEqual(Array.from({ length: 68 }, (_, i) => i * 20));
    const board = all.slice(0, 67).map(parse);
    expect(board[0]!.total).toBe(1329);
    const rows = board.flatMap((p) => p.jobPostings ?? []);
    expect(rows).toHaveLength(1328);
    expect(rows.every((r) => r.externalPath)).toBe(true);
    expect(new Set(rows.map(idOf)).size).toBe(1328);
    const wrap = parse(all[67]!);
    expect(wrap.total).toBe(1328);
    expect((wrap.jobPostings ?? []).map(idOf)).toEqual((board[0]!.jobPostings ?? []).map(idOf));
  });

  it('la collecte réelle, puis une seconde passe sous le nouveau total : le tableau est prouvé, 1 328 offres', async () => {
    const all = pages();
    const byOffset = new Map(all.map((p) => [p.offset, parse(p)]));
    // Seconde passe : la page 0 est la tête que l'éditeur a réellement servie sous 1 328 (page 1 340), les suivantes
    // sont les pages réelles de la collecte — le tableau de 1 328 lignes qu'elle a lu.
    const reads = serve((offset, read) => read === 0 ? byOffset.get(offset)! : offset === 0 ? byOffset.get(1340)! : byOffset.get(offset)!);
    const r = await fetchWorkdayJobs(config);
    expect(r.complete).toBe(true);
    expect(r.declaredTotal).toBe(1328);
    expect(r.jobs).toHaveLength(1328);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['SOURCE_TOTAL_CHANGED', 'RECONCILED_BY_FRESH_PASS']));
    expect(r.enumeration?.issues).not.toContain('ENUMERATION_NOT_PROVEN');
    expect(r.enumeration?.termination).toBe('PUBLISHER_TOTAL_REACHED');
    // 68 pages de la collecte, 67 de la seconde passe ; aucune troisième.
    expect(fetchJson).toHaveBeenCalledTimes(135);
    expect(reads.get(0)).toBe(2); expect(reads.get(1320)).toBe(2); expect(reads.get(1340)).toBe(1);
    expect(r.enumeration?.pageEvidence?.filter((p) => p.url.includes('&pass=2'))).toHaveLength(67);
  });

  it('un second changement pendant la seconde passe reste NON prouvé, sans troisième passe', async () => {
    const byOffset = new Map(pages().map((p) => [p.offset, parse(p)]));
    serve((offset) => byOffset.get(offset)!);
    const r = await fetchWorkdayJobs(config);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['SOURCE_TOTAL_CHANGED', 'ENUMERATION_NOT_PROVEN']));
    expect(r.enumeration?.issues).not.toContain('RECONCILED_BY_FRESH_PASS');
    expect(fetchJson).toHaveBeenCalledTimes(136);
  });

  it("une offre retirée APRÈS avoir été lue fait sauter une offre vivante à la frontière : la seconde passe la retrouve, l'offre retirée reste un jour de plus", async () => {
    const posting = (id: number): Posting => ({ title: `Sales ${id}`, externalPath: `/job/Paris/Sales_${id}`, bulletFields: [`R-${id}`] });
    const before = Array.from({ length: 61 }, (_, i) => posting(i));
    const after = before.filter((_, i) => i !== 25);
    const slice = (list: Posting[], offset: number, total: number | undefined) =>
      ({ total, jobPostings: offset < list.length ? list.slice(offset, offset + 20) : list.slice(0, 20) });
    // Passe 1 : pages 0 et 20 lues avant le retrait de Sales_25, page 40 après ; la page 60 est au-delà de la fin.
    serve((offset, read) => {
      if (read === 0 && offset < 40) return slice(before, offset, offset === 0 ? 61 : 0);
      if (read === 0) return slice(after, offset, offset >= after.length ? after.length : 0);
      return slice(after, offset, offset === 0 ? 60 : 0);
    });
    const r = await fetchWorkdayJobs({ ...config, tenant: 't' });
    // Prémisse : la première passe a perdu Sales_40, passée de la page 40 à la page 20 déjà lue.
    const firstPass = r.enumeration?.pageEvidence?.filter((p) => !p.url.includes('&pass=')).flatMap((p) => p.ids ?? []);
    expect(firstPass).not.toContain('Sales_40');
    expect(r.complete).toBe(true);
    expect(r.declaredTotal).toBe(60);
    expect(r.jobs.map((j) => j.externalId)).toContain('Sales_40');
    expect(r.jobs.map((j) => j.externalId)).toContain('Sales_25');
    expect(r.jobs).toHaveLength(61);
  });

  it('une ligne sans chemin servie par les deux passes reste UN témoin de rejet, et compte dans la preuve de la seconde', async () => {
    const posting = (id: number): Posting => ({ title: `Sales ${id}`, externalPath: `/job/Paris/Sales_${id}`, bulletFields: [`R-${id}`] });
    const head = Array.from({ length: 20 }, (_, i) => posting(i));
    const X: Posting = { bulletFields: ['Fix-Term'] };
    // Passe 1 : 23 annoncées, 22 servies (tête, puis X et Sales_20), la page 40 ressert la tête sous 22 ; passe 2 : 22.
    serve((offset, read) => offset === 0 ? { total: read === 0 ? 23 : 22, jobPostings: head }
      : offset === 20 ? { total: 0, jobPostings: [X, posting(20)] } : { total: 22, jobPostings: head });
    const r = await fetchWorkdayJobs({ ...config, tenant: 't' });
    expect(r.enumeration?.issues).toContain('SOURCE_TOTAL_CHANGED');
    expect(r.complete).toBe(true);
    expect(r.jobs).toHaveLength(21);
    expect(r.rejectedRows).toEqual([{ reason: 'ROW_WITHOUT_EXTERNAL_PATH', raw: X }]);
  });
});

describe('Mango — deux lignes sans chemin au même contenu, à des rangs fixes, sont deux lignes annoncées', () => {
  const config = { tenant: 'mango', site: 'Mango_Work_Your_Passion', origin: 'https://mango.wd3.myworkdayjobs.com', withDescriptions: false };
  const FIX_TERM = JSON.stringify({ bulletFields: ['Fix-Term'] });
  const ranksOf = (list: Page[]) => list.flatMap((p) => (parse(p).jobPostings ?? []).map((job, i) => ({ rank: p.offset + i, job })))
    .filter(({ job }) => !job.externalPath).map(({ rank, job }) => ({ rank, content: JSON.stringify(job) }));

  it('prémisse, 29/09 : 1 664 annoncées, 1 664 lignes servies sans répétition, 1 662 offres, « Fix-Term » aux rangs 307 et 326', () => {
    const all = fixture('workday-mango-liste-20260929.json.gz', 'bd8ef6b2c66bd845241faf02127ac551e20399320022c004398e6891baadfeb8');
    expect(all).toHaveLength(84);
    expect(parse(all[0]!).total).toBe(1664);
    const rows = all.flatMap((p) => parse(p).jobPostings ?? []);
    expect(rows).toHaveLength(1664);
    const ids = rows.map(idOf).filter(Boolean);
    expect(ids).toHaveLength(1662); expect(new Set(ids).size).toBe(1662);
    expect(ranksOf(all)).toEqual([{ rank: 307, content: FIX_TERM }, { rank: 326, content: FIX_TERM }]);
  });

  it('29/09 : les pages 300 et 320 relues gardent « Fix-Term » à ses deux rangs — tableau prouvé (1 662 + 2 = 1 664)', async () => {
    const all = fixture('workday-mango-liste-20260929.json.gz', 'bd8ef6b2c66bd845241faf02127ac551e20399320022c004398e6891baadfeb8');
    const byOffset = new Map(all.map((p) => [p.offset, parse(p)]));
    const reads = serve((offset) => byOffset.get(offset)!);
    const r = await fetchWorkdayJobs(config);
    expect(r.complete).toBe(true);
    expect(r.declaredTotal).toBe(1664);
    expect(r.jobs).toHaveLength(1662);
    expect(r.rejectedRows).toEqual([{ reason: 'ROW_WITHOUT_EXTERNAL_PATH', raw: { bulletFields: ['Fix-Term'] } }, { reason: 'ROW_WITHOUT_EXTERNAL_PATH', raw: { bulletFields: ['Fix-Term'] } }]);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['ROWS_WITHOUT_EXTERNAL_PATH', 'PATHLESS_ROWS_DISTINCT_BY_RANK']));
    expect(r.enumeration?.issues).not.toContain('ENUMERATION_NOT_PROVEN');
    expect(fetchJson).toHaveBeenCalledTimes(86);
    expect([...reads].filter(([, n]) => n > 1).map(([offset]) => offset).sort((a, b) => a - b)).toEqual([300, 320]);
    // Aucune ligne n'est inventée : l'absence reste inattestable tant qu'une ligne n'a pas d'identifiant.
    expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(false);
  });

  it('26/09, entièrement réel : la collecte de 17:21 et la relecture INDÉPENDANTE de 17:27 servent « Fix-Term » aux mêmes rangs 328 et 557', async () => {
    const first = fixture('workday-mango-liste-20260926-1721.json.gz', '0e17e6caf5fd0a7930528e0f24fc66574c15a0070cea5f2df5c9be19cecc926a');
    const second = fixture('workday-mango-relecture-20260926-1727.json.gz', '5ec7beacbde4916d73b12957670279b321277c40f01263abffec62fe6f382334');
    // Prémisse : 1 653 annoncées, 1 651 offres, les deux lignes aux rangs 328 et 557 dans chacune des deux captures.
    expect(parse(first[0]!).total).toBe(1653);
    expect(first.flatMap((p) => parse(p).jobPostings ?? []).filter((j) => j.externalPath)).toHaveLength(1651);
    expect(ranksOf(first)).toEqual([{ rank: 328, content: FIX_TERM }, { rank: 557, content: FIX_TERM }]);
    expect(second.map((p) => p.offset)).toEqual([320, 540]);
    expect(ranksOf(second)).toEqual(ranksOf(first));
    const byOffset = new Map(first.map((p) => [p.offset, parse(p)]));
    const reread = new Map(second.map((p) => [p.offset, parse(p)]));
    serve((offset, read) => read === 0 ? byOffset.get(offset)! : reread.get(offset)!);
    const r = await fetchWorkdayJobs(config);
    expect(r.complete).toBe(true);
    expect(r.declaredTotal).toBe(1653);
    expect(r.jobs).toHaveLength(1651);
    expect(r.enumeration?.issues).not.toContain('ENUMERATION_NOT_PROVEN');
  });

  it("tri instable sans identifiant répété : la ligne servie deux fois ne garde pas ses rangs, l'offre sautée reste manquante — NON prouvé", async () => {
    const posting = (id: number): Posting => ({ title: `Sales ${id}`, externalPath: `/job/Paris/Sales_${id}`, bulletFields: [`R-${id}`] });
    const X: Posting = { bulletFields: ['Fix-Term'] };
    // 60 lignes : Sales_0…59 sauf Sales_5, et X au rang 5. Après la lecture des pages 0 et 20, X passe au rang 45 :
    // les lignes 6 à 45 remontent d'un rang, Sales_40 tombe en page 20 déjà lue et n'est jamais servie.
    const before: Posting[] = Array.from({ length: 60 }, (_, i) => (i === 5 ? X : posting(i)));
    const after: Posting[] = [...before.slice(0, 5), ...before.slice(6, 46), X, ...before.slice(46)];
    serve((offset, read) => {
      const list = read === 0 && offset < 40 ? before : after;
      return { total: offset === 0 ? 60 : 0, jobPostings: list.slice(offset, offset + 20) };
    });
    const r = await fetchWorkdayJobs({ ...config, tenant: 't' });
    // Prémisse : X a été servie aux rangs 5 et 45, aucune offre répétée, Sales_40 jamais servie, 60 lignes lues.
    expect(r.enumeration?.rawCount).toBe(60);
    expect(r.enumeration?.issues).not.toContain('REPEATED_IDS_ACROSS_PAGES');
    expect(r.rejectedRows).toHaveLength(2);
    expect(r.jobs.map((j) => j.externalId)).not.toContain('Sales_40');
    // Compter X par occurrence donnerait 58 + 2 = 60 et prouverait à tort un tableau auquel manque Sales_40.
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['PATHLESS_ROW_RANK_UNSTABLE', 'ENUMERATION_NOT_PROVEN']));
  });
});
