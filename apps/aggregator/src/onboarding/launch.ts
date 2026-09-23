import { parseSourceCandidate } from '../connectors/sourceCandidate.js';
import { randomUUID } from 'node:crypto';

/** Qualification and ingestion are distinct persisted runs in the same worker. */
export function ingestionChildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, ...(env.CATWALKS_RUNTIME_PROFILE ? { CATWALKS_RUN_ID: randomUUID() } : {}) };
}

/** Explicit public definition; no hand-written JSON file or implicit DRAFT scan. */
export function sourceLaunchArguments(args: string[]) {
  const values = new Map<string, string>();
  const config: Record<string, unknown> = {};
  const names = ['key', 'name', 'kind', 'careers-url', 'official-domain', 'tier', 'reviewer', 'out-dir', 'job-url-pattern'];
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match) throw new Error('Source definition requires explicit --name=value options');
    const [, name, value] = match;
    if (name === 'setting') {
      const split = value.indexOf('=');
      const key = value.slice(0, split), raw = value.slice(split + 1);
      if (split < 1 || !raw || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || Object.hasOwn(config, key)
        || /password|secret|token|credential|api.?key/i.test(key)) throw new Error('Duplicate, private or invalid source setting');
      // Booleans and finite numbers are useful ATS settings; nested configuration
      // remains an explicit advanced registry operation, never executable text.
      config[key] = raw === 'true' ? true : raw === 'false' ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
      if (typeof config[key] === 'number' && !Number.isFinite(config[key])) throw new Error('Invalid numeric setting');
      if (/^https?:/.test(raw)) publicUrl(raw);
    } else {
      if (!names.includes(name) || values.has(name) || !value.trim()) throw new Error('Unknown, duplicate or empty source option');
      values.set(name, value.trim());
    }
  }
  for (const name of names.filter(n => !['out-dir', 'job-url-pattern'].includes(n))) if (!values.has(name)) throw new Error(`Missing --${name}`);
  const careers = publicUrl(values.get('careers-url')!);
  if (values.has('job-url-pattern')) publicUrl(values.get('job-url-pattern')!.replaceAll('{id}', 'native-id'));
  const domain = values.get('official-domain')!;
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(domain)) throw new Error('An explicit official domain is required');
  const reviewer = values.get('reviewer')!;
  if (reviewer.length > 160 || /[\r\n]/.test(reviewer)) throw new Error('Invalid reviewer');
  const candidate = parseSourceCandidate({ key: values.get('key'), maison: values.get('name'), kind: values.get('kind'),
    config, careersDomain: careers.hostname, tier: values.get('tier'), jobUrlPattern: values.get('job-url-pattern') });
  return { candidate: { ...candidate, domain, domainSource: `explicit definition by ${reviewer}`, portalScope: null },
    reviewer, outDir: values.get('out-dir') };
}

function publicUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Public HTTPS URL required');
  return url;
}
