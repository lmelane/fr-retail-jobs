/**
 * Ce que l'état d'exposition LIT (D-520 §3) : les offres et leurs représentations, telles que la recherche les lit, puis
 * la répartition par état et le parcours complet d'une offre. Lecture seule ; aucune écriture, nulle part.
 *
 * Le verdict vient toujours de `classifyExposure` (`offerExposure.ts`) : ce module ne décide rien, il rassemble les
 * colonnes. Une base qui n'a pas encore les colonnes de R-143 §2, §3 (migration `20261002140000`, livrée avec r6) est
 * lue sans elles : aucune retenue, aucune fin prouvée par l'officiel, exactement ce que sert alors la recherche de
 * cette base. `schema` le dit dans chaque rendu.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { canonicalJobId } from '@catwalks/db';
import { MARCHES } from '@catwalks/db/marches';
import { LIGHT_PASS_RUN_COMMAND } from '../pipeline/referenceRuns.js';
import { canonicalCompany, marketLabel, marketOf } from './coverageReading.js';
import { classifyExposure, comeback, countVerdict, emptyCounts, CAUSE_LABEL, STATE_LABEL, type ExposureCounts, type ExposureJob,
  type ExposureSource, type ExposureSummary, type ExposureVerdict } from './offerExposure.js';

type Db = Prisma.TransactionClient | PrismaClient;
export type ExposureSchema = { availabilityHold: boolean; publisherClosedAt: boolean };

export async function probeExposureSchema(db: Db): Promise<ExposureSchema> {
  const rows = await db.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'JobSource' AND table_schema = current_schema()
      AND column_name IN ('availabilityHold', 'publisherClosedAt')`;
  const has = new Set(rows.map(r => r.column_name));
  return { availabilityHold: has.has('availabilityHold'), publisherClosedAt: has.has('publisherClosedAt') };
}

type JobRow = { id: string; companyId: string; title: string; isActive: boolean; mergedIntoId: string | null; closedAt: Date | null;
  withdrawnAt: Date | null; withdrawalReason: string | null; countryCode: string | null };
type SourceRow = { id: string; jobId: string | null; sourceKey: string; sourceTier: string; externalId: string; url: string; isActive: boolean;
  expiresAt: Date | null; lastSeenAt: Date; firstSeenAt: Date; postedAt: Date | null; quarantinedAt: Date | null; quarantineReason: string | null;
  captureBatchId: string | null; availabilityHold: string | null; availabilityHoldAt: Date | null; holdRule: string | null;
  publisherClosedAt: Date | null; sourceStatus: string | null };

function sourceColumns(schema: ExposureSchema): Prisma.Sql {
  const hold = schema.availabilityHold
    ? Prisma.sql`js."availabilityHold", js."availabilityHoldAt", js."availabilityEvidence"->>'rule' AS "holdRule"`
    : Prisma.sql`NULL::text AS "availabilityHold", NULL::timestamp AS "availabilityHoldAt", NULL::text AS "holdRule"`;
  const closedBy = schema.publisherClosedAt ? Prisma.sql`js."publisherClosedAt"` : Prisma.sql`NULL::timestamp AS "publisherClosedAt"`;
  return Prisma.sql`js.id, js."jobId", js."sourceKey", js."sourceTier", js."externalId", js.url, js."isActive", js."expiresAt",
    js."lastSeenAt", js."firstSeenAt", js."postedAt", js."quarantinedAt", js."quarantineReason", js."captureBatchId", ${hold}, ${closedBy},
    s.status::text AS "sourceStatus"`;
}

/** Les retenues de collecte et décisions de périmètre ne servent qu'à nommer un retrait ou une fermeture : lues pour eux seuls. */
async function lifecycleEvidence(db: Db, pairs: Array<{ sourceKey: string; externalId: string }>) {
  const holds = new Map<string, string>(), scoped = new Set<string>();
  if (!pairs.length) return { holds, scoped };
  const keys = pairs.map(p => p.sourceKey), ids = pairs.map(p => p.externalId);
  const latest = await db.$queryRaw<Array<{ sourceKey: string; externalId: string; hold: string }>>`
    SELECT DISTINCT ON (o."sourceKey", o."externalId") o."sourceKey", o."externalId", o."publicationHold" AS hold
    FROM "SourceObservation" o JOIN unnest(${keys}::text[], ${ids}::text[]) AS p(k, e) ON o."sourceKey" = p.k AND o."externalId" = p.e
    WHERE o."publicationHold" IS NOT NULL ORDER BY o."sourceKey", o."externalId", o."observedAt" DESC`;
  for (const row of latest) holds.set(`${row.sourceKey}\u0000${row.externalId}`, row.hold);
  const decisions = await db.$queryRaw<Array<{ sourceKey: string; externalId: string }>>`
    SELECT d."sourceKey", d."externalId" FROM "PostingScopeDecision" d
    JOIN unnest(${keys}::text[], ${ids}::text[]) AS p(k, e) ON d."sourceKey" = p.k AND d."externalId" = p.e WHERE d.verdict = 'OUT_OF_SCOPE'`;
  for (const row of decisions) scoped.add(`${row.sourceKey}\u0000${row.externalId}`);
  return { holds, scoped };
}

