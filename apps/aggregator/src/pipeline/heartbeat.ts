/**
 * External dead-man's-switch ping (DEC-4).
 *
 * The Brevo digest and the web-side deadman both live INSIDE our
 * infrastructure: a migration that blocks all three crons, a Railway outage,
 * or a dead database silences them too — the exact failure they exist to
 * report. An external pinger (healthchecks.io) inverts the direction: the
 * ingest SAYS "I ran", and the third party alerts when it stops saying it.
 *
 * No-op until HEALTHCHECK_PING_URL is configured (the check's ping URL, e.g.
 * https://hc-ping.com/<uuid>). `/fail` is appended on a failed run so the
 * check trips immediately instead of waiting for the grace period.
 */
export async function pingHeartbeat(ok: boolean): Promise<'pinged' | 'skipped' | 'failed'> {
  const url = process.env.HEALTHCHECK_PING_URL;
  if (!url) return 'skipped';
  try {
    const target = ok ? url : `${url.replace(/\/$/, '')}/fail`;
    const response = await fetch(target, { method: 'GET', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return 'pinged';
  } catch (error) {
    // The heartbeat must never take the run down with it — but a pinger that
    // cannot be reached is itself worth a log line.
    console.error(`[heartbeat] ping failed: ${error instanceof Error ? error.message : String(error)}`);
    return 'failed';
  }
}
