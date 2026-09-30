/**
 * D-482 — POURQUOI L'ÉNUMÉRATION FOOT LOCKER A ÉTÉ RÉFUTÉE LE 28/09. Lecture seule, aucun contact éditeur.
 *
 *   export PYTHONDONTWRITEBYTECODE=1 CATWALKS_DB_ACCESS=<dossier d'accès>
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/mesures/d482-foot-locker-pages.mts --batches=<id>,<id>,... [--ids=1] [--comparer=<idA>,<idB>]
 *
 * Pour chaque capture JOBS, dans l'ordre de `sequence` : la page réellement demandée (enveloppe de requête native),
 * le statut, la taille, le compteur de l'éditeur (`totalCount` / `count`, ceux que lit `phenom.ts`), le nombre
 * d'entrées, les identifiants neufs / répétés / variantes de langue — le même calcul que l'adaptateur. Puis le
 * manifeste scellé (issues, terminaison, total déclaré) et la différence d'identifiants entre les captures.
 */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../src/capture/store.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const batches = (arg('batches') ?? '').split(',').filter(Boolean);
const showIds = arg('ids') === '1';
if (!batches.length) { console.error('usage: --batches=<id>,<id>'); process.exit(2); }

type Data = { slug?: string; req_id?: string; language?: string; title?: string };
type Page = { jobs?: Array<{ data?: Data }>; totalCount?: number; count?: number };