export type LoadedJob = ExposureJob & { companyId: string; title: string; sourceRows: SourceRow[] };

/** Les offres (`where` sur l'alias `j`) et leurs représentations, prêtes pour `classifyExposure`. */
export async function loadExposureJobs(db: Db, schema: ExposureSchema, where: Prisma.Sql, options: { everyEvidence?: boolean } = {}): Promise<LoadedJob[]> {
  const jobs = await db.$queryRaw<JobRow[]>(Prisma.sql`
    SELECT j.id, j."companyId", j.title, j."isActive", j."mergedIntoId", j."closedAt", j."withdrawnAt", j."withdrawalReason", j."countryCode"
    FROM "Job" j WHERE ${where}`);
  if (!jobs.length) return [];
  const ids = jobs.map(j => j.id);
  const sources: SourceRow[] = [];
  for (let i = 0; i < ids.length; i += 20_000) {
    sources.push(...await db.$queryRaw<SourceRow[]>(Prisma.sql`
      SELECT ${sourceColumns(schema)} FROM "JobSource" js LEFT JOIN "Source" s ON s.key = js."sourceKey"
      WHERE js."jobId" = ANY(${ids.slice(i, i + 20_000)}::text[])`));
  }
  const byJob = new Map<string, SourceRow[]>();
  for (const row of sources) (byJob.get(row.jobId!) ?? byJob.set(row.jobId!, []).get(row.jobId!)!).push(row);
  const needEvidence = jobs.filter(j => options.everyEvidence || (!j.isActive && !j.mergedIntoId));
  const { holds, scoped } = await lifecycleEvidence(db, needEvidence.flatMap(j => (byJob.get(j.id) ?? []).map(s => ({ sourceKey: s.sourceKey, externalId: s.externalId }))));
  return jobs.map(job => {
    const rows = byJob.get(job.id) ?? [];
    const exposureSources: ExposureSource[] = rows.map(s => ({ ...s, lastHold: holds.get(`${s.sourceKey}\u0000${s.externalId}`) ?? null,
      scopeOut: scoped.has(`${s.sourceKey}\u0000${s.externalId}`) }));
    return { ...job, sources: exposureSources, sourceRows: rows };
  });
}

/** Le périmètre d'une répartition : tout le catalogue, une Maison (avec ses entités fusionnées), un marché ou un pays. */
export type ExposureScope = { kind: 'CATALOGUE' } | { kind: 'MAISON'; companyId: string } | { kind: 'MARCHE'; code: string };

async function maisonCompanies(db: Db, companyId: string): Promise<{ ids: string[]; label: string }> {
  const rows = await db.$queryRaw<Array<{ id: string; name: string; mergedIntoId: string | null }>>`
    SELECT id, name, "mergedIntoId" FROM "Company" WHERE id = ${companyId} OR "mergedIntoId" IS NOT NULL`;
  const merges = new Map(rows.filter(r => r.mergedIntoId).map(r => [r.id, r.mergedIntoId!]));
  const maison = canonicalCompany(merges, companyId);
  const ids = [maison, ...rows.filter(r => r.id !== maison && canonicalCompany(merges, r.id) === maison).map(r => r.id)];
  const name = (await db.$queryRaw<Array<{ name: string }>>`SELECT name FROM "Company" WHERE id = ${maison}`)[0]?.name ?? maison;
  return { ids, label: name };
}

function scopeWhere(scope: ExposureScope, companies: string[] | null): Prisma.Sql {
  if (scope.kind === 'MAISON') return Prisma.sql`j."companyId" = ANY(${companies}::text[])`;
  if (scope.kind === 'MARCHE') {
    const market = MARCHES[scope.code.toUpperCase() as keyof typeof MARCHES];
    const pays = market ? [...market.pays] : [scope.code.toUpperCase()];
    return Prisma.sql`j."countryCode" = ANY(${pays}::text[])`;
  }
  return Prisma.sql`true`;
}

