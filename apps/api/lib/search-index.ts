import { Prisma, prisma } from '@catwalks/db';
import { loadOccupationTaxonomy } from '@catwalks/db/occupations';
import { snapshotModel, type NativeJob, type SnapshotMetadata } from './search-model';
import { SEARCH_VOCABULARY_VERSION } from './search-vocabulary';

// Bump for any projection/normalization change. Old generations remain usable
// by the previous application during a rolling release and a bounded rollback.
// 4 — a direct offer's document also carries its indexed text (D-455: univers words) and, like an aggregated
// offer's, falls back on the taxonomy occupation of its title when the title names no role (D-444).
// 5 — les métiers d'un document sont ceux de ses colonnes : son code et ses métiers lus dans l'intitulé (`titleRoles`,
// D-475 point 38), jamais une relecture de tout le vocabulaire (sous-lot 2B-4).
export const SEARCH_VERSION = `search-5-${SEARCH_VOCABULARY_VERSION}`;
type Database = Prisma.TransactionClient;
type Context = { revision: string; model: ReturnType<typeof snapshotModel> };
let cached: Context | undefined;

export async function getSearchContext(db: Database = prisma): Promise<Context> {
  const [state] = await db.$queryRaw<{ revision: bigint }[]>`SELECT revision FROM "SearchMetadata" WHERE id='active'`;
  const revision = String(state.revision);
  if (cached?.revision === revision) return cached;
  const [taxonomy, companies, aliases, sectors] = await Promise.all([
    loadOccupationTaxonomy(db),
    db.company.findMany({ select: { id: true, name: true, parentGroup: true, parentGroupId: true, mergedIntoId: true, sectorCodes: true } }),
    db.companyAlias.findMany({ where: { reviewId: { not: null } }, select: { companyId: true, displayName: true, reviewId: true } }),
    db.sectorConcept.findMany({ select: { code: true, labels: true } }),
  ]);
  const metadata = { asOf: new Date().toISOString(), occupationRelease: { id: taxonomy.manifest.id, manifest: taxonomy.manifest }, companies, aliases, sectorConcepts: sectors } as SnapshotMetadata;
  const context = { revision, model: snapshotModel(metadata) };
  // Recheck after concurrent metadata writes; never label mixed state as current.
  const [after] = await db.$queryRaw<{ revision: bigint }[]>`SELECT revision FROM "SearchMetadata" WHERE id='active'`;
  if (String(after.revision) !== revision) return getSearchContext(db);
  cached = context;
  return context;
}

/** Register once, atomically with the initial durable backlog. No native row is
 * changed. Concurrent inserts are serialized by the trigger's FK generation lock. */
