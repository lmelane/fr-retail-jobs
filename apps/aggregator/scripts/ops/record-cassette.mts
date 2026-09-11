/**
 * ONLINE, once per source: run the REAL adapter (and robots.txt read) and save every response it makes.
 *
 * Nothing is written to any database here — only the cassette. The adapter is reached through the production
 * dispatch table (`ADAPTERS[KIND_TO_ATS[kind]]`), so what gets recorded is exactly what an ingest would receive.
 * Every later replay is therefore offline and deterministic, and an unrecorded request fails loudly.
 *
 * Two forms, because a source being onboarded is not yet in the catalogue:
 *   record-cassette.mts --key=<sourceKey> --dir=<cassette>            configuration read from the Source row
 *   record-cassette.mts --kind=<kind> --config=<json> --dir=<cassette>  configuration given directly
 *
 * The cassette directory is deliberately an argument: cassettes hold third-party response bodies and stay OUT of
 * the repository.
 */
import { PrismaClient } from '@prisma/client';
import { installOfflineTransport, cassetteSize } from './offline-transport.js';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const key = arg('key');
const kindArg = arg('kind');
const dir = arg('dir');
if (!dir || (!key && !kindArg)) {
  console.error('usage: record-cassette.mts (--key=<sourceKey> | --kind=<kind> --config=<json>) --dir=<cassette>');
  process.exit(2);
}

const p = new PrismaClient();
let kind = kindArg;
let config: Record<string, unknown> = JSON.parse(arg('config') ?? '{}');
try {
  if (key) {
    const source = await p.source.findUniqueOrThrow({ where: { key }, select: { kind: true, config: true } });
    kind = source.kind;
    config = source.config as Record<string, unknown>;
  }

  installOfflineTransport({ mode: 'record', dir });
  const { ADAPTERS } = await import('../../src/ats/index.js');
  const { KIND_TO_ATS } = await import('../../src/ats/catalogKinds.js');
  const { readRobots, requestTarget } = await import('../../src/lib/candidateChecks.js');

  // The onboarding path reads robots.txt before it validates; it belongs in the same cassette.
  const target = requestTarget(kind as any, config);
  const robots = await readRobots(target.origin, target.path);

  const type = KIND_TO_ATS[kind as string];
  const adapter = ADAPTERS[type];
  if (!adapter) throw new Error(`no adapter for kind ${kind} (ats ${type})`);
  const result = await adapter(config);
  const jobs = Array.isArray(result) ? result : result.jobs;

  console.log(JSON.stringify({
    dir, kind, atsType: type, robotsVerdict: robots.verdict, robotsTarget: `${target.origin}${target.path}`,
    jobsRead: jobs.length, responsesRecorded: cassetteSize(dir),
    sample: jobs.slice(0, 2).map((j: any) => ({ title: j.title, company: j.company })),
  }, null, 1));
} finally { await p.$disconnect(); }