export type ExposureDistribution = ExposureSummary & {
  at: string; schema: ExposureSchema; scope: { kind: ExposureScope['kind']; key: string | null; label: string };
  byMarket?: Array<{ market: string; label: string; counts: ExposureCounts }>;
};

/** La répartition par état d'exposition, d'un seul instant (`at`). Toute offre du périmètre est classée, jamais échantillonnée. */
export async function readExposureDistribution(db: Db, options: { at?: Date; scope?: ExposureScope; byMarket?: boolean } = {}): Promise<ExposureDistribution> {
  const at = options.at ?? new Date();
  const scope = options.scope ?? { kind: 'CATALOGUE' };
  const schema = await probeExposureSchema(db);
  const maison = scope.kind === 'MAISON' ? await maisonCompanies(db, scope.companyId) : null;
  const where = scopeWhere(scope, maison?.ids ?? null);
  const counts = emptyCounts(), unexplained: ExposureDistribution['unexplained'] = [];
  const markets = new Map<string, ExposureCounts>();
  let cursor = '';
  for (;;) {
    const page = await loadExposureJobs(db, schema, Prisma.sql`${where} AND j.id > ${cursor} ORDER BY j.id LIMIT 20000`);
    if (!page.length) break;
    cursor = page[page.length - 1].id;
    for (const job of page) {
      const v = classifyExposure(job, at);
      countVerdict(counts, v);
      if (v.state === 'INEXPLIQUEE' && unexplained.length < 50) unexplained.push({ id: job.id, detail: v.detail });
      if (options.byMarket) {
        const market = marketOf(job.countryCode) ?? (job.countryCode ? `hors marché` : 'sans pays');
        countVerdict(markets.get(market) ?? markets.set(market, emptyCounts()).get(market)!, v);
      }
    }
  }
  const quarantine = scope.kind === 'CATALOGUE' ? (await db.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM "JobSource" WHERE "jobId" IS NULL AND "isActive"`)[0].n : 0;
  const label = scope.kind === 'MAISON' ? maison!.label : scope.kind === 'MARCHE' ? marketLabel(scope.code.toUpperCase()) : 'catalogue';
  return { at: at.toISOString(), schema, scope: { kind: scope.kind, key: scope.kind === 'MAISON' ? scope.companyId : scope.kind === 'MARCHE' ? scope.code.toUpperCase() : null, label },
    counts, identityReview: quarantine, unexplained,
    ...(options.byMarket ? { byMarket: [...markets.entries()].map(([market, c]) => ({ market,
      label: MARCHES[market as keyof typeof MARCHES] ? marketLabel(market) : market, counts: c })).sort((a, b) => b.counts.total - a.counts.total) } : {}) };
}

/** Les identifiants classés dans chaque état, au même instant : le témoin d'équivalence et l'échantillon de relecture. */
export async function readExposureIds(db: Db, at = new Date()): Promise<Map<string, string[]>> {
  const schema = await probeExposureSchema(db);
  const ids = new Map<string, string[]>();
  let cursor = '';
  for (;;) {
    const page = await loadExposureJobs(db, schema, Prisma.sql`j.id > ${cursor} ORDER BY j.id LIMIT 20000`);
    if (!page.length) break;
    cursor = page[page.length - 1].id;
    for (const job of page) {
      const v = classifyExposure(job, at), key = `${v.state}/${v.cause}`;
      (ids.get(key) ?? ids.set(key, []).get(key)!).push(job.id);
    }
  }
  return ids;
}

const ALL_MARKET_COUNTRIES = Object.values(MARCHES).flatMap(m => [...m.pays]);
/**
 * EXPOSÉE = CE QUE SERT LA RECHERCHE. Compare les offres EXPOSEE aux offres que `/emplois` sert dans ses marchés : le
 * prédicat public (`publicJobSql` par défaut, celui de `job-search-query.ts`) et un pays de marché ouvert. `predicate`
 * permet de mesurer une base servie par une autre révision (la production avant r6) avec le prédicat qu'elle exécute.
 */
export async function verifyExposedAgainstSearch(db: Db, options: { at?: Date; predicate?: (alias: Prisma.Sql, at: Date) => Prisma.Sql } = {}) {
  const at = options.at ?? new Date();
  const { publicJobSql } = await import('@catwalks/db/availability');
  const predicate = options.predicate ?? publicJobSql;
  const exposed = new Set((await readExposureIds(db, at)).get('EXPOSEE/CONFIRMEE') ?? []);
  const served = new Set((await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT j.id FROM "Job" j WHERE ${predicate(Prisma.sql`j`, at)} AND j."countryCode" = ANY(${ALL_MARKET_COUNTRIES}::text[])`)).map(r => r.id));
  const onlyExposed = [...exposed].filter(id => !served.has(id)), onlyServed = [...served].filter(id => !exposed.has(id));
  return { at: at.toISOString(), exposed: exposed.size, served: served.size, onlyExposedCount: onlyExposed.length, onlyServedCount: onlyServed.length,
    onlyExposed: onlyExposed.slice(0, 50), onlyServed: onlyServed.slice(0, 50) };
}

