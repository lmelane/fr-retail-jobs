/**
 * Rejoue HORS RÉSEAU une cassette enregistrée par `record-cassette.mts` (lecteur réel, réponses réelles) et imprime la
 * preuve que rend le lecteur générique, passée par `normalizeAdapterResult` comme à la collecte. Aucune base.
 *
 *   npx tsx audits/2026-10-03/stock-exceptions/ghost/rejouer-cassette.mts --dir=<cassette> --config='<json>'
 *
 * Partagé par Sioux et Ghost (D-522 §6) ; les cassettes restent hors du dépôt (corps tiers).
 */
import { installOfflineTransport } from '../../../../apps/aggregator/scripts/ops/offline-transport.js';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dir = arg('dir');
const config = JSON.parse(arg('config') ?? 'null') as Record<string, unknown> | null;
if (!dir || !config) { console.error("usage: rejouer-cassette.mts --dir=<cassette> --config='<json>'"); process.exit(2); }

const transport = installOfflineTransport({ mode: 'replay', dir });
const { fetchGenericJsonLdJobs } = await import('../../../../apps/aggregator/src/ats/adapters/genericJsonLd.js');
const { normalizeAdapterResult } = await import('../../../../apps/aggregator/src/ats/index.js');
const result = normalizeAdapterResult(await fetchGenericJsonLdJobs(config));
console.log(JSON.stringify({
  config, jobs: result.jobs.length, declaredTotal: result.declaredTotal, complete: result.complete, truncated: result.truncated,
  verdict: result.enumerationVerdict, method: result.enumeration?.method, termination: result.enumeration?.termination,
  issues: result.enumeration?.issues, canonicalIds: result.enumeration?.pageEvidence?.map((page) => page.canonicalIds),
  publisherCounter: result.enumeration?.pageEvidence?.[0]?.publisherCounter, pageSha256: result.enumeration?.pageEvidence?.[0]?.sha256,
  replayedRequests: transport.calls(),
}, null, 1));
