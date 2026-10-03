import { installOfflineTransport } from '../../../../apps/aggregator/scripts/ops/offline-transport.ts';
const [kind, cfg, dir] = process.argv.slice(2);
installOfflineTransport({ mode: 'replay', dir });
const { ADAPTERS } = await import('../../../../apps/aggregator/src/ats/index.ts');
const { KIND_TO_ATS } = await import('../../../../apps/aggregator/src/ats/catalogKinds.ts');
const r = await ADAPTERS[KIND_TO_ATS[kind]](JSON.parse(cfg));
const jobs = Array.isArray(r) ? r : r.jobs;
const empty = jobs.filter((j: any) => !j.description || !String(j.description).trim());
const companies: Record<string, number> = {};
for (const j of jobs as any[]) companies[String(j.company)] = (companies[String(j.company)] ?? 0) + 1;
const hosts: Record<string, number> = {};
for (const j of jobs as any[]) { try { const h = new URL(j.url).host; hosts[h] = (hosts[h] ?? 0) + 1; } catch {} }
console.log(JSON.stringify({ jobs: jobs.length, emptyDescription: empty.length, emptySample: empty.slice(0, 12).map((j: any) => [j.externalId, j.title, j.url]), companies, hosts, holds: jobs.filter((j: any) => j.publicationHold).length }, null, 1));
