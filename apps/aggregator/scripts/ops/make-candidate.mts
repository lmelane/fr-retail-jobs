/**
 * CLONE ONLY: turn an existing source back into a NOT-YET-INTEGRATED candidate, so the onboarding path starts
 * where it must — no Source row, no representations, no certification.
 *
 * Why an existing source rather than a fictional tenant: its configuration and its recorded responses are real,
 * and the demonstration must exercise the pipeline, not a made-up board. An invented subdomain
 * (`lightyear.recruitee.com`) answered HTTP 404 and proved nothing.
 *
 * The removal is written to a file so the clone's state before and after is auditable, and orphan Jobs left
 * behind are DEACTIVATED, not deleted — history is preserved even on a clone.
 *
 * usage: make-candidate.mts <keys,comma> --out=<file.json>
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const keys = (process.argv[2] ?? '').split(',').filter((k) => k && !k.startsWith('--'));
const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
if (!keys.length || !out) { console.error('usage: make-candidate.mts <keys,comma> --out=<file.json>'); process.exit(2); }

const p = new PrismaClient();
try {
  const [{ current_database: db }]: any[] = await p.$queryRaw`SELECT current_database()`;
  if (!/replay|clone|test/.test(db)) throw new Error(`refusing: ${db} is not a clone/replay/test database`);

  const removed: unknown[] = [];
  for (const key of keys) {
    const source = await p.source.findUnique({ where: { key } });
    const before: any[] = await p.$queryRaw`
      SELECT COUNT(*)::int representations, COUNT(DISTINCT j.id)::int jobs FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."sourceKey" = ${key} AND js."isActive" AND j."isActive"`;
    const identifiers: any[] = await p.$queryRaw`
      SELECT js.id AS job_source_id, js."externalId", j.id AS job_id FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."sourceKey" = ${key}`;

    await p.jobSource.deleteMany({ where: { sourceKey: key } });
    await p.sourceIdentityReview.deleteMany({ where: { sourceKey: key } });
    await p.sourceRun.deleteMany({ where: { sourceKey: key } });
    await p.source.deleteMany({ where: { key } });

    const orphansDeactivated = await p.$executeRaw`
      UPDATE "Job" j SET "isActive" = false WHERE j."isActive"
        AND NOT EXISTS (SELECT 1 FROM "JobSource" x WHERE x."jobId" = j.id AND x."isActive")`;

    removed.push({ key, removedConfig: source?.config, removedKind: source?.kind, before: before[0], identifiers, orphansDeactivated });
  }
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), database: db, removed }, null, 1));
  console.log(JSON.stringify(removed.map((r: any) => ({ ...r, identifiers: r.identifiers.length })), null, 1));
} finally { await p.$disconnect(); }
