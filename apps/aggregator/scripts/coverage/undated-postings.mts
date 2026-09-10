/**
 * The postings that carry no `postedAt`, hence no JobPosting JSON-LD, hence are ineligible for Google Jobs while
 * their page still answers 200 without noindex — qualified per source, from ARCHIVED state only (no collection).
 *
 * The point is to separate the five possible causes rather than assume one:
 *   COLLECTION   — the adapter never fetched the field (list-only path, detail never read);
 *   ARCHIVING    — the field was fetched but the stored raw does not keep it (nothing to replay offline);
 *   PARSING      — the raw DOES carry a date and we failed to read it (replayable, and a defect of ours);
 *   TRANSFORM    — a date was read but dropped/invalidated downstream (raw has it, canonical column empty);
 *   REAL_ABSENCE — the publisher exposes no date at all on the accessible official data.
 *
 * What this script can decide OFFLINE: PARSING and ARCHIVING (it inspects the archived raw). It can NEVER decide
 * REAL_ABSENCE — that requires observing the live source, so it reports `UNDECIDABLE_OFFLINE` instead of guessing.
 *
 * Usage: npx tsx apps/aggregator/scripts/coverage/undated-postings.mts <output-dir> [--sample=N]
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) { console.error('usage: undated-postings.mts <output-dir> [--sample=N]'); process.exit(2); }
mkdirSync(out, { recursive: true });
const SAMPLE = Number((process.argv.find((a) => a.startsWith('--sample=')) ?? '--sample=40').split('=')[1]);

/**
 * Field names that would carry a PUBLICATION date. The distinction matters and was learned the hard way:
 * an earlier version flagged `lindex-easycruit` as a proven parsing defect because its raw carries
 * `date_start` / `date_end` on all 41 postings. Reading the adapter showed those are VACANCY dates, and that
 * refusing to promote them to `datePosted` is a documented, deliberate decision ("no invented date").
 * A field that merely looks temporal is therefore not evidence: only a publication-date field counts.
 */
const PUBLICATION_DATE_HINT = /(posted|postedon|publish|publicat|publi[ée]|datePosted|firstPublished|erstellt|pubblicat|fecha_?public)/i;
/** Temporal fields that exist but are NOT a publication date — reported separately, never as a defect. */
const NON_PUBLICATION_DATE_HINT = /(date_start|date_end|startdate|enddate|start_date|end_date|valid|expire|deadline|closing|modified|updated)/i;
/** A value that actually looks like a date, so a field named "dateFormat" or "updatedBy" cannot count as evidence. */
const DATE_VALUE = /(\d{4}-\d{2}-\d{2}|\d{1,2}[-/ ][A-Za-zÀ-ÿ]{3,}[-/ ]\d{4}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|^\d{10,13}$)/;

/**
 * The MEANING of a temporal field depends on the ATS, never on its name alone — both directions were measured:
 *  • easycruit `date_start` is a VACANCY date and the adapter deliberately refuses to publish it as datePosted;
 *  • workday `jobPostingInfo.startDate` IS the publication date, and the adapter already maps it to postedAt
 *    ("F-05: the detail's startDate is a REAL date"). Judging both by the field name gives the wrong answer once.
 * Only paths listed here count as publication evidence for that ATS kind.
 */
const KIND_PUBLICATION_PATHS: Record<string, RegExp> = {
  workday: /(^|\.)detail\.jobPostingInfo\.startDate$/,
};

const dateEvidence = (raw: unknown, kind?: string): { publication: string[]; other: string[] } => {
  const kindPath = kind ? KIND_PUBLICATION_PATHS[kind] : undefined;
  const publication: string[] = []; const other: string[] = [];
  const walk = (node: any, path: string, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 5) return;
    for (const [k, v] of Object.entries(node)) {
      const here = path ? `${path}.${k}` : k;
      if ((typeof v === 'string' || typeof v === 'number') && DATE_VALUE.test(String(v))) {
        const entry = `${here}=${String(v).slice(0, 40)}`;
        // An ATS-specific publication path wins over any name heuristic; otherwise a non-publication name wins over
        // a loose publication match, so `date_start` is never counted as evidence.
        if (kindPath?.test(here)) publication.push(entry);
        else if (NON_PUBLICATION_DATE_HINT.test(k)) other.push(entry);
        else if (PUBLICATION_DATE_HINT.test(k)) publication.push(entry);
      }
      walk(v, here, depth + 1);
    }
  };
  walk(raw, '', 0);
  return { publication, other };
};

