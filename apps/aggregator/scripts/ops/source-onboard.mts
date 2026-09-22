import { exitIfPipelinePaused } from '../../src/lib/pipelinePause.js';
/** One entry point for candidate registration and independent, reviewable qualification steps. */
import { PrismaClient } from '@prisma/client';
import { sourceFailure } from '../../src/onboarding/failure.js';
import { parseSourceArguments } from '../../src/onboarding/arguments.js';
import { sourceIdentityProfile, sourceStatus, validationReport } from '../../src/onboarding/status.js';
import { parseSourceCandidate, registerSourceCandidate } from '../../src/connectors/sourceCandidate.js';
import { recordSourceIdentityReview } from '../../src/connectors/sourceIdentity.js';
import { recordSourceAccessDecision } from '../../src/connectors/sourceAccess.js';
import { captureSourceForValidation, validateCapturedSource } from '../../src/connectors/sourceValidation.js';
import { captureSourceEvidence } from '../../src/capture/sourceEvidence.js';
import { inspectSourceRelation } from '../../src/connectors/sourceRelation.js';
import { promoteSource } from '../../src/connectors/sourceStore.js';
import { readInputJson, writePrivateFile } from '../../src/lib/privateFile.js';
import { objectStoreConfigured, objectStoreFromEnv } from '../../src/retention/objectStore.js';
import { closeBrowser } from '../../src/lib/browser.js';

const { command, target, options, apply } = parseSourceArguments(process.argv.slice(2));
if (apply) exitIfPipelinePaused(`source-onboard:${command}`);
const db = new PrismaClient({ errorFormat: 'minimal', log: [] });
try {
  let result: unknown;
  if (command === 'register') {
    const candidate = parseSourceCandidate(readInputJson(target, 2 * 1024 * 1024));
    const registration = await registerSourceCandidate(db, candidate, apply);
    result = { mode: apply ? 'APPLY' : 'PREVIEW', created: registration.created, willCreate: registration.willCreate,
      key: registration.key, tenantKey: registration.tenantKey,
      status: registration.source?.status ?? null, sourceRevisionId: registration.source?.currentRevisionId ?? null };
  } else if (command === 'profile') {
    result = await sourceIdentityProfile(db, target);
  } else if (command === 'identity') {
    const document = readInputJson(target, 2 * 1024 * 1024);
    result = await recordSourceIdentityReview(db, document as Parameters<typeof recordSourceIdentityReview>[1], apply,
      objectStoreConfigured() ? objectStoreFromEnv() : undefined);
  } else if (command === 'access') {
    result = await recordSourceAccessDecision(db, readInputJson(target, 128_000), apply,
      objectStoreConfigured() ? objectStoreFromEnv() : undefined);
  } else if (command === 'evidence') {
    result = await captureSourceEvidence(db, target, { revisionId: options.revision,
      purpose: options.purpose === 'identity' ? 'SOURCE_IDENTITY' : 'SOURCE_ACCESS',
      url: options.url, deadlineMs: Number(options['deadline-ms'] ?? 60_000) },
      objectStoreConfigured() ? objectStoreFromEnv() : undefined);
  } else if (command === 'relation') {
    result = await inspectSourceRelation(db, target, { captureBatchId: options.capture, officialDomain: options['official-domain'] },
      objectStoreConfigured() ? objectStoreFromEnv() : undefined);
    if ((result as Awaited<ReturnType<typeof inspectSourceRelation>>).verdict !== 'LINK_MATCHED') process.exitCode = 1;
  } else if (command === 'collect' || command === 'validate') {
    const store = objectStoreConfigured() ? objectStoreFromEnv() : undefined;
    const validation = command === 'collect'
      ? await captureSourceForValidation(db, target, Number(options['deadline-ms'] ?? 600_000), store)
      : await validateCapturedSource(db, target, store);
    result = validationReport(validation);
    if (validation.verdict !== 'VALIDATED') process.exitCode = 1;
  } else if (command === 'promote') {
    result = await promoteSource(db, target, options.revision);
  } else {
    result = await sourceStatus(db, target);
  }
  const json = JSON.stringify(result, null, 2) + '\n';
  if (options.out) writePrivateFile(options.out, json);
  console.log(json);
} catch (error) {
  console.error(JSON.stringify(sourceFailure(error)));
  process.exitCode = 1;
} finally { await closeBrowser().catch(() => undefined); await db.$disconnect(); }