const prisma = new PrismaClient({ log: [] });
const idSets = new Map<string, Map<string, string>>();
try {
  for (const batchId of batches) {
    const rows = await prisma.rawCapture.findMany({ where: { batchId }, orderBy: { sequence: 'asc' },
      select: { sequence: true, status: true, blobHash: true, requestDataHash: true, capturedAt: true } });
    const seen = new Map<string, string>(); // id -> language
    let languageVariants = 0, repeated = 0, declared: number | undefined;
    const lignes: string[] = [];
    for (const row of rows) {
      let pageParam = '?';
      if (row.requestDataHash) {
        try {
          const env = JSON.parse((await readRawBlob(prisma, row.requestDataHash)).toString('utf8')) as { logical?: { url?: string } };
          const u = new URL(String(env.logical?.url ?? ''));
          pageParam = `limit=${u.searchParams.get('limit')}&page=${u.searchParams.get('page')}`;
        } catch (e) { pageParam = `illisible:${(e as Error).message.slice(0, 40)}`; }
      }
      const body = row.blobHash ? (await readRawBlob(prisma, row.blobHash)).toString('utf8') : '';
      let page: Page = {};
      try { page = JSON.parse(body) as Page; } catch { lignes.push(`#${row.sequence} ${pageParam} status=${row.status} octets=${body.length} JSON illisible`); continue; }
      const batch = page.jobs ?? [];
      let fresh = 0, rep = 0, lv = 0, sansData = 0;
      const neufs: string[] = [], reps: string[] = [];
      for (const e of batch) {
        if (!e.data) { sansData++; continue; }
        const id = String(e.data.slug ?? e.data.req_id ?? e.data.title);
        const lang = String(e.data.language ?? '');
        if (seen.has(id)) {
          if (lang && seen.get(id) && seen.get(id) !== lang) { lv++; languageVariants++; reps.push(`${id}[${seen.get(id)}→${lang}]`); continue; }
          rep++; repeated++; reps.push(`${id}[REP ${lang}]`); continue;
        }
        seen.set(id, lang); fresh++; neufs.push(id);
      }
      const total = page.totalCount ?? page.count;
      if (declared === undefined) declared = total;
      const change = total !== undefined && declared !== undefined && total !== declared ? ` TOTAL_CHANGE(${declared}→${total})` : '';
      lignes.push(`#${row.sequence} ${pageParam} ${row.capturedAt.toISOString().slice(11, 19)} status=${row.status} octets=${body.length} totalCount=${page.totalCount} count=${page.count} entrées=${batch.length} neufs=${fresh} variantesLangue=${lv} répétés=${rep} sansData=${sansData} cumul=${seen.size}+${languageVariants}lv${change}` +
        (reps.length ? ` doublons=${reps.join(',')}` : '') + (showIds ? ` ids=${neufs.join(',')}` : ''));
    }
    idSets.set(batchId, seen);
    const outcome = await prisma.captureOutcome.findUnique({ where: { batchId } });
    let manifeste: unknown = null;
    if (outcome?.manifestHash) {
      const m = JSON.parse((await readRawBlob(prisma, outcome.manifestHash)).toString('utf8')) as { metadata?: Record<string, unknown> };
      const meta = m.metadata ?? {};
      const en = (meta.enumeration ?? {}) as Record<string, unknown>;
      manifeste = { declaredTotal: meta.declaredTotal, complete: meta.complete, truncated: meta.truncated, termination: en.termination, pages: en.pages, rawCount: en.rawCount,
        issues: en.issues, scopes: en.scopes,
        compteurs: (en.pageEvidence as Array<{ publisherCounter?: string; componentCounters?: string[] }> | undefined)?.map((p, i) => `p${i + 1} ${p.publisherCounter} ${(p.componentCounters ?? []).join(' ')}`) };
    }
    console.log(JSON.stringify({ batchId, requêtes: rows.length, totalPremièrePage: declared, idsDistincts: seen.size, variantesLangue: languageVariants, répétés: repeated,
      outcome: outcome ? { status: outcome.status, extractedCount: outcome.extractedCount } : null, pages: lignes, manifeste }, null, 1));
  }
  // --comparer=A,B : page par page, le corps est-il le même une fois le compteur `totalCount` retiré ?
  const [ca, cb] = (arg('comparer') ?? '').split(',');
  if (ca && cb) {
    const pagesOf = async (id: string) => Promise.all((await prisma.rawCapture.findMany({ where: { batchId: id }, orderBy: { sequence: 'asc' }, select: { blobHash: true } }))
      .map(async (r) => JSON.parse(r.blobHash ? (await readRawBlob(prisma, r.blobHash)).toString('utf8') : '{}') as Page));
    const [pa, pb] = [await pagesOf(ca), await pagesOf(cb)];
    const sansCompteur = (p: Page) => JSON.stringify({ ...p, totalCount: undefined });
    const idsOf = (p: Page) => (p.jobs ?? []).map((e) => `${e.data?.slug ?? e.data?.req_id}/${e.data?.language ?? ''}`);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const a = pa[i], b = pb[i];
      if (!a || !b) { console.log(`p${i + 1} présente d'un seul côté`); continue; }
      const same = sansCompteur(a) === sansCompteur(b);
      const ia = idsOf(a), ib = idsOf(b);
      console.log(`p${i + 1} totals ${a.totalCount}/${b.totalCount} corpsHorsCompteur=${same ? 'IDENTIQUE' : 'DIFFÉRENT'} mêmesIdsMêmeOrdre=${ia.join() === ib.join()}` +
        (ia.join() === ib.join() ? '' : ` seulementA=${ia.filter((x) => !ib.includes(x)).join(',')} seulementB=${ib.filter((x) => !ia.includes(x)).join(',')}`));
    }
  }
  // Différences d'identifiants entre captures, deux à deux dans l'ordre donné.
  for (let i = 1; i < batches.length; i++) {
    const a = idSets.get(batches[i - 1]!)!, b = idSets.get(batches[i]!)!;
    const retirés = [...a.keys()].filter((id) => !b.has(id)), ajoutés = [...b.keys()].filter((id) => !a.has(id));
    console.log(JSON.stringify({ de: batches[i - 1], vers: batches[i], retirés: retirés.length, ajoutés: ajoutés.length, idsRetirés: retirés.slice(0, 40), idsAjoutés: ajoutés.slice(0, 40) }));
  }
} finally {
  await prisma.$disconnect();
}
