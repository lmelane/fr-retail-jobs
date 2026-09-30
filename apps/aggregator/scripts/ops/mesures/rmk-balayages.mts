/**
 * LES BALAYAGES RMK v2 (SAP SuccessFactors) D'UNE CAPTURE, LANGUE PAR LANGUE — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/mesures/rmk-balayages.mts --source=douglas-sf [--batch=<id>] [--runs=<runId,runId>] [--detail]
 *
 * L'adresse archivée ne dit pas la langue ni la page : elles sont dans le corps POST, dont seule l'empreinte est
 * archivée. Chaque requête est donc identifiée en recalculant l'empreinte du corps que l'adaptateur envoie
 * (`postRmkPage`) pour chaque langue et chaque page candidates. Pour chaque langue : le total déclaré à chaque
 * page, les balayages (une page 0 ouvre un balayage), l'union d'identifiants après chacun, et ce qui manque au
 * total. Sert à dire pourquoi une langue a été déclarée `LOCALE_ENUMERATION_UNPROVEN`. N'écrit rien, ne contacte
 * aucun éditeur.
 */
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../src/capture/store.js';
import { readRequestData } from '../../../src/capture/requestDataRead.js';
import { digestBytes } from '../../../src/lib/evidenceHash.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const source = arg('source') ?? 'douglas-sf';
const detail = process.argv.includes('--detail');
const LOCALES = ['de_DE', 'en_GB', 'en_US', 'fr_FR', 'nl_NL', 'it_IT', 'es_ES', 'pl_PL', 'pt_PT', 'de_AT', 'de_CH', 'fr_BE', 'nl_BE', 'cs_CZ',
  'sk_SK', 'hu_HU', 'ro_RO', 'bg_BG', 'hr_HR', 'sl_SI', 'lt_LT', 'lv_LV', 'et_EE', 'ja_JP', 'zh_CN', 'sv_SE', 'da_DK', 'fi_FI', 'no_NO', 'tr_TR'];
const body = (locale: string, page: number) => JSON.stringify({ locale, pageNumber: page, sortBy: 'date', keywords: '', location: '', facetFilters: {},
  brand: '', skills: [], categoryId: 0, alertId: '', rcmCandidateId: '' });
const byHash = new Map<string, { locale: string; page: number }>();
for (const locale of LOCALES) for (let page = 0; page < 300; page++) byHash.set(digestBytes(body(locale, page)), { locale, page });

