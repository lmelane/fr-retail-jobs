/**
 * Ce que l'alerte de couverture LIT, et la photographie qu'elle ÉCRIT (R-143 §11, D-515 §5, D-516 §2).
 *
 * « Servie » est le filtre public lui-même (`publicJobSql`, `packages/db/availability.ts`) avec un pays connu, comme la
 * recherche : la photographie compte ce que le candidat peut voir.
 *
 * L'AVANT DU RUN (`readCoverageBefore`) : les offres servies par Maison et par marché, lues juste avant les étapes qui
 * retirent (refresh, revue de disponibilité, sonde). La différence avec l'après est ce que ces étapes ont retiré.
 *
 * Les SORTIES, par cause, comptées depuis chaque horizon (avant ce RUN, dernier RUN photographié, début de la fenêtre) :
 *   · offre fermée (JobEvent CLOSED) : FERMETURE_SOURCE, la source a prouvé la fin (liste prouvée, retrait natif,
 *     échéance, autorité R-143 §3) ;
 *   · offre retirée (JobEvent WITHDRAWN, motif posé par `lifecycle.ts`) : `withdrawalCause` ;
 *   · offre active mais plus servie, par la retenue de disponibilité de ses représentations (R-143 §2) : la sonde a lu
 *     une page morte -> LIEN_MORT ; le plafond de 72 h d'une source active sans collecte crédible -> COLLECTE ; une
 *     collecte crédible ne la liste plus -> NON_REVUE ; toutes ses représentations échues -> FERMETURE_SOURCE ;
 *   · offre regroupée sous une jumelle (R-143 §4) -> REGROUPEE (l'opportunité reste servie).
 *
 * Les MENACES : offres servies dont TOUTES les représentations confirmées viennent de sources ACTIVES et n'ont été revues
 * par aucune collecte depuis le début du dernier RUN complet (`runStartedAt`, commande `ingest-all`) : collecte en échec,
 * incomplète ou absente du RUN. Le plafond de 72 h les masquera si rien ne reprend. Une passe de découverte ne revoit
 * jamais une offre connue (lecture incrémentale, D-517) : elle ne retire rien des menaces ; l'état affiché de la source,
 * et sa qualification de référence, sont ceux du RUN, pas de la passe.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { publicJobSql } from '@catwalks/db/availability';
import { MARCHES } from '@catwalks/db/marches';
import { LIGHT_PASS_RUN_COMMAND } from '../pipeline/referenceRuns.js';
import { HORIZONS, LOSS_CAUSES, REFERENCE_RUNS, KNOWN_SOURCE_FLOOR, emptyExits, entityId, type EntityScope, type EntityState,
  type Horizon, type HistoryRun, type KnownSource, type LossCause, type SnapshotRow } from './coverageAlert.js';

type Db = Prisma.TransactionClient | PrismaClient;
/**
 * L'état d'une source se lit au dernier RUN, jamais à une passe légère (R-143 §1, `referenceRuns.ts`) : une passe à 40
 * entre deux RUN à 100, ou une passe OK après un RUN en échec, ne dit rien de ce que le RUN a vu.
 */
const notLightPass = (sourceRun: Prisma.Sql) => Prisma.sql`NOT EXISTS (SELECT 1 FROM "PipelineRun" pass
  WHERE pass.id = ${sourceRun}."runId" AND pass.command = ${LIGHT_PASS_RUN_COMMAND})`;

const MARKET_OF_COUNTRY: ReadonlyMap<string, string> = new Map(
  Object.values(MARCHES).flatMap(m => m.pays.map(pays => [pays, m.code] as const)));
const REGION = new Intl.DisplayNames(['fr'], { type: 'region' });
export function marketOf(countryCode: string | null): string | null {
  return countryCode ? MARKET_OF_COUNTRY.get(countryCode.toUpperCase()) ?? null : null;
}
export function marketLabel(code: string): string {
  try { return REGION.of(code) ?? code; } catch { return code; }
}