/* ─────────────────────────────── Le parcours d'une offre ─────────────────────────────── */

/** L'état opérationnel d'une source, en clair : son statut au registre et sa dernière collecte de RUN (jamais une passe). */
async function sourceStates(db: Db, keys: string[]): Promise<Map<string, { status: string | null; lastRun: { status: string; ranAt: Date; note: string | null } | null; text: string }>> {
  const out = new Map<string, { status: string | null; lastRun: { status: string; ranAt: Date; note: string | null } | null; text: string }>();
  for (const key of [...new Set(keys)]) {
    const source = (await db.$queryRaw<Array<{ status: string }>>`SELECT status::text AS status FROM "Source" WHERE key = ${key}`)[0] ?? null;
    const run = (await db.$queryRaw<Array<{ status: string; ranAt: Date; note: string | null }>>`
      SELECT r.status, r."ranAt", left(r.note, 200) AS note FROM "SourceRun" r WHERE r."sourceKey" = ${key}
        AND NOT EXISTS (SELECT 1 FROM "PipelineRun" p WHERE p.id = r."runId" AND p.command = ${LIGHT_PASS_RUN_COMMAND})
      ORDER BY r."ranAt" DESC LIMIT 1`)[0] ?? null;
    const status = source?.status ?? null;
    const text = `${status ?? 'absente du registre'}${run ? `, dernière collecte de RUN ${run.status} le ${run.ranAt.toISOString().slice(0, 16).replace('T', ' ')} UTC` : ', aucune collecte de RUN'}`;
    out.set(key, { status, lastRun: run, text });
  }
  return out;
}

export type OfferExplanation = {
  at: string; schema: ExposureSchema; requested: string; resolvedBy: 'id' | 'url-offre' | 'url-publication' | 'publication';
  offer: { id: string; title: string; canonicalId: string | null } | null;
  exposure: { state: string; stateLabel: string; cause: string; causeLabel: string; detail: string; sourceKey: string | null; comeback: string };
  sources: Array<{ sourceKey: string; tier: string; externalId: string; url: string; active: boolean; sourceState: string;
    firstSeenAt: string; lastSeenAt: string; expiresAt: string | null; hold: string | null; holdAt: string | null; publisherClosedAt: string | null;
    lastCollectionHold: string | null; capture: { batchId: string; startedAt: string; runId: string | null; command: string | null } | null }>;
  duplicates: { absorbedInto: string[]; winner: { id: string; state: string; cause: string } | null; absorbed: Array<{ id: string; title: string }> };
  maison: { companyId: string; name: string; kind: string; canonicalKey: string; maisonId: string; maisonName: string; group: string | null; sectors: string[] };
  canonical: Record<string, unknown>;
  freshness: { postedAt: string | null; firstSeenAt: string; lastSeenAt: string; lastReview: string | null; lastReviewBy: string | null };
  events: Array<{ at: string; type: string; field: string | null; before: string | null; after: string | null }>;
  lifecycleProof: unknown;
};

const iso = (d: Date | null | undefined) => d ? d.toISOString() : null;

