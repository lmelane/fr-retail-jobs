import { readFileSync } from 'node:fs';
import { parseGreenhouseJob } from '../../../../apps/aggregator/src/ats/adapters/greenhouse.js';
const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const jobs = d.jobs.map((j: any) => ({ j, n: parseGreenhouseJob(j) }));
const without = jobs.filter((x: any) => !x.n.country);
console.log('total', jobs.length, 'sans pays', without.length);
const shapes = new Map<string, number>();
for (const { j } of without) { const k = `${j.location?.name} | offices=${JSON.stringify((j.offices ?? []).map((o: any) => [o.name, o.location]))}`; shapes.set(k, (shapes.get(k) ?? 0) + 1); }
console.log([...shapes].sort((a, b) => b[1] - a[1]).slice(0, 25));
