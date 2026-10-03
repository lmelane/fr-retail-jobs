/**
 * Rejoue HORS RÉSEAU une cassette de `record-cassette.mts` avec le lecteur du dépôt et résume la sortie :
 * preuve de liste, couverture des descriptions (≥ 200 caractères), des pays et des lieux.
 *   npx tsx audits/2026-10-03/stock-exceptions/rejouer-cassette.mts --kind=<kind> --config='<json>' --dir=<cassette>
 */
import { installOfflineTransport } from '../../../apps/aggregator/scripts/ops/offline-transport.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const kind = arg('kind'); const dir = arg('dir'); const config = JSON.parse(arg('config') ?? '{}');
if (!kind || !dir) { console.error('usage: --kind= --config= --dir='); process.exit(2); }
installOfflineTransport({ mode: 'replay', dir });
const { ADAPTERS, normalizeAdapterResult } = await import('../../../apps/aggregator/src/ats/index.js');
const { KIND_TO_ATS } = await import('../../../apps/aggregator/src/ats/catalogKinds.js');
const { readEnumeration } = await import('../../../apps/aggregator/src/pipeline/enumerationReading.js');
const result = normalizeAdapterResult(await ADAPTERS[KIND_TO_ATS[kind]!]!(config));
const jobs = result.jobs;
const share = (f: (j: (typeof jobs)[number]) => boolean) => `${jobs.filter(f).length}/${jobs.length}`;
console.log(JSON.stringify({
  jobs: jobs.length, declaredTotal: result.declaredTotal, complete: result.complete, truncated: result.truncated,
  reading: readEnumeration(result), termination: result.enumeration?.termination, issues: result.enumeration?.issues,
  scopes: result.enumeration?.scopes,
  description200: share((j) => (j.description ?? '').length >= 200), country: share((j) => !!j.country), location: share((j) => !!j.location),
  sample: jobs.slice(0, 3).map((j) => ({ id: j.externalId, title: j.title, country: j.country, location: j.location, desc: (j.description ?? '').length, url: j.url })),
}, null, 1));
