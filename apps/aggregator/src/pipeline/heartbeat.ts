import { log } from '../observability/logger.js';
/** Uses the existing check. No management API or change to alert integrations.
 * Never include the credential-bearing ping URL in logs, including on errors. */
export async function pingHeartbeat(ok: boolean | 'start'): Promise<'pinged' | 'skipped' | 'failed'> {
  const url = process.env.HEALTHCHECK_PING_URL;
  if (!url) return 'skipped';
  try {
    const base = new URL(url);
    const localWitness = !process.env.RAILWAY_PROJECT_ID && !process.env.CATWALKS_RUNTIME_PROFILE &&
      base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname);
    if ((!localWitness && (base.protocol !== 'https:' || base.hostname !== 'hc-ping.com' || base.port)) || base.username || base.password || base.search || base.hash)
      throw new Error('Invalid heartbeat endpoint');
    const target = `${url.replace(/\/$/, '')}${ok === 'start' ? '/start' : ok ? '' : '/fail'}`;
    const response = await fetch(target, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return 'pinged';
  } catch {
    // Return an explicit failure. Operational entrypoints refuse a healthy
    // completion when a configured monitor cannot be reached.
    await log.error('heartbeat.failed', { signal: ok === 'start' ? 'start' : ok ? 'success' : 'fail', reason: 'Ping not acknowledged' });
    return 'failed';
  }
}
