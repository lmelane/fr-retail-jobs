// Executed through Railway SSH. One consistent, read-only transaction; public
// search fields only. Emits a gzipped NDJSON archive encoded as base64.
const { PrismaClient } = require('@prisma/client');
const { createGzip } = require('node:zlib');
const { once } = require('node:events');
const db = new PrismaClient();
const gzip = createGzip({ level: 6 });
const chunks = [];
gzip.on('data', chunk => chunks.push(chunk));
const finished = once(gzip, 'end');
const emit = async value => {
  if (!gzip.write(JSON.stringify(value) + '\n')) await once(gzip, 'drain');
};

(async () => {
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const [{ at }] = await tx.$queryRawUnsafe('SELECT transaction_timestamp() AS at');
    const state = await tx.occupationState.findUnique({ where: { id: 'active' } });
    const release = state && await tx.occupationRelease.findUnique({ where: { id: state.releaseId } });
    await emit({ type: 'metadata', schemaVersion: 1, asOf: at.toISOString(),
      transaction: 'REPEATABLE READ, READ ONLY', occupationRelease: release,
      sectorConcepts: await tx.sectorConcept.findMany({ orderBy: { code: 'asc' } }),
      companies: await tx.company.findMany({ orderBy: { id: 'asc' }, select: {
        id: true, name: true, canonicalKey: true, parentGroup: true,
        parentGroupId: true, mergedIntoId: true, sectorCodes: true, domain: true,
      } }),
      aliases: await tx.companyAlias.findMany({ where: { reviewId: { not: null } },
        orderBy: { id: 'asc' }, select: { id: true, displayName: true, companyId: true,
          sourceKey: true, normalizedName: true, reviewId: true } }),
    });
    // Same predicate as packages/db/availability.ts; no sector/occupation gate.
    const available = { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: at } }] };
    const where = { isActive: true, mergedIntoId: null, sources: { some: available } };
    let cursor; let aggregate = 0;
    for (;;) {
      const rows = await tx.job.findMany({ where, take: 500, orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: {
          id: true, companyId: true, externalId: true, source: true,
          title: true, rawTitle: true, description: true, department: true,
          countryCode: true, countryIntegrity: true, city: true, location: true,
          adminArea1: true, postalCode: true, workplaceType: true, language: true,
          employmentTerm: true, workTime: true, programType: true,
          postedAt: true, firstSeenAt: true, url: true,
          occupationCode: true, jobFunction: true, occupationStatus: true,
          occupationReleaseId: true, seniority: true,
          sources: { where: available, orderBy: { id: 'asc' }, select: {
            id: true, sourceKey: true, externalId: true, url: true,
            captureBatchId: true, captureOutputId: true, expiresAt: true,
          } },
        } });
      if (!rows.length) break;
      for (const job of rows) await emit({ type: 'job', job });
      aggregate += rows.length; cursor = rows.at(-1).id;
    }
    const directs = await tx.directOffer.findMany({
      where: { eligible: true, OR: [{ validThrough: null }, { validThrough: { gt: at } }] },
      orderBy: { id: 'asc' }, select: { id: true, title: true, company: true,
        description: true, countryCode: true, city: true, location: true,
        postalCode: true, workplaceType: true, language: true, sectorCodes: true,
        employmentTerm: true, workTime: true, programType: true, postedAt: true,
        receivedAt: true, validThrough: true, applyUrl: true, occupationLabel: true,
      },
    });
    for (const job of directs) await emit({ type: 'direct', job });
    await emit({ type: 'complete', aggregate, direct: directs.length,
      databaseAggregateCount: await tx.job.count({ where }) });
  }, { isolationLevel: 'RepeatableRead', timeout: 300000 });
  gzip.end(); await finished;
  process.stdout.write(Buffer.concat(chunks).toString('base64') + '\n');
})().catch(error => {
  console.error('Snapshot failed:', error.message); process.exitCode = 1;
}).finally(() => db.$disconnect());