/** Retrouve l'offre : identifiant (ou slug-id de catwalks.io), lien de l'offre, lien d'une publication, ou `source:identifiant`. */
async function resolveOffer(db: Db, ref: string): Promise<{ jobId: string | null; publication: { sourceKey: string; externalId: string } | null; by: OfferExplanation['resolvedBy'] }> {
  const trimmed = ref.trim();
  const byUrl = async (url: string) => {
    const job = await db.job.findFirst({ where: { url }, select: { id: true } });
    if (job) return { jobId: job.id, publication: null, by: 'url-offre' as const };
    const pub = await db.$queryRaw<Array<{ jobId: string | null; sourceKey: string; externalId: string }>>`
      SELECT "jobId", "sourceKey", "externalId" FROM "JobSource" WHERE url = ${url} ORDER BY "isActive" DESC, "lastSeenAt" DESC LIMIT 1`;
    if (pub[0]) return { jobId: pub[0].jobId, publication: { sourceKey: pub[0].sourceKey, externalId: pub[0].externalId }, by: 'url-publication' as const };
    return null;
  };
  if (/^https?:\/\//i.test(trimmed)) {
    const found = await byUrl(trimmed);
    if (found) return found;
    // Une adresse de catwalks.io : /offre/<slug>-<id> (ou /emplois/…) ; le dernier segment porte l'identifiant.
    const segment = new URL(trimmed).pathname.split('/').filter(Boolean).pop() ?? '';
    for (let cut = segment.length; cut >= 0; cut = segment.lastIndexOf('-', cut - 1)) {
      const id = segment.slice(cut + (cut < segment.length && segment[cut] === '-' ? 1 : 0));
      if (id && await db.job.findUnique({ where: { id }, select: { id: true } })) return { jobId: id, publication: null, by: 'id' };
      if (cut <= 0) break;
    }
    return { jobId: null, publication: null, by: 'url-offre' };
  }
  if (await db.job.findUnique({ where: { id: trimmed }, select: { id: true } })) return { jobId: trimmed, publication: null, by: 'id' };
  const colon = trimmed.indexOf(':');
  if (colon > 0) {
    const sourceKey = trimmed.slice(0, colon), externalId = trimmed.slice(colon + 1);
    const pub = await db.jobSource.findUnique({ where: { sourceKey_externalId: { sourceKey, externalId } }, select: { jobId: true } });
    return { jobId: pub?.jobId ?? null, publication: { sourceKey, externalId }, by: 'publication' };
  }
  return { jobId: null, publication: null, by: 'id' };
}

/** Une publication jamais rattachée à une offre : en revue d'identité, ou retenue dès la collecte (jamais publiée). */
async function explainPublicationOnly(db: Db, schema: ExposureSchema, at: Date, requested: string, by: OfferExplanation['resolvedBy'],
  pub: { sourceKey: string; externalId: string }): Promise<OfferExplanation | null> {
  const rows = await db.$queryRaw<SourceRow[]>(Prisma.sql`SELECT ${sourceColumns(schema)} FROM "JobSource" js LEFT JOIN "Source" s ON s.key = js."sourceKey"
    WHERE js."sourceKey" = ${pub.sourceKey} AND js."externalId" = ${pub.externalId}`);
  const hold = (await db.$queryRaw<Array<{ hold: string; observedAt: Date }>>`
    SELECT "publicationHold" AS hold, "observedAt" FROM "SourceObservation" WHERE "sourceKey" = ${pub.sourceKey} AND "externalId" = ${pub.externalId}
      AND "publicationHold" IS NOT NULL ORDER BY "observedAt" DESC LIMIT 1`)[0] ?? null;
  const row = rows[0];
  if (!row && !hold) return null;
  const states = await sourceStates(db, [pub.sourceKey]);
  let v: ExposureVerdict;
  if (row?.isActive && row.jobId === null) {
    v = { state: 'NON_PUBLIABLE', cause: 'IDENTITE_EN_REVUE', sourceKey: pub.sourceKey,
      detail: `publication en quarantaine depuis le ${iso(row.quarantinedAt) ?? '?'} : ${row.quarantineReason ?? 'identité de l’employeur non établie'}` } as ExposureVerdict;
  } else if (hold) {
    const cause = hold.hold === 'NATIVE_SPONTANEOUS_APPLICATION' ? 'CANDIDATURE_SPONTANEE' : hold.hold === 'NATIVE_ADVERTISEMENT_WITHDRAWN' ? 'POSTE_SANS_ANNONCE'
      : hold.hold === 'SCOPE_OUT_OF_PERIMETER' ? 'HORS_PERIMETRE' : hold.hold === 'SOURCE_UNLISTED' ? 'RETIREE_DU_LISTING' : null;
    v = cause ? { state: 'RETENUE_PAR_REGLE', cause, sourceKey: pub.sourceKey, detail: `jamais publiée : retenue ${hold.hold} le ${iso(hold.observedAt)}` } as ExposureVerdict
      : hold.hold.startsWith('APPLICATION_') ? { state: 'FERMEE', cause: 'PAR_LA_SOURCE', sourceKey: pub.sourceKey, detail: `jamais publiée : ${hold.hold} le ${iso(hold.observedAt)}` } as ExposureVerdict
      : hold.hold === 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL' ? { state: 'NON_PUBLIABLE', cause: 'IDENTITE_EN_REVUE', sourceKey: pub.sourceKey, detail: `jamais publiée : l’annonce ne nomme pas son employeur (${iso(hold.observedAt)})` } as ExposureVerdict
      : { state: 'INEXPLIQUEE', cause: 'SANS_CAUSE', sourceKey: pub.sourceKey, detail: `jamais publiée : retenue ${hold.hold} sans état d’exposition connu` } as ExposureVerdict;
  } else {
    v = { state: 'INEXPLIQUEE', cause: 'SANS_CAUSE', sourceKey: pub.sourceKey, detail: 'publication inactive non rattachée, sans retenue' } as ExposureVerdict;
  }
  return { at: at.toISOString(), schema, requested, resolvedBy: by, offer: null,
    exposure: { state: v.state, stateLabel: STATE_LABEL[v.state], cause: v.cause, causeLabel: CAUSE_LABEL[v.cause], detail: v.detail, sourceKey: v.sourceKey,
      comeback: comeback(v, { sourceState: states.get(pub.sourceKey)?.text }) },
    sources: rows.map(r => sourceView(r, states, null)), duplicates: { absorbedInto: [], winner: null, absorbed: [] },
    maison: { companyId: '', name: '', kind: '', canonicalKey: '', maisonId: '', maisonName: '', group: null, sectors: [] },
    canonical: {}, freshness: { postedAt: iso(row?.postedAt), firstSeenAt: iso(row?.firstSeenAt) ?? '', lastSeenAt: iso(row?.lastSeenAt) ?? '', lastReview: null, lastReviewBy: null },
    events: [], lifecycleProof: null };
}

