/**
 * LA TABLE DES CLÉS DE TENANT EFFECTIVES — ce que la porte utilise RÉELLEMENT, source par source.
 *
 * La distinction hostname / tenant ne vaut que si elle arrive jusqu'au chemin opérationnel. Ce programme
 * n'énonce donc pas la règle : il appelle `rateLimitKeyFor`, la fonction que `hostGate` utilise, sur les
 * hôtes RÉELLEMENT observés pendant les runs, et rend la table.
 *
 * usage: db.py readonly npx tsx scripts/ops/tenant-key-table.mts --runs=<id,id,…> [--out=<f.json>]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { rateLimitKeyFor, observedHost } from '../../src/lib/rateLimitKey.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const runs = (arg('runs') ?? '').split(',').map((r) => r.trim()).filter(Boolean);
if (!runs.length) { console.error('usage: tenant-key-table.mts --runs=<id,…>'); process.exit(2); }

const p = new PrismaClient();

/** Les hôtes réellement appelés, lus dans les métriques du run — pas déduits de la configuration. */
const observedByRun: Record<string, string[]> = {};
for (const id of runs) {
  const r = await p.pipelineRun.findUnique({ where: { id }, select: { metrics: true } });
  const hosts = ((r?.metrics as any)?.httpByHost ?? []).map((h: any) => h.host);
  observedByRun[id] = hosts;
}
const allObserved = [...new Set(Object.values(observedByRun).flat())].sort();

/** La configuration de chaque source : hôte configuré et clé explicite éventuelle. */
const sources = await p.source.findMany({
  where: { status: { in: ['ACTIVE', 'PAUSED'] } },
  select: { key: true, kind: true, config: true },
});
const configured = new Map<string, { host: string; explicit: string | null }>();
for (const s of sources) {
  const c: any = s.config ?? {};
  const url = c.portalUrl ?? c.origin ?? c.endpoint ?? c.baseUrl ?? c.url ?? c.listingUrl ?? '';
  let host = '';
  try { host = url ? new URL(String(url)).hostname : (c.domainName ?? c.host ?? c.customer ?? c.tenant ?? '—'); }
  catch { host = String(c.domainName ?? c.host ?? '—'); }
  configured.set(s.key, { host, explicit: c.rateLimitKey ?? null });
}

const rows = allObserved.map((host) => {
  const url = `https://${host}/`;
  const key = rateLimitKeyFor(url);
  const origin = key.startsWith('tenant:') ? 'TENANT_RECONNU'
    : key.startsWith('explicit:') ? 'CLÉ_EXPLICITE' : 'FALLBACK_HOSTNAME';
  return { hostnameObserved: observedHost(url), rateLimitKey: key, origin,
           fallback: origin === 'FALLBACK_HOSTNAME' };
});

/** Le regroupement effectif : combien d'hôtes distincts partagent une même clé. */
const grouped: Record<string, string[]> = {};
for (const r of rows) (grouped[r.rateLimitKey] ??= []).push(r.hostnameObserved);

const payload = {
  runs, observedHosts: allObserved.length,
  distinctRateLimitKeys: Object.keys(grouped).length,
  groups: Object.entries(grouped).map(([key, hosts]) => ({ rateLimitKey: key, hosts, count: hosts.length }))
    .sort((a, b) => b.count - a.count),
  rows,
  configuredSample: [...configured.entries()].slice(0, 0),
};
const out = arg('out');
if (out) writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(JSON.stringify(payload, null, 1));
await p.$disconnect();