/**
 * Le motif d'un retrait d'offre (`WithdrawalReason`, `pipeline/lifecycle.ts`), rendu en cause :
 *   · SOURCE_RETIRED (`retire-source`, décision de l'équipe) -> PAUSE_DECIDEE (pause ou retrait décidé) ;
 *   · OUT_OF_SCOPE (D-511, D-512, périmètre décidé), SOURCE_UNLISTED (D-514 §4, dépublication par l'éditeur),
 *     IDENTITY_CONTRADICTED (décision d'identité) -> RETENUE_REGLE ;
 *   · ATTESTATION_MISSING (le refresh retire sans preuve de fin), PUBLICATION_UNVERIFIED (réparation de dédoublonnage
 *     qui ne peut plus vérifier la publication) -> NON_REVUE : à vérifier, jamais rangé parmi le normal.
 * Un motif inconnu n'a pas de cause : la perte qu'il fait reste « aucune cause trouvée ».
 */
const WITHDRAWAL_CAUSES: Readonly<Record<string, LossCause>> = {
  SOURCE_RETIRED: 'PAUSE_DECIDEE', OUT_OF_SCOPE: 'RETENUE_REGLE', SOURCE_UNLISTED: 'RETENUE_REGLE', IDENTITY_CONTRADICTED: 'RETENUE_REGLE',
  ATTESTATION_MISSING: 'NON_REVUE', PUBLICATION_UNVERIFIED: 'NON_REVUE',
};
export function withdrawalCause(reason: string | null): LossCause | null {
  return reason && Object.hasOwn(WITHDRAWAL_CAUSES, reason) ? WITHDRAWAL_CAUSES[reason] : null;
}

/** La Maison canonique : la société absorbante d'une fusion relue (R-143 §5), suivie jusqu'au bout. */
export function canonicalCompany(merges: ReadonlyMap<string, string>, id: string): string {
  let current = id;
  for (let hop = 0; hop < 10 && merges.has(current); hop++) current = merges.get(current)!;
  return current;
}

type Companies = { merges: Map<string, string>; names: Map<string, string> };
async function readCompanies(db: Db): Promise<Companies> {
  const rows = await db.$queryRaw<Array<{ id: string; name: string; mergedIntoId: string | null }>>`
    SELECT c.id, c.name, c."mergedIntoId" FROM "Company" c
    WHERE c."mergedIntoId" IS NOT NULL OR EXISTS (SELECT 1 FROM "Job" j WHERE j."companyId" = c.id)
      OR EXISTS (SELECT 1 FROM "Company" m WHERE m."mergedIntoId" = c.id)`;
  return { merges: new Map(rows.filter(r => r.mergedIntoId).map(r => [r.id, r.mergedIntoId!])), names: new Map(rows.map(r => [r.id, r.name])) };
}

/** Une cellule : société, pays, et la source canonique de l'offre (absente pour une menace, jugée à part). */
type Cell = { c: string; p: string; s?: string | null };
class Entities {
  private readonly map = new Map<string, EntityState>();
  constructor(private readonly companies: Companies) {}
  private entity(scope: EntityScope, key: string, label: string): EntityState {
    const id = entityId(scope, key);
    let entity = this.map.get(id);
    if (!entity) this.map.set(id, entity = { scope, key, label, served: 0, exits: emptyExits(), threat: { count: 0, sources: [] } });
    return entity;
  }
  /** La même ligne compte pour sa Maison, son marché (un pays hors marché ouvert ne compte pas) et sa source canonique. */
  each(cell: Cell, apply: (entity: EntityState) => void) {
    const maison = canonicalCompany(this.companies.merges, cell.c);
    apply(this.entity('MAISON', maison, this.companies.names.get(maison) ?? maison));
    const market = marketOf(cell.p);
    if (market) apply(this.entity('MARCHE', market, marketLabel(market)));
    if (cell.s) apply(this.source(cell.s));
  }
  source(key: string): EntityState { return this.entity('SOURCE', key, key); }
  list(): EntityState[] { return [...this.map.values()]; }
}