const prisma = new PrismaClient({ log: [] });
try {
  const runs = arg('runs')?.split(',');
  const batches = arg('batch') ? [{ id: arg('batch')!, runId: null as string | null, startedAt: null as Date | null }]
    : await prisma.captureBatch.findMany({ where: { sourceKey: source, purpose: 'JOBS', ...(runs ? { runId: { in: runs } } : { startedAt: { gte: new Date('2026-09-24') } }) },
      orderBy: { startedAt: 'asc' }, select: { id: true, runId: true, startedAt: true } });
  const pools = new Map<string, { total: number; sweeps: Set<string>[] }>();
  // `--exporter=<fichier.json.gz> [--locale=de_DE]` : les réponses de la langue, dans l'ordre des captures et des
  // séquences, verbatim avec la clé du RawBlob — la fixture d'un témoin qui rejoue le listing réel.
  const exporter = arg('exporter');
  const exportLocale = arg('locale') ?? 'de_DE';
  const exported: Array<{ capture: string; sequence: number; locale: string; page: number; sha256: string; body: string }> = [];
  for (const batch of batches) {
    const rows = await prisma.rawCapture.findMany({ where: { batchId: batch.id, requestUrl: { contains: '/services/recruiting/v1/jobs' } }, orderBy: { sequence: 'asc' } });
    type Sweep = { pages: number; ids: Set<string>; totals: Set<number>; lastPageRows: number };
    const perLocale = new Map<string, { sweeps: Sweep[]; union: Set<string>; totals: number[] }>();
    let unknown = 0, failed = 0;
    for (const row of rows) {
      const data = await readRequestData(prisma, row);
      const key = data ? byHash.get(data.logical.bodyHash) : undefined;
      if (!key) { unknown++; continue; }
      if (!row.blobHash || row.status !== 200) { failed++; continue; }
      const text = (await readRawBlob(prisma, row.blobHash)).toString('utf8');
      if (exporter && key.locale === exportLocale) exported.push({ capture: batch.id, sequence: row.sequence, locale: key.locale, page: key.page, sha256: row.blobHash, body: text });
      const json = JSON.parse(text) as { totalJobs?: number; jobSearchResult?: Array<{ response?: { id?: string | number } }> };
      const entry = perLocale.get(key.locale) ?? { sweeps: [], union: new Set<string>(), totals: [] };
      perLocale.set(key.locale, entry);
      if (key.page === 0 || !entry.sweeps.length) entry.sweeps.push({ pages: 0, ids: new Set(), totals: new Set(), lastPageRows: 0 });
      const sweep = entry.sweeps.at(-1)!;
      const records = json.jobSearchResult ?? [];
      sweep.pages++; sweep.lastPageRows = records.length;
      if (json.totalJobs !== undefined) { sweep.totals.add(json.totalJobs); entry.totals.push(json.totalJobs); }
      for (const r of records) if (r.response?.id != null) { sweep.ids.add(String(r.response.id)); entry.union.add(String(r.response.id)); }
    }
    const locales = [...perLocale.entries()].map(([locale, e]) => {
      const cumulative: number[] = []; const acc = new Set<string>();
      for (const s of e.sweeps) { for (const id of s.ids) acc.add(id); cumulative.push(acc.size); }
      const total = e.totals[0];
      return { locale, total, totalsVus: [...new Set(e.totals)], balayages: e.sweeps.length, union: e.union.size, manque: total === undefined ? null : total - e.union.size,
        parBalayage: e.sweeps.map((s, i) => ({ pages: s.pages, ids: s.ids.size, unionCumulee: cumulative[i], derniereLigne: s.lastPageRows, totaux: [...s.totals] })) };
    });
    const resume = locales.map((l) => `${l.locale}:${l.union}/${l.total}${l.totalsVus.length > 1 ? `(totaux ${l.totalsVus.join('→')})` : ''} en ${l.balayages} bal.`).join(' ');
    // Fréquence de présence : pour chaque identifiant de la langue la plus lourde, dans combien de balayages COMPLETS
    // (dernière page courte atteinte) il apparaît. Un identifiant présent dans 1 balayage sur 4 n'est pas caché par
    // l'éditeur : il est tiré au sort par l'ordre instable.
    const lourde = [...perLocale.entries()].sort((a, b) => b[1].union.size - a[1].union.size)[0];
    const frequences = lourde ? (() => {
      const complets = lourde[1].sweeps.filter((s) => s.lastPageRows < 10);
      const compte = new Map<string, number>();
      for (const s of complets) for (const id of s.ids) compte.set(id, (compte.get(id) ?? 0) + 1);
      const histogramme: Record<string, number> = {};
      for (const n of compte.values()) histogramme[`${n}/${complets.length}`] = (histogramme[`${n}/${complets.length}`] ?? 0) + 1;
      const parBalayage = complets.map((s) => s.ids.size);
      return { locale: lourde[0], balayagesComplets: complets.length, idsParBalayage: parBalayage, histogramme,
        rares: [...compte.entries()].filter(([, n]) => n === 1).map(([id]) => id) };
    })() : null;
    console.log(JSON.stringify({ capture: batch.id.slice(0, 8), run: batch.runId?.slice(0, 8) ?? null, debut: batch.startedAt?.toISOString().slice(0, 16) ?? null,
      requetes: rows.length, nonIdentifiees: unknown, enEchec: failed, resume, frequences, ...(detail ? { locales } : {}) }));
    if (lourde && batch.runId) {
      const pool = pools.get(batch.runId) ?? { total: lourde[1].totals[0], sweeps: [] as Set<string>[] };
      if (pool.total === lourde[1].totals[0]) pool.sweeps.push(...lourde[1].sweeps.filter((s) => s.lastPageRows < 10).map((s) => s.ids));
      pools.set(batch.runId, pool);
    }
  }
  if (exporter) {
    writeFileSync(exporter, gzipSync(JSON.stringify(exported), { level: 9 }));
    console.log(JSON.stringify({ exporte: exporter, reponses: exported.length }));
  }
  // `--pool` : les balayages complets des deux captures d'un même RUN (même total, quelques minutes d'écart) sont
  // des tirages du même listing. Par tirage avec remise de k balayages parmi eux (graine fixe), la part des collectes
  // qui atteignent le total déclaré. C'est une estimation, pas une preuve : elle dit combien de balayages il faut.
  if (process.argv.includes('--pool')) {
    let seed = 20260930;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (const [runId, pool] of pools) {
      const union = new Set(pool.sweeps.flatMap((s) => [...s]));
      const estimation: Record<string, string> = {};
      for (const k of [2, 3, 4, 6, 8, 12, 16, 24]) {
        let atteint = 0; const essais = 2000;
        for (let t = 0; t < essais; t++) {
          const acc = new Set<string>();
          for (let i = 0; i < k; i++) for (const id of pool.sweeps[Math.floor(rand() * pool.sweeps.length)]) acc.add(id);
          if (acc.size >= pool.total) atteint++;
        }
        estimation[`k=${k}`] = `${(100 * atteint / essais).toFixed(1)} %`;
      }
      console.log(JSON.stringify({ pool: runId.slice(0, 8), total: pool.total, balayagesComplets: pool.sweeps.length, unionDesBalayages: union.size, estimation }));
    }
  }
} finally {
  await prisma.$disconnect();
}