const p = new PrismaClient({ log: [] });
try {
  const db: any = await p.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const iso: any[] = await tx.$queryRaw`SELECT current_setting('transaction_isolation') AS level`;
    const clock: any[] = await tx.$queryRaw`SELECT now() AS at`;
    const total: any[] = await tx.$queryRaw`SELECT COUNT(*)::int n FROM "Job" WHERE "isActive" AND "postedAt" IS NULL
      AND ("opportunityType" IS NULL OR "opportunityType"::text <> 'OPEN_APPLICATION')`;
    const openApplication: any[] = await tx.$queryRaw`SELECT COUNT(*)::int n FROM "Job" WHERE "isActive" AND "postedAt" IS NULL AND "opportunityType"::text = 'OPEN_APPLICATION'`;
    /** Per source: how many of its active postings are undated, against how many it has — the denominator matters. */
    const bySource: any[] = await tx.$queryRaw`
      SELECT js."sourceKey", s.kind, s.status, s.maison,
             COUNT(DISTINCT j.id)::int active,
             COUNT(DISTINCT j.id) FILTER (WHERE j."postedAt" IS NULL AND (j."opportunityType" IS NULL OR j."opportunityType"::text <> 'OPEN_APPLICATION'))::int undated
      FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" JOIN "Source" s ON s.key=js."sourceKey"
      WHERE js."isActive" AND j."isActive"
      GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT j.id) FILTER (WHERE j."postedAt" IS NULL AND (j."opportunityType" IS NULL OR j."opportunityType"::text <> 'OPEN_APPLICATION')) > 0
      ORDER BY 6 DESC`;
    /** Archived raw of undated postings, to look for a date we failed to read. */
    const raws: any[] = await tx.$queryRaw`
      SELECT js."sourceKey", s.kind, js."externalId", js.raw, j.id AS "jobId"
      FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" JOIN "Source" s ON s.key=js."sourceKey"
      WHERE js."isActive" AND j."isActive" AND j."postedAt" IS NULL
        AND (j."opportunityType" IS NULL OR j."opportunityType"::text <> 'OPEN_APPLICATION')`;
    return { at: clock[0].at as Date, isolation: iso[0].level as string, total: total[0].n as number, openApplication: openApplication[0].n as number, bySource, raws };
  }, { isolationLevel: 'RepeatableRead' });
  if (db.isolation !== 'repeatable read') throw new Error(`undated-postings requires REPEATABLE READ; got "${db.isolation}"`);

  /** Group the archived raw evidence per source. */
  const perSource = new Map<string, { sampled: number; withDate: number; withOtherDate: number; emptyRaw: number; keys: Set<string>; examples: any[] }>();
  for (const r of db.raws) {
    const g = perSource.get(r.sourceKey) ?? { sampled: 0, withDate: 0, withOtherDate: 0, emptyRaw: 0, keys: new Set<string>(), examples: [] };
    const raw = r.raw ?? {};
    const keys = Object.keys(raw);
    const ev = dateEvidence(raw, r.kind);
    g.sampled++;
    if (ev.publication.length) g.withDate++;
    if (ev.other.length) g.withOtherDate++;
    if (!keys.length) g.emptyRaw++;
    for (const k of keys.slice(0, 12)) g.keys.add(k);
    if (g.examples.length < 3) g.examples.push({ externalId: r.externalId, jobId: r.jobId, rawKeys: keys.slice(0, 12), publicationDateEvidence: ev.publication.slice(0, 4), otherTemporalFields: ev.other.slice(0, 4) });
    perSource.set(r.sourceKey, g);
  }

  const rows = db.bySource.map((s: any) => {
    const g = perSource.get(s.sourceKey);
    const withDate = g?.withDate ?? 0;
    const withOther = g?.withOtherDate ?? 0;
    const emptyRaw = g?.emptyRaw ?? 0;
    const sampled = g?.sampled ?? 0;
    // PARSING is asserted only when the archived raw holds a PUBLICATION date we did not read. A vacancy or validity
    // date is NOT that: promoting `date_start` to `datePosted` would invent a publication date (easycruit, by design).
    const verdict = withDate > 0 ? 'PARSING_DEFECT_PROVEN_OFFLINE'
      : emptyRaw === sampled && sampled > 0 ? 'RAW_EMPTY_ARCHIVING_OR_COLLECTION'
      : withOther > 0 ? 'NO_PUBLICATION_DATE_ONLY_VACANCY_OR_VALIDITY_DATES'
      : 'UNDECIDABLE_OFFLINE_RAW_HAS_NO_DATE_FIELD';
    return {
      sourceKey: s.sourceKey, maison: s.maison, kind: s.kind, status: s.status,
      activePostings: s.active, undated: s.undated, datedShare: s.active ? Number((100 * (s.active - s.undated) / s.active).toFixed(1)) : null,
      rawSampled: sampled, rawWithPublicationDate: withDate, rawWithOtherTemporalField: withOther, rawEmpty: emptyRaw,
      rawKeys: [...(g?.keys ?? [])].slice(0, 12), verdict, examples: g?.examples ?? [],
    };
  }).sort((a: any, b: any) => b.undated - a.undated);

  const tally = (f: (r: any) => string) => Object.fromEntries(Object.entries(rows.reduce((m: any, r: any) => { const k = f(r); m[k] = (m[k] ?? 0) + 1; return m; }, {})).sort((a: any, b: any) => b[1] - a[1]));
  const sum = (f: (r: any) => boolean) => rows.filter(f).reduce((n: number, r: any) => n + r.undated, 0);
  const summary = {
    at: db.at.toISOString(), isolation: db.isolation,
    scope: { undatedActivePostings: db.total, excludedOpenApplication: db.openApplication, sourcesConcerned: rows.length },
    note: 'An OPEN_APPLICATION posting legitimately has no JobPosting schema (it is not a specific vacancy) and is excluded from the defect.',
    byVerdict: tally((r: any) => r.verdict),
    postingsByVerdict: Object.fromEntries(['PARSING_DEFECT_PROVEN_OFFLINE', 'RAW_EMPTY_ARCHIVING_OR_COLLECTION', 'NO_PUBLICATION_DATE_ONLY_VACANCY_OR_VALIDITY_DATES', 'UNDECIDABLE_OFFLINE_RAW_HAS_NO_DATE_FIELD'].map((v) => [v, sum((r: any) => r.verdict === v)])),
    top: rows.slice(0, 12).map((r: any) => ({ sourceKey: r.sourceKey, undated: r.undated, active: r.activePostings, datedShare: r.datedShare, verdict: r.verdict, rawKeys: r.rawKeys })),
  };
  const csvEsc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cols = ['sourceKey', 'maison', 'kind', 'status', 'activePostings', 'undated', 'datedShare', 'rawSampled', 'rawWithPublicationDate', 'rawWithOtherTemporalField', 'rawEmpty', 'verdict'];
  writeFileSync(`${out}/undated-by-source.csv`, [cols.join(','), ...rows.map((r: any) => cols.map((c) => csvEsc(r[c])).join(','))].join('\n') + '\n');
  writeFileSync(`${out}/undated-postings.json`, JSON.stringify({ summary, sources: rows.map((r: any) => ({ ...r, examples: r.examples.slice(0, SAMPLE) })) }, null, 1) + '\n');
  console.log(JSON.stringify(summary, null, 1));
} finally { await p.$disconnect(); }