function addSource(list: Array<{ sourceKey: string; count: number }>, sourceKey: string, count: number) {
  const row = list.find(s => s.sourceKey === sourceKey);
  if (row) row.count += count; else list.push({ sourceKey, count });
  list.sort((a, b) => b.count - a.count || a.sourceKey.localeCompare(b.sourceKey));
}

async function servedCells(db: Db, at: Date) {
  return db.$queryRaw<Array<Cell & { n: number }>>(Prisma.sql`
    SELECT j."companyId" AS c, j."countryCode" AS p, j."canonicalSourceKey" AS s, count(*)::int AS n FROM "Job" j
    WHERE ${publicJobSql(Prisma.raw('j'), at)} AND j."countryCode" IS NOT NULL GROUP BY 1, 2, 3`);
}

/** L'avant du RUN : offres servies par entité (`MAISON:<id>`, `MARCHE:<code>`, `SOURCE:<clé>`), lues avant les étapes qui retirent. */
export type CoverageBefore = { at: Date; served: ReadonlyMap<string, number> };
export async function readCoverageBefore(db: Db, at = new Date()): Promise<CoverageBefore> {
  const entities = new Entities(await readCompanies(db));
  for (const row of await servedCells(db, at)) entities.each(row, e => { e.served += row.n; });
  return { at, served: new Map(entities.list().map(e => [entityId(e.scope, e.key), e.served])) };
}

export type CoverageHorizons = Partial<Record<Horizon, Date | null>>;
export type MaskedStock = { total: number; maisons: Array<{ label: string; count: number }> };

/**
 * L'état courant : offres servies, avant du RUN, sorties par cause et par horizon, menaces, sources qualifiées qui ne
 * servent rien, et le stock des offres masquées par Maison.
 */
