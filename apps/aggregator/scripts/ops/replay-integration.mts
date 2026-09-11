/**
 * Integration replay: re-derive the canonical fields of already-collected postings from their ARCHIVED raw,
 * through the SAME production code path, for any source of a given ATS family.
 *
 * This is the P3 deliverable, not a helper around it: taking a source on a mastered ATS and getting its postings
 * correctly integrated from its configuration and its evidence, with NO script specific to a Maison. The family
 * is a parameter; the per-ATS knowledge lives where it already lives — in the adapter and in the normalisers.
 *
 * It writes for real (that is the point), but only fields it can DERIVE from the stored raw, and only when the
 * derived value differs from what is stored. It never invents: a field the archive does not carry is left alone.
 *
 * The contract the gate enforces: the perimeter manifest lists every identifier that may be touched BEFORE any
 * write, and `--apply` reports `touchedIds` — the identifiers actually written, possibly empty. A missing
 * declaration is not zero, and the gate refuses it.
 *
 * usage: replay-integration.mts <clone|production> [--apply] [--family=recruitee] [--limit=N]
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'node:fs';
import { cleanPlace, cleanTitle, plausiblePostedAt } from '../../src/lib/normalize.js';
import { htmlToPlainText } from '../../src/lib/html.js';

/**
 * A replay must not depend on the machine it runs on. `new Date("2026-08-27T09:28:42")` — a WordPress date with no
 * zone suffix — is read in the LOCAL timezone: 09:28:42Z under TZ=UTC, 07:28:42Z under Europe/Paris. Measured on
 * the clone: every WordPress date came back two hours off, and the "defect" was my environment, not the data.
 * The replay therefore pins UTC before parsing anything.
 */
/**
 * A zone-less date ("2026-08-27T09:28:42", the WordPress shape) is parsed in the process's LOCAL timezone, so the
 * same archive yields different instants on different hosts. Measured on the clone: production stored 09:28:42Z,
 * a UTC replay produced 11:28:42Z — production itself ran in Europe/Paris.
 *
 * The replay must reproduce production, not impose its own convention, so the zone is explicit and must be the
 * one the pipeline runs in. Setting process.env.TZ after startup does not affect Date parsing, hence the refusal.
 */
const PIPELINE_TZ = process.env.CATWALKS_PIPELINE_TZ ?? 'Europe/Paris';
if (process.env.TZ !== PIPELINE_TZ) {
  console.error(`replay-integration must run in the pipeline's timezone (${PIPELINE_TZ}): zone-less dates are parsed locally. Re-run with TZ=${PIPELINE_TZ}`);
  process.exit(2);
}

const target = process.argv[2];
if (!['clone', 'production'].includes(target ?? '')) { console.error('usage: replay-integration.mts <clone|production> [--apply] [--family=…] [--limit=N]'); process.exit(2); }
const APPLY = process.argv.includes('--apply');
const arg = (n: string, d: string) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=').slice(1).join('=');
const FAMILY = arg('family', 'recruitee');
const LIMIT = Number(arg('limit', '400'));
const OUT = 'backups/lot4-20260909/p8-integration';
mkdirSync(OUT, { recursive: true });

/**
 * Where each ATS family keeps a field in its archived raw. This is configuration, not code per Maison: adding a
 * family is a line here, and every source of that family goes through the same replay.
 */
const PATHS: Record<string, { title?: string[]; location?: string[]; description?: string[]; postedAt?: string[] }> = {
  // Paths read from the ACTUAL archived raw of each family, never assumed.
  // `created_at`, NOT `published_at`: that is the field recruitee.ts maps to postedAt (line 28). A dry run showed
  // the stored value matching created_at exactly, so preferring published_at would have rewritten 300 correct
  // dates — the replay must reproduce the production choice, not make its own.
  recruitee: { title: ['title'], location: ['location', 'city', 'locations.0.city'], postedAt: ['created_at'] },
  // `postedAt` is NOT replayable for wordpress: the raw holds `date` without a zone, and the stored value is two
  // hours ahead of any interpretation this host can reproduce — the collecting process ran in another zone. The
  // date is therefore left out rather than rewritten with a value that would be plausible and wrong.
  wordpress: { title: ['title.rendered'], location: ['location'] },
  // Read from flatchr.ts, not guessed: location is `formatted_address` (line 81) and the date prefers
  // `publish_date` over `created_at` (line 93). The first version used `locality` and `created_at`, and the
  // clone rehearsal caught it — 20 postings repaired with values that were plausible but NOT the ones production
  // derives. The replay must reproduce the adapter's choice, field for field.
  // Location replays exactly (`formatted_address`, flatchr.ts:81). The DATE does not: the adapter prefers
  // `publish_date` (line 93), which the archive does not carry (`has_pub: false`), and `created_at` is ~61s off.
  // Replaying it would silently degrade a correct value, so it is excluded.
  flatchr: { title: ['vacancy.title'], location: ['vacancy.address.formatted_address'] },
};