function sourceView(r: SourceRow, states: Awaited<ReturnType<typeof sourceStates>>, capture: OfferExplanation['sources'][number]['capture'], lastHold: string | null = null) {
  return { sourceKey: r.sourceKey, tier: r.sourceTier, externalId: r.externalId, url: r.url, active: r.isActive,
    sourceState: states.get(r.sourceKey)?.text ?? 'inconnue', firstSeenAt: r.firstSeenAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(),
    expiresAt: iso(r.expiresAt), hold: r.availabilityHold, holdAt: iso(r.availabilityHoldAt), publisherClosedAt: iso(r.publisherClosedAt),
    lastCollectionHold: lastHold, capture };
}

/** Le parcours complet d'une offre : source et collecte, doublons, Maison, canonisation, fraîcheur, état, trajectoire. */
export async function explainOffer(db: Db, ref: string, at = new Date()): Promise<OfferExplanation | null> {
  const schema = await probeExposureSchema(db);
  const found = await resolveOffer(db, ref);
  if (!found.jobId) return found.publication ? explainPublicationOnly(db, schema, at, ref, found.by, found.publication) : null;
  const [job] = await loadExposureJobs(db, schema, Prisma.sql`j.id = ${found.jobId}`, { everyEvidence: true });
  if (!job) return null;
  const v = classifyExposure(job, at);
  const canonicalId = await canonicalJobId(db, job.id);
  let winner: OfferExplanation['duplicates']['winner'] = null;
  const chain: string[] = [];
  if (job.mergedIntoId && canonicalId) {
    for (let id: string | null = job.mergedIntoId; id && chain.length < 10;) {
      chain.push(id);
      id = (await db.job.findUnique({ where: { id }, select: { mergedIntoId: true } }))?.mergedIntoId ?? null;
    }
    const [target] = await loadExposureJobs(db, schema, Prisma.sql`j.id = ${canonicalId}`);
    if (target) { const tv = classifyExposure(target, at); winner = { id: canonicalId, state: tv.state, cause: tv.cause }; }
  }
  const absorbed = await db.job.findMany({ where: { mergedIntoId: job.id }, select: { id: true, title: true }, take: 50 });
  const states = await sourceStates(db, job.sourceRows.map(s => s.sourceKey));
  const batches = job.sourceRows.map(s => s.captureBatchId).filter((b): b is string => !!b);
  const captures = new Map((batches.length ? await db.$queryRaw<Array<{ id: string; startedAt: Date; runId: string | null; command: string | null }>>`
    SELECT cb.id, cb."startedAt", cb."runId", p.command FROM "CaptureBatch" cb LEFT JOIN "PipelineRun" p ON p.id = cb."runId"
    WHERE cb.id = ANY(${batches}::text[])` : []).map(c => [c.id, { batchId: c.id, startedAt: c.startedAt.toISOString(), runId: c.runId, command: c.command }]));
  const full = await db.job.findUniqueOrThrow({ where: { id: job.id }, select: { title: true, rawTitle: true, normalizedTitle: true, occupationCode: true,
    occupationStatus: true, occupationDomain: true, occupationDecisionSource: true, titleRoles: true, jobFunction: true, seniority: true, employmentTerm: true,
    rawContract: true, workTime: true, rawWorkingTime: true, programType: true, engagementType: true, workplaceType: true, language: true,
    city: true, adminArea1: true, countryCode: true, countryIntegrity: true, location: true, geoSource: true, geoCityId: true, postedAt: true,
    firstSeenAt: true, lastSeenAt: true, canonicalSourceKey: true, canonicalExternalId: true, url: true,
    company: { select: { id: true, name: true, kind: true, canonicalKey: true, parentGroup: true, sectorCodes: true } } } });
  const maisonRows = await db.$queryRaw<Array<{ id: string; mergedIntoId: string | null }>>`SELECT id, "mergedIntoId" FROM "Company" WHERE "mergedIntoId" IS NOT NULL`;
  const maisonId = canonicalCompany(new Map(maisonRows.map(r => [r.id, r.mergedIntoId!])), full.company.id);
  const maison = maisonId === full.company.id ? full.company
    : await db.company.findUniqueOrThrow({ where: { id: maisonId }, select: { id: true, name: true, kind: true, canonicalKey: true, parentGroup: true, sectorCodes: true } });
  const events = await db.jobEvent.findMany({ where: { jobId: job.id }, orderBy: { at: 'desc' }, take: 15 });
  const proof = (await db.dataCorrection.findFirst({ where: { entityType: 'Job', entityId: job.id, finding: 'REFRESH_LIFECYCLE' }, orderBy: { createdAt: 'desc' },
    select: { createdAt: true, evidence: true } })) ?? null;
  // La dernière revue : la dernière fois qu'une source a revu l'offre, ou qu'une revue du RUN l'a retenue, la plus récente.
  const reviews = [...job.sourceRows.flatMap(s => [{ at: s.lastSeenAt, by: s.sourceKey }, ...(s.availabilityHoldAt ? [{ at: s.availabilityHoldAt, by: `${s.sourceKey} (retenue)` }] : [])]),
    ...(job.closedAt ? [{ at: job.closedAt, by: 'le refresh (fermeture)' }] : []), ...(job.withdrawnAt ? [{ at: job.withdrawnAt, by: 'retrait' }] : [])]
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const holdOf = new Map(job.sources.map(s => [`${s.sourceKey}\u0000${s.externalId}`, s.lastHold ?? null]));
  return {
    at: at.toISOString(), schema, requested: ref, resolvedBy: found.by,
    offer: { id: job.id, title: job.title, canonicalId },
    exposure: { state: v.state, stateLabel: STATE_LABEL[v.state], cause: v.cause, causeLabel: CAUSE_LABEL[v.cause], detail: v.detail, sourceKey: v.sourceKey,
      comeback: comeback(v, { sourceState: v.sourceKey ? states.get(v.sourceKey)?.text : null, winnerId: winner?.id ?? null }) },
    sources: job.sourceRows.map(r => sourceView(r, states, r.captureBatchId ? captures.get(r.captureBatchId) ?? null : null, holdOf.get(`${r.sourceKey}\u0000${r.externalId}`) ?? null)),
    duplicates: { absorbedInto: chain, winner, absorbed },
    maison: { companyId: full.company.id, name: full.company.name, kind: full.company.kind, canonicalKey: full.company.canonicalKey,
      maisonId, maisonName: maison.name, group: maison.parentGroup ?? full.company.parentGroup ?? null, sectors: maison.sectorCodes },
    canonical: { title: full.title, rawTitle: full.rawTitle, metier: { code: full.occupationCode, status: full.occupationStatus, domaine: full.occupationDomain,
      decision: full.occupationDecisionSource, titleRoles: full.titleRoles, famille: full.jobFunction, seniorite: full.seniority },
      contrat: { terme: full.employmentTerm, natif: full.rawContract, tempsDeTravail: full.workTime, tempsNatif: full.rawWorkingTime,
        dispositif: full.programType, nature: full.engagementType, teletravail: full.workplaceType },
      secteur: maison.sectorCodes, langue: full.language,
      lieu: { ville: full.city, region: full.adminArea1, pays: full.countryCode, integrite: full.countryIntegrity, natif: full.location,
        point: full.geoSource, villeId: full.geoCityId, marche: marketOf(full.countryCode) },
      lienCanonique: { source: full.canonicalSourceKey, externalId: full.canonicalExternalId, url: full.url } },
    freshness: { postedAt: iso(full.postedAt), firstSeenAt: full.firstSeenAt.toISOString(), lastSeenAt: full.lastSeenAt.toISOString(),
      lastReview: iso(reviews[0]?.at), lastReviewBy: reviews[0]?.by ?? null },
    events: events.map(e => ({ at: e.at.toISOString(), type: e.type, field: e.field, before: e.before, after: e.after })),
    lifecycleProof: proof ? { at: proof.createdAt.toISOString(), evidence: proof.evidence } : null,
  };
}