export async function readCoverageState(db: Db, options: { at: Date; horizons: CoverageHorizons; runStartedAt?: Date | null;
  before?: CoverageBefore | null }): Promise<{ entities: EntityState[]; knownSources: KnownSource[]; masked: MaskedStock }> {
  const { at } = options;
  const j = Prisma.raw('j');
  const companies = await readCompanies(db);
  const entities = new Entities(companies);

  for (const row of await servedCells(db, at)) entities.each(row, e => { e.served += row.n; });
  if (options.before) {
    const before = options.before.served;
    for (const e of entities.list()) e.before = before.get(entityId(e.scope, e.key)) ?? 0;
    // Une entité servie avant et plus du tout après n'a aucune ligne servie : elle est créée ici (la Maison vide `''` que
    // crée un marché seul est retirée à la fin).
    for (const [id, n] of before) {
      if (!n || entities.list().some(e => entityId(e.scope, e.key) === id)) continue;
      const [scope, ...rest] = id.split(':');
      const key = rest.join(':');
      if (scope === 'MAISON') entities.each({ c: key, p: '' }, e => { if (e.scope === 'MAISON') e.before = n; });
      else if (scope === 'SOURCE') entities.source(key).before = n;
      else if (scope === 'MARCHE') {
        const country = MARCHES[key as keyof typeof MARCHES]?.pays[0];
        if (country) entities.each({ c: '', p: country }, e => { if (e.scope === 'MARCHE') e.before = n; });
      }
    }
  }

  const bounds = HORIZONS.map(h => options.horizons[h]).filter((d): d is Date => d instanceof Date);
  if (bounds.length) {
    const since = new Date(Math.min(...bounds.map(d => d.getTime())));
    const run = options.horizons.RUN ?? null, last = options.horizons.LAST ?? null;
    // L'horizon le plus étroit qui contient la sortie ; les horizons sont cumulés ensuite (RUN ⊂ LAST ⊂ WINDOW).
    const utc = (d: Date | null) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;
    const phase = (column: Prisma.Sql) => Prisma.sql`CASE WHEN ${utc(run)} IS NOT NULL AND ${column} >= ${utc(run)} THEN 'RUN'
      WHEN ${utc(last)} IS NOT NULL AND ${column} >= ${utc(last)} THEN 'LAST' ELSE 'WINDOW' END`;
    const lifecycle = await db.$queryRaw<Array<Cell & { type: string; reason: string | null; s: string | null; h: Horizon; n: number }>>(Prisma.sql`
      WITH last AS (
        SELECT DISTINCT ON (e."jobId") e."jobId", e.type, e.after, e.at FROM "JobEvent" e
        WHERE e.type IN ('CLOSED','WITHDRAWN') AND e.at >= ${since} AND e.at <= ${at} ORDER BY e."jobId", e.at DESC)
      SELECT j."companyId" AS c, j."countryCode" AS p, l.type, l.after AS reason, j."canonicalSourceKey" AS s, ${phase(Prisma.sql`l.at`)} AS h,
        count(*)::int AS n
      FROM last l JOIN "Job" j ON j.id = l."jobId"
      WHERE NOT j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL GROUP BY 1, 2, 3, 4, 5, 6`);
    const held = await db.$queryRaw<Array<Cell & { cause: LossCause; s: string | null; canon: string | null; h: Horizon; n: number }>>(Prisma.sql`
      WITH np AS (
        SELECT j.id, j."companyId" AS c, j."countryCode" AS p, j."canonicalSourceKey" AS canon,
          bool_or(js."availabilityHold" = 'APPLY_LINK_DEAD' AND js."availabilityHoldAt" >= ${since}) AS dead,
          bool_or(js."availabilityHold" = 'NOT_RECONFIRMED' AND js."availabilityEvidence"->>'rule' = 'CEILING_72H'
            AND js."availabilityHoldAt" >= ${since}) AS ceiling,
          bool_or(js."availabilityHold" = 'NOT_RECONFIRMED' AND js."availabilityHoldAt" >= ${since}) AS missed,
          bool_or(js."expiresAt" IS NOT NULL AND js."expiresAt" <= ${at} AND js."expiresAt" >= ${since}) AS expired,
          max(greatest(CASE WHEN js."availabilityHoldAt" >= ${since} THEN js."availabilityHoldAt" END,
            CASE WHEN js."expiresAt" <= ${at} AND js."expiresAt" >= ${since} THEN js."expiresAt" END)) AS left_at,
          (array_agg(js."sourceKey" ORDER BY js."availabilityHoldAt" DESC NULLS LAST))[1] AS held_source
        FROM "Job" j JOIN "JobSource" js ON js."jobId" = j.id AND js."isActive"
        WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL AND NOT (${publicJobSql(j, at)})
        GROUP BY j.id)
      SELECT c, p, CASE WHEN dead THEN 'LIEN_MORT' WHEN ceiling THEN 'COLLECTE' WHEN missed THEN 'NON_REVUE' ELSE 'FERMETURE_SOURCE' END AS cause,
        CASE WHEN dead OR ceiling OR missed THEN held_source ELSE canon END AS s, canon, ${phase(Prisma.sql`left_at`)} AS h, count(*)::int AS n
      FROM np WHERE dead OR ceiling OR missed OR expired GROUP BY 1, 2, 3, 4, 5, 6`);
    const grouped = await db.$queryRaw<Array<Cell & { s: string | null; h: Horizon; n: number }>>(Prisma.sql`
      SELECT j."companyId" AS c, j."countryCode" AS p, j."canonicalSourceKey" AS s, ${phase(Prisma.sql`j."updatedAt"`)} AS h, count(*)::int AS n
      FROM "Job" j WHERE j."mergedIntoId" IS NOT NULL AND j."updatedAt" >= ${since} AND j."updatedAt" <= ${at} AND j."countryCode" IS NOT NULL
      GROUP BY 1, 2, 3, 4`);
    // La sortie compte pour la source canonique de l'offre (celle dont l'offre servie quitte le compte) ; l'action nomme la
    // source qui a posé la retenue.
    const exit = (cell: Cell, cause: LossCause | null, source: string | null, h: Horizon, n: number) => entities.each(cell, e => {
      if (!cause) return;
      // Cumulé : une sortie de ce RUN compte aussi depuis le dernier RUN et depuis la fenêtre.
      for (const horizon of HORIZONS.slice(HORIZONS.indexOf(h))) {
        const bucket = e.exits[horizon];
        bucket.counts[cause] = (bucket.counts[cause] ?? 0) + n;
        addSource(bucket.sources[cause] ??= [], source ?? 'inconnue', n);
      }
    });
    for (const row of lifecycle) exit(row, row.type === 'CLOSED' ? 'FERMETURE_SOURCE' : withdrawalCause(row.reason), row.s, row.h, row.n);
    for (const row of held) exit({ c: row.c, p: row.p, s: row.canon }, LOSS_CAUSES.includes(row.cause) ? row.cause : null, row.s, row.h, row.n);
    for (const row of grouped) exit(row, 'REGROUPEE', row.s, row.h, row.n);
  }

  if (options.runStartedAt) {
    const threats = await db.$queryRaw<Array<Cell & { s: string; status: string | null; note: string | null; n: number; seen: Date | null }>>(Prisma.sql`
      WITH conf AS (
        SELECT js."jobId", js."sourceKey", js."lastSeenAt", j."companyId", j."countryCode", s.status::text AS source_status
        FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId" JOIN "Source" s ON s.key = js."sourceKey"
        WHERE js."isActive" AND (js."expiresAt" IS NULL OR js."expiresAt" > ${at}) AND js."availabilityHold" IS NULL
          AND ${publicJobSql(j, at)} AND j."countryCode" IS NOT NULL),
      unseen AS (
        SELECT "jobId", min("companyId") AS c, min("countryCode") AS p, min("sourceKey") AS s, max("lastSeenAt") AS seen
        FROM conf GROUP BY "jobId" HAVING bool_and(source_status = 'ACTIVE' AND "lastSeenAt" < ${options.runStartedAt}))
      SELECT u.c, u.p, u.s, r.status, left(r.note, 240) AS note, count(*)::int AS n, min(u.seen) AS seen
      FROM unseen u LEFT JOIN LATERAL (SELECT sr.status, sr.note FROM "SourceRun" sr WHERE sr."sourceKey" = u.s AND ${notLightPass(Prisma.raw('sr'))}
        ORDER BY sr."ranAt" DESC LIMIT 1) r ON true
      GROUP BY 1, 2, 3, 4, 5`);
    // Une menace se juge à la source (`threatFindings`) : elle ne compte que pour la Maison et le marché.
    for (const row of threats) entities.each({ c: row.c, p: row.p }, e => {
      e.threat.count += row.n;
      const existing = e.threat.sources.find(s => s.sourceKey === row.s);
      if (existing) { existing.count += row.n; if (row.seen && (!existing.lastSeenAt || row.seen < existing.lastSeenAt)) existing.lastSeenAt = row.seen; }
      else e.threat.sources.push({ sourceKey: row.s, count: row.n, status: row.status ?? 'absente du RUN', note: row.note, lastSeenAt: row.seen });
    });
  }

  const knownSources = await db.$queryRaw<KnownSource[]>(Prisma.sql`
    WITH q AS (
      SELECT DISTINCT ON (cb."sourceKey") cb."sourceKey", (sv.report->>'qualified')::int AS qualified, sv."validatedAt"
      FROM "SourceValidation" sv JOIN "CaptureBatch" cb ON cb.id = sv."captureBatchId"
      -- D-517 : la validation d'une collecte de passe ne qualifie que le neuf (souvent 0) ; la référence est celle du RUN.
      WHERE sv.verdict = 'VALIDATED' AND sv."validatedAt" <= ${at} AND ${notLightPass(Prisma.raw('cb'))}
      ORDER BY cb."sourceKey", sv."validatedAt" DESC)
    SELECT q."sourceKey", s.maison AS label, s.status::text AS status, q.qualified, q."validatedAt",
      (SELECT count(DISTINCT js."jobId") FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
        WHERE js."sourceKey" = q."sourceKey" AND js."isActive" AND js."availabilityHold" IS NULL
          AND (js."expiresAt" IS NULL OR js."expiresAt" > ${at}) AND ${publicJobSql(j, at)})::int AS served,
      (SELECT r.status FROM "SourceRun" r WHERE r."sourceKey" = q."sourceKey" AND ${notLightPass(Prisma.raw('r'))}
        ORDER BY r."ranAt" DESC LIMIT 1) AS "lastRunStatus",
      (SELECT left(r.note, 240) FROM "SourceRun" r WHERE r."sourceKey" = q."sourceKey" AND ${notLightPass(Prisma.raw('r'))}
        ORDER BY r."ranAt" DESC LIMIT 1) AS "lastRunNote"
    FROM q JOIN "Source" s ON s.key = q."sourceKey"
    WHERE q.qualified >= ${KNOWN_SOURCE_FLOOR} AND s.status IN ('ACTIVE', 'PAUSED')`);

  // Le stock : ce que la retenue de disponibilité retire en ce moment, par Maison (jamais oublié par la référence).
  const maskedRows = await db.$queryRaw<Array<{ c: string; n: number }>>(Prisma.sql`
    SELECT j."companyId" AS c, count(*)::int AS n FROM "Job" j
    WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL AND NOT (${publicJobSql(j, at)})
      AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."jobId" = j.id AND js."isActive" AND js."availabilityHold" IS NOT NULL)
    GROUP BY 1`);
  const byMaison = new Map<string, number>();
  for (const row of maskedRows) {
    const maison = canonicalCompany(companies.merges, row.c);
    byMaison.set(maison, (byMaison.get(maison) ?? 0) + row.n);
  }
  const masked: MaskedStock = { total: maskedRows.reduce((s, r) => s + r.n, 0),
    maisons: [...byMaison.entries()].map(([id, count]) => ({ label: companies.names.get(id) ?? id, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)) };

  return { entities: entities.list().filter(e => e.scope !== 'MAISON' || e.key !== ''), knownSources, masked };
}

/** Les RUN photographiés avant `at`, les plus récents ; les Maisons fusionnées depuis sont suivies vers l'absorbante. */
export async function readCoverageHistory(db: Db, at: Date): Promise<HistoryRun[]> {
  const companies = await readCompanies(db);
  const rows = await db.$queryRaw<Array<{ takenAt: Date; scope: string; key: string; label: string; served: number; gravity: string | null }>>`
    SELECT s."takenAt", s.scope, s.key, s.label, s.served, s.gravity FROM "CoverageSnapshot" s
    WHERE s."takenAt" IN (SELECT DISTINCT "takenAt" FROM "CoverageSnapshot" WHERE "takenAt" < ${at} ORDER BY 1 DESC LIMIT ${REFERENCE_RUNS})`;
  const runs = new Map<number, { takenAt: Date; served: Map<string, number>; alerts: Map<string, string>; labels: Map<string, string> }>();
  for (const row of rows) {
    const run = runs.get(row.takenAt.getTime()) ?? { takenAt: row.takenAt, served: new Map(), alerts: new Map(), labels: new Map() };
    runs.set(row.takenAt.getTime(), run);
    const key = row.scope === 'MAISON' ? canonicalCompany(companies.merges, row.key) : row.key;
    const id = entityId(row.scope as EntityScope, key);
    run.served.set(id, (run.served.get(id) ?? 0) + row.served);
    if (key === row.key) run.labels.set(id, row.label);
    else if (!run.labels.has(id)) run.labels.set(id, companies.names.get(key) ?? row.label);
    if (row.gravity) run.alerts.set(id, row.gravity);
  }
  return [...runs.values()];
}

/** Écrit la photographie d'un RUN, d'un bloc. Rejouer le même instant ne duplique rien (unicité instant, portée, clé). */
export async function writeCoverageSnapshot(prisma: PrismaClient, input: { runId: string | null; takenAt: Date; rows: readonly SnapshotRow[] }): Promise<number> {
  const data = input.rows.map(row => ({ runId: input.runId, takenAt: input.takenAt, scope: row.scope, key: row.key,
    label: row.label.slice(0, 200), served: row.served, reference: row.reference, cause: row.cause, gravity: row.gravity }));
  let written = 0;
  for (let i = 0; i < data.length; i += 1000) {
    written += (await prisma.coverageSnapshot.createMany({ data: data.slice(i, i + 1000), skipDuplicates: true })).count;
  }
  return written;
}