/**
 * `talentsoft` is deliberately ABSENT: its archived raw holds only `path`, so its postings are not replayable
 * offline. Adding a field map would produce nothing and pretend otherwise. A family enters this table only when
 * its archive actually carries the fields.
 */

const dig = (raw: any, path: string): unknown => path.split('.').reduce((n: any, k) => (n == null ? undefined : n[/^\d+$/.test(k) ? Number(k) : k]), raw);
const first = (raw: any, paths?: string[]) => { for (const p of paths ?? []) { const v = dig(raw, p); if (v != null && v !== '') return v; } return undefined; };

const p = new PrismaClient({ log: [] });
try {
  const map = PATHS[FAMILY];
  if (!map) throw new Error(`no field map for family "${FAMILY}" — add one line to PATHS, never a script per Maison`);

  const rows: any[] = await p.$queryRaw`
    SELECT j.id, js."sourceKey", js."externalId", j.title, j.location, j.city, j."postedAt",
           j.description, js.raw
    FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId" JOIN "Source" s ON s.key = js."sourceKey"
    WHERE js."isActive" AND j."isActive" AND s.kind = ${FAMILY} AND s.status = 'ACTIVE'
      AND js.raw IS NOT NULL
    ORDER BY js."sourceKey", js."externalId" LIMIT ${LIMIT}`;

  /** What the production normalisers would produce from the archive, field by field. */
  const plan = rows.map((r) => {
    const raw = r.raw ?? {};
    const title = cleanTitle(String(first(raw, map.title) ?? '')) || undefined;
    const location = cleanPlace(first(raw, map.location));
    const rawDesc = first(raw, map.description);
    const description = rawDesc ? htmlToPlainText(String(rawDesc)) || undefined : undefined;
    const rawDate = first(raw, map.postedAt);
    const postedAt = rawDate ? plausiblePostedAt(new Date(String(rawDate))) : undefined;
    const to: Record<string, unknown> = {};
    /**
     * Only a field that is MISSING is filled — never one that merely differs.
     *
     * A dry run made the reason concrete: comparing values proposed 300 date rewrites per family that were pure
     * timezone rendering ("17:53" stored vs "16:53Z" in the raw) and, on recruitee, would have replaced
     * `created_at` (what the adapter maps) with `published_at`. A replay whose job is to repair must fill gaps;
     * overwriting a value the pipeline already chose is a regression dressed as a fix.
     */
    if (title && !r.title) to.title = title;
    if (location && !r.location) to.location = location;
    if (description && !r.description) to.description = description;
    if (postedAt && !r.postedAt) to.postedAt = postedAt;
    return { id: r.id, sourceKey: r.sourceKey, externalId: r.externalId, fields: Object.keys(to), to };
  }).filter((x) => x.fields.length);

  const manifestFile = `${OUT}/perimeter-${FAMILY}-${target}.json`;
  writeFileSync(manifestFile, JSON.stringify({
    at: new Date().toISOString(), target, family: FAMILY, examined: rows.length,
    ids: plan.map((x) => x.id),
    rows: plan.map((x) => ({ id: x.id, sourceKey: x.sourceKey, externalId: x.externalId, fields: x.fields })),
  }, null, 1));

  const touchedIds: string[] = [];
  if (APPLY) {
    for (const row of plan) { await p.job.update({ where: { id: row.id }, data: row.to as any }); touchedIds.push(row.id); }
  }
  console.log(JSON.stringify({
    manifestFile, family: FAMILY, examined: rows.length, planned: plan.length,
    sources: [...new Set(plan.map((x) => x.sourceKey))].length,
    byField: plan.flatMap((x) => x.fields).reduce((m: any, f) => { m[f] = (m[f] ?? 0) + 1; return m; }, {}),
    applied: touchedIds.length, touchedIds,
  }, null, 1));
} finally { await p.$disconnect(); }