export async function initializeSearchIndex() {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('search-generation',0))::text`;
    // Block posting writes only during initial enumeration, so no insert can
    // miss the new generation between its snapshot and the initial backlog.
    await tx.$executeRaw`LOCK TABLE "Job", "DirectOffer" IN SHARE MODE`;
    const inserted = await tx.$executeRaw`INSERT INTO "SearchGeneration"(version) VALUES (${SEARCH_VERSION}) ON CONFLICT DO NOTHING`;
    if (!inserted) return;
    await tx.$executeRaw`INSERT INTO "SearchPending"(version,id)
      SELECT ${SEARCH_VERSION},id FROM "Job" UNION ALL SELECT ${SEARCH_VERSION},'cw_'||id FROM "DirectOffer"`;
  }, { timeout: 30000 });
}

/** One bounded transaction. Queue row locks + ON CONFLICT UPDATE in enqueue
 * prevent losing an edit concurrent with indexing. A crash rolls back both
 * projection and acknowledgement; other API processes use SKIP LOCKED. */
export async function drainSearchIndex(batchSize = 128): Promise<number> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw Error('Invalid search batch size');
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT revision FROM "SearchMetadata" WHERE id='active' FOR SHARE`;
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "SearchPending" WHERE version=${SEARCH_VERSION}
      ORDER BY "queuedAt",id LIMIT ${batchSize} FOR UPDATE SKIP LOCKED`;
    if (!rows.length) {
      await tx.$executeRaw`UPDATE "SearchGeneration" SET "readyAt"=now() WHERE version=${SEARCH_VERSION} AND "readyAt" IS NULL
        AND NOT EXISTS(SELECT 1 FROM "SearchPending" WHERE version=${SEARCH_VERSION})`;
      return 0;
    }
    const { model } = await getSearchContext(tx);
    const ids = rows.map(r => r.id);
    const [jobs, directs] = await Promise.all([
      tx.job.findMany({ where: { id: { in: ids.filter(id => !id.startsWith('cw_')) } }, select: {
        id: true, title: true, rawTitle: true, companyId: true, description: true, countryCode: true, city: true, location: true,
        department: true, occupationCode: true, titleRoles: true, jobFunction: true, postedAt: true, firstSeenAt: true,
        employmentTerm: true, workTime: true, programType: true, language: true,
      } }),
      // Le document d'une offre directe est remis en file quand une colonne qui le nourrit change : intitulé, description,
      // employeur, lieu, secteurs, contrat (migration `20260924120000`), pays (`20260924130000`), texte indexé
      // (`20260925080000`), métier (`20260925090000`). `companyId` n'est volontairement pas lue ici (la Maison se
      // retrouve par son nom, le groupe se lit à la requête) : aucun déclencheur ne la suit, la lire exigerait le sien.
      tx.directOffer.findMany({ where: { id: { in: ids.filter(id => id.startsWith('cw_')).map(id => id.slice(3)) } }, select: {
        id: true, title: true, company: true, description: true, countryCode: true, city: true, location: true, sectorCodes: true,
        postedAt: true, receivedAt: true, employmentTerm: true, workTime: true, programType: true, language: true, searchText: true,
        occupationCode: true, titleRoles: true,
      } }),
    ]);
    const documents = [...jobs.map(j => model.document(JSON.parse(JSON.stringify(j)) as NativeJob)),
      ...directs.map(j => model.document(JSON.parse(JSON.stringify(j)) as NativeJob, true))];
    const existing = documents.map(d => d.id);
    const removed = ids.filter(id => !existing.includes(id));
    if (removed.length) await tx.$executeRaw`DELETE FROM "SearchDocument" WHERE version=${SEARCH_VERSION} AND id IN (${Prisma.join(removed)})`;
    if (documents.length) await tx.$executeRaw`INSERT INTO "SearchDocument"(version,id,document)
      SELECT ${SEARCH_VERSION},doc->>'id',doc FROM jsonb_array_elements(${JSON.stringify(documents)}::jsonb) doc
      ON CONFLICT(version,id) DO UPDATE SET document=EXCLUDED.document,"indexedAt"=now()`;
    await tx.$executeRaw`DELETE FROM "SearchPending" WHERE version=${SEARCH_VERSION} AND id IN (${Prisma.join(ids)})`;
    return rows.length;
  }, { maxWait: 10000, timeout: 30000 });
}

/** D-475, plan §3.6 (sous-lot 2B-5) : un changement de taxonomie ou de secteurs pose une demande de remise en file
 * (`SearchRequeue`, migration 20260930090000) au lieu de tout le stock d'un coup. L'indexeur la sert par TRANCHES,
 * la suivante partant quand la file de sa génération n'a plus d'élément de plus de `AGE_MAX_FILE_S` secondes (débit
 * mesuré : environ 327 documents par seconde, une tranche de 10 000 se vide en une trentaine de secondes, sous le
 * seuil de 300 s qui rend la recherche indisponible). Les offres agrégées d'abord, puis les offres Catwalks. Rend le
 * nombre d'offres remises en file (0 : rien à faire, ou file encore trop ancienne). */
export const TRANCHE_REMISE_EN_FILE = 10_000, AGE_MAX_FILE_S = 60;
export async function advanceSearchRequeue(tranche = TRANCHE_REMISE_EN_FILE): Promise<number> {
  if (!Number.isSafeInteger(tranche) || tranche < 1 || tranche > 50_000) throw Error('Invalid search requeue tranche');
  return prisma.$transaction(async tx => {
    const [demande] = await tx.$queryRaw<{ phase: 'job' | 'direct'; cursor: string | null }[]>`SELECT phase, cursor FROM "SearchRequeue"
      WHERE version=${SEARCH_VERSION} AND "doneAt" IS NULL FOR UPDATE SKIP LOCKED`;
    if (!demande) return 0;
    const [{ encombree }] = await tx.$queryRaw<{ encombree: boolean }[]>`SELECT EXISTS(SELECT 1 FROM "SearchPending"
      WHERE version=${SEARCH_VERSION} AND "queuedAt" < now() - make_interval(secs => ${AGE_MAX_FILE_S})) AS encombree`;
    if (encombree) return 0;
    const [table, prefixe] = demande.phase === 'job' ? [Prisma.sql`"Job"`, ''] : [Prisma.sql`"DirectOffer"`, 'cw_'];
    const [t] = await tx.$queryRaw<{ n: number; dernier: string | null }[]>`
      WITH t AS (SELECT id FROM ${table} WHERE id > ${demande.cursor ?? ''} ORDER BY id LIMIT ${tranche}),
      ins AS (INSERT INTO "SearchPending"(version,id) SELECT ${SEARCH_VERSION}, ${prefixe} || id FROM t
        ON CONFLICT(version,id) DO UPDATE SET id=EXCLUDED.id RETURNING 1)
      SELECT (SELECT count(*)::int FROM ins) AS n, (SELECT max(id) FROM t) AS dernier`;
    const epuisee = t.n < tranche;
    const phase = !epuisee ? demande.phase : demande.phase === 'job' ? 'direct' : 'done';
    await tx.$executeRaw`UPDATE "SearchRequeue" SET phase=${phase}, cursor=${epuisee ? null : t.dernier},
      "doneAt"=${phase === 'done' ? Prisma.sql`now()` : Prisma.sql`NULL`} WHERE version=${SEARCH_VERSION}`;
    return t.n;
  }, { maxWait: 10000, timeout: 30000 });
}

export async function searchIndexStatus() {
  const [row] = await prisma.$queryRaw<{ pending: number; oldestSeconds: number | null; documents: number; registered: boolean; ready: boolean }[]>`
    SELECT (SELECT count(*)::int FROM "SearchPending" WHERE version=${SEARCH_VERSION}) AS pending,
      (SELECT extract(epoch FROM now()-min("queuedAt"))::float8 FROM "SearchPending" WHERE version=${SEARCH_VERSION}) AS "oldestSeconds",
      (SELECT count(*)::int FROM "SearchDocument" WHERE version=${SEARCH_VERSION}) AS documents,
      EXISTS(SELECT 1 FROM "SearchGeneration" WHERE version=${SEARCH_VERSION}) AS registered,
      EXISTS(SELECT 1 FROM "SearchGeneration" WHERE version=${SEARCH_VERSION} AND "readyAt" IS NOT NULL) AS ready`;
  return { version: SEARCH_VERSION, ...row };
}

/** Refuse a partial bootstrap or a stalled projection even for callers which
 * reach the process directly instead of passing through Railway readiness. */
export async function requireSearchIndex() {
  const [row] = await prisma.$queryRaw<{ ready:boolean; stale:boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM "SearchGeneration" WHERE version=${SEARCH_VERSION} AND "readyAt" IS NOT NULL) ready,
      EXISTS(SELECT 1 FROM "SearchPending" WHERE version=${SEARCH_VERSION} AND "queuedAt" < now()-interval '300 seconds') stale`;
  if (!row.ready || row.stale) throw new Error('Search projection unavailable');
}

/** Explicit retirement after the previous application and rollback window have
 * ended. Current generation is never removable through this operation. */
export async function retireSearchGeneration(version:string) {
  if (version === SEARCH_VERSION || !/^search-[a-zA-Z0-9-]+$/.test(version)) throw Error('Cannot retire current or invalid search generation');
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='2s'`;
    // Native enqueue statements retain AccessShare on this table until commit.
    // Wait for them before deleting, and prevent later producers from selecting
    // a retiring version. The old indexer must already be stopped (CLI contract).
    await tx.$executeRaw`LOCK TABLE "SearchGeneration" IN ACCESS EXCLUSIVE MODE`;
    return tx.$executeRaw`DELETE FROM "SearchGeneration" WHERE version=${version}`;
  }, { timeout: 30000 });
}
