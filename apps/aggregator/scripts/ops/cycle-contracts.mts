/**
 * LES DEUX CONTRATS D'UNE COLLECTE, LUS SUR LA BASE RÉELLE — lecture seule.
 *
 * Un module testé n'est pas un contrat opérationnel : tant que personne ne le nourrit avec l'état réel, il ne
 * protège rien. Ce programme lit, pour chaque source, sa CAPTURE ATTESTANTE — la dernière collecte admise,
 * scellée et achevée de la révision courante, exactement comme le refresh la lit — puis réconcilie ses
 * ensembles d'identifiants par `persistenceContract`.
 *
 * TOUT VIENT DE LA MÊME COLLECTE : identifiants observés du manifeste scellé, retenues, échecs d'écriture et
 * lignes écartées du rapport de fin d'ingestion, rejets du manifeste. Une retenue historique n'est pas une
 * retenue de cette collecte. `SourceRun` et `PipelineEvent` ne sont jamais lus : ce sont des indicateurs.
 *
 * usage: cycle-contracts.mts --keys=<k1,k2,…> [--out=<f.json>]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { persistenceContract, type CycleSets } from '../../src/pipeline/persistenceContract.js';
import { readAttestingCapture } from '../../src/pipeline/attestingCapture.js';
import { objectStoreConfigured, objectStoreFromEnv } from '../../src/retention/objectStore.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const keys = (arg('keys') ?? '').split(',').map((k) => k.trim()).filter(Boolean);
if (!keys.length) { console.error('usage: cycle-contracts.mts --keys=<k1,k2,…> [--out=<f.json>]'); process.exit(2); }

const p = new PrismaClient({ log: [] });
const store = objectStoreConfigured() ? objectStoreFromEnv() : undefined;
try {
  const now = new Date();
  const report: any[] = [];
  for (const sourceKey of keys) {
    const attesting = await readAttestingCapture(p, sourceKey, now, store);
    if (!attesting.ok) { report.push({ source: sourceKey, captureBatchId: attesting.captureBatchId, verdict: null, reasons: attesting.reasons }); continue; }
    const { capture } = attesting;

    /** Ce qui existe RÉELLEMENT en base après cette collecte. */
    const persisted: any[] = await p.$queryRaw(Prisma.sql`
      SELECT array_agg(js."externalId") AS ids FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."isActive" AND j."isActive" AND js."sourceKey" = ${sourceKey}`);

    const sets: CycleSets = {
      sourceKey, captureBatchId: capture.captureBatchId,
      canonicalObservedIds: capture.evidence.canonicalSet,
      persistedJobSourceExternalIds: persisted[0]?.ids ?? [],
      heldIds: [...capture.dispositions.held], writeFailedIds: [...capture.dispositions.writeFailed],
      rejectedIds: [...capture.dispositions.rejected], collectionErrorIds: [], skippedIds: [...capture.dispositions.skipped],
      unattributableWriteFailures: capture.dispositions.anonymous,
    };

    /**
     * Un adaptateur qui ne déclare PAS le contrat canonique n'est pas jugé sur l'égalité des ensembles : il
     * n'a rien promis. Il reste simplement incapable de prouver une absence, ce que la prévisualisation dit.
     */
    const verdict = capture.evidence.canonicalContractDeclared ? persistenceContract(sets) : {
      satisfied: false, absenceProvable: false,
      violations: ['contrat canonique non déclaré par l\'adaptateur : rien à réconcilier'],
      observedNotAccountedFor: [], persistedNotObserved: [],
    };

    report.push({
      source: sourceKey, captureBatchId: capture.captureBatchId, startedAt: capture.startedAt, completedAt: capture.completedAt,
      termination: capture.evidence.termination,
      canonicalContractDeclared: capture.evidence.canonicalContractDeclared,
      canonicalAbsenceProofUsable: capture.evidence.canonicalAbsenceProofUsable ?? null,
      facts: capture.facts,
      counts: {
        observed: sets.canonicalObservedIds.length, persisted: sets.persistedJobSourceExternalIds.length,
        published: capture.dispositions.published.size, held: sets.heldIds.length, writeFailed: sets.writeFailedIds.length,
        skipped: sets.skippedIds!.length, rejected: sets.rejectedIds.length, anonymousFailures: sets.unattributableWriteFailures,
      },
      verdict,
    });
  }

  const out = arg('out');
  if (out) writeFileSync(out, JSON.stringify({ at: now.toISOString(), report }, null, 2));

  console.log('CONTRAT DE PERSISTANCE, par source et par collecte attestante :');
  for (const r of report) {
    const v = r.verdict;
    console.log(`  ${v?.satisfied ? '✓' : '✗'} ${String(r.source).padEnd(26)} capture=${String(r.captureBatchId ?? '—').slice(0, 8)} `
      + `obs=${r.counts?.observed ?? '—'} pers=${r.counts?.persisted ?? '—'} held=${r.counts?.held ?? '—'} `
      + `wf=${r.counts?.writeFailed ?? '—'} rej=${r.counts?.rejected ?? '—'} anon=${r.counts?.anonymousFailures ?? '—'}`);
    for (const violation of v?.violations ?? r.reasons ?? []) console.log(`      · ${violation}`);
  }
  const provable = report.filter((r) => r.verdict?.absenceProvable).map((r) => r.source);
  console.log(`\nsources pouvant prouver une absence : ${provable.length}/${report.length}`
    + (provable.length ? ` — ${provable.join(', ')}` : ''));
} finally {
  await p.$disconnect();
}