/** Le rendu texte de `pourquoi-offre`, section par section. */
export function explanationText(e: OfferExplanation): string[] {
  const out: string[] = [];
  const d = (s: string | null | undefined) => s ? s.slice(0, 16).replace('T', ' ') + ' UTC' : '—';
  out.push(`Offre ${e.offer?.id ?? '(publication non rattachée)'}${e.offer ? ` — ${e.offer.title}` : ''}   [lu le ${d(e.at)}${e.schema.availabilityHold ? '' : ', base sans retenue R-143 §2'}]`);
  out.push('', `ÉTAT : ${e.exposure.stateLabel.toUpperCase()} — ${e.exposure.causeLabel}`, `  ${e.exposure.detail}`, `  Ce qui la ferait revenir : ${e.exposure.comeback}`);
  out.push('', '1. Source et collecte');
  for (const s of e.sources) {
    out.push(`  · ${s.sourceKey} [${s.tier}] ${s.active ? 'active' : 'inactive'} — ${s.externalId}`, `    ${s.url}`,
      `    source : ${s.sourceState}`, `    vue du ${d(s.firstSeenAt)} au ${d(s.lastSeenAt)}${s.expiresAt ? ` ; échéance ${d(s.expiresAt)}` : ''}`
      + `${s.hold ? ` ; retenue ${s.hold} le ${d(s.holdAt)}` : ''}${s.publisherClosedAt ? ` ; fin prouvée par la source le ${d(s.publisherClosedAt)}` : ''}`
      + `${s.lastCollectionHold ? ` ; dernière retenue de collecte ${s.lastCollectionHold}` : ''}`,
      `    collecte : ${s.capture ? `${s.capture.batchId} du ${d(s.capture.startedAt)} (${s.capture.command ?? 'hors RUN'})` : 'non enregistrée'}`);
  }
  out.push('', '2. Doublons');
  if (e.duplicates.winner) out.push(`  absorbée : ${e.duplicates.absorbedInto.join(' → ')} ; l’offre gagnante ${e.duplicates.winner.id} est ${e.duplicates.winner.state} / ${e.duplicates.winner.cause}`);
  out.push(`  ${e.sources.length} représentation(s) ; ${e.duplicates.absorbed.length} jumelle(s) absorbée(s)${e.duplicates.absorbed.length ? ` : ${e.duplicates.absorbed.map(a => a.id).join(', ')}` : ''}`);
  if (e.offer) {
    out.push('', '3. Maison et entité', `  entité : ${e.maison.name} (${e.maison.kind}, ${e.maison.canonicalKey}, ${e.maison.companyId})`,
      `  Maison : ${e.maison.maisonName}${e.maison.maisonId !== e.maison.companyId ? ` (${e.maison.maisonId}, entité fusionnée)` : ''}${e.maison.group ? ` ; groupe ${e.maison.group}` : ''}`);
    const c = e.canonical as { metier: Record<string, unknown>; contrat: Record<string, unknown>; secteur: string[]; lieu: Record<string, unknown> };
    out.push('', '4. Canonisation', `  métier : ${c.metier.code ?? 'non reconnu'} (${c.metier.status}${c.metier.decision ? `, ${c.metier.decision}` : ''}) ; rôles de l’intitulé : ${(c.metier.titleRoles as string[]).join(', ') || '—'}`,
      `  contrat : ${c.contrat.terme ?? 'non précisé'}${c.contrat.natif ? ` (natif « ${c.contrat.natif} »)` : ''} ; temps : ${c.contrat.tempsDeTravail ?? 'non précisé'} ; dispositif : ${c.contrat.dispositif ?? '—'}`,
      `  secteur (Maison) : ${c.secteur.join(', ') || 'inconnu'}`,
      `  lieu : ${[c.lieu.ville, c.lieu.region, c.lieu.pays].filter(Boolean).join(', ') || 'inconnu'} ; marché ${c.lieu.marche ?? 'aucun'} ; point ${c.lieu.point ?? '—'}`);
    out.push('', '5. Fraîcheur', `  publiée (source) : ${d(e.freshness.postedAt)} ; première observation : ${d(e.freshness.firstSeenAt)} ; dernière observation : ${d(e.freshness.lastSeenAt)}`,
      `  dernière revue : ${d(e.freshness.lastReview)}${e.freshness.lastReviewBy ? ` par ${e.freshness.lastReviewBy}` : ''}`);
    if (e.events.length) out.push('', '6. Événements récents', ...e.events.slice(0, 8).map(ev => `  ${d(ev.at)} ${ev.type}${ev.field ? ` ${ev.field}` : ''}${ev.after ? ` → ${ev.after}` : ''}`));
  }
  return out;
}
