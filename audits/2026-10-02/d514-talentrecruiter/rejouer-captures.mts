/**
 * D-514 §4 — lecture seule : rejoue HORS RÉSEAU les captures GANNI (TalentRecruiter) avec le code de cette copie et dit,
 * poste par poste, ce que la collecte en fait (type natif, annonces, retenue, retrait) et ce que la validation native
 * compterait (qualifié, retenu, refusé et son motif), puis le verdict qu'elle rendrait au regard de sa tolérance.
 * Rejouer avant / après le correctif sur la même capture est la mesure du lot.
 *
 * Usage (depuis la racine du dépôt) :
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx audits/2026-10-02/d514-talentrecruiter/rejouer-captures.mts <captureBatchId>…
 * Aucune écriture : `replayExtraction` ne fait que lire `CaptureBatch`, `RawCapture` et les blobs.
 */
import { PrismaClient } from '@prisma/client';
import { replayExtraction } from '../../../apps/aggregator/src/capture/batch.js';
import { fetchAtsJobs } from '../../../apps/aggregator/src/ats/index.js';
import { KIND_TO_ATS } from '../../../apps/aggregator/src/ats/catalogKinds.js';
import { captureConfig } from '../../../apps/aggregator/src/capture/config.js';
import { effectiveSourceConfig } from '../../../apps/aggregator/src/connectors/sourceConfig.js';
import { recoverRetainedPublication } from '../../../apps/aggregator/src/publication/recovery.js';
import { unqualifiedAllowanceFor } from '../../../apps/aggregator/src/connectors/sourceCertification.js';

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
try {
  for (const id of process.argv.slice(2)) {
    const [b] = await p.$queryRawUnsafe<{ sourceKey: string; startedAt: Date; payload: string }[]>(
      `SELECT b."sourceKey", b."startedAt", r.payload::text AS payload FROM "CaptureBatch" b JOIN "SourceRevision" r ON r.id = b."sourceRevisionId" WHERE b.id = $1`, id);
    const rev = JSON.parse(b.payload), config = captureConfig(effectiveSourceConfig(rev.config));
    const r = await replayExtraction(p, id, () => fetchAtsJobs(KIND_TO_ATS[rev.kind] as never, config));
    let qualified = 0, held = 0, rejected = 0; const reasons: Record<string, number> = {};
    const rows = r.jobs.map(job => {
      const position = (job.raw as { position?: { ProjectType?: string; Advertisements?: unknown[] } }).position;
      let verdict: string;
      if (job.publicationHold || job.publicationWithdrawnAt) { held++; verdict = 'RETENU'; }
      else {
        const rec = recoverRetainedPublication(rev.kind, job.raw, { externalId: job.externalId, url: job.url, observedAt: b.startedAt, config });
        if (rec.status === 'RECOVERABLE') { qualified++; verdict = 'QUALIFIÉ'; } else { rejected++; reasons[rec.reason] = (reasons[rec.reason] ?? 0) + 1; verdict = `REFUSÉ ${rec.reason}`; }
      }
      return [job.externalId, position?.ProjectType, Array.isArray(position?.Advertisements) ? `annonces=${position!.Advertisements!.length}` : 'annonces absentes', job.description ? 'desc' : 'sans desc',
        job.publicationHold ?? '-', job.publicationWithdrawnAt ? 'retrait' : '-', verdict].join(' | ');
    });
    const unqualified = rejected + (r.rejectedRows ?? []).length, allowance = unqualifiedAllowanceFor(r.jobs.length);
    const withdrawn = r.jobs.filter(job => job.publicationWithdrawnAt).length;
    console.log(`\n== ${b.sourceKey} ${id} (${b.startedAt.toISOString()})`);
    for (const row of rows) console.log('  ' + row);
    console.log('  collecte :', JSON.stringify({ jobs: r.jobs.length, complete: r.complete, blockers: r.enumeration?.blockers, issues: r.enumeration?.issues }));
    console.log('  validation :', JSON.stringify({ qualified, held, rejected, reasons, allowance,
      withdrawn, verdict: unqualified <= allowance && qualified > 0 ? 'VALIDATED (tolérance tenue)' : 'REJECTED (tolérance dépassée)' }));
  }
} finally { await p.$disconnect(); }
