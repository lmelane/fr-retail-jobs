import type { HealthReport } from './health.js';

/** The minimal health shape the alert needs — both ingest paths can satisfy it. */
type AlertReport = Pick<HealthReport, 'degraded' | 'broken' | 'incidents'>;

/**
 * Ingestion-health alert by email (decision, Loïc): when a source degrades or
 * breaks, send a digest to the operator so the catalogue can be kept clean —
 * silent failures are the enemy at 14k+ sources (FashionJobs ran 0 times for
 * days with no signal).
 *
 * Transport is Brevo, the same provider Catwalks already uses (do not reinvent):
 * POST https://api.brevo.com/v3/smtp/email with an api-key header. It is a no-op
 * when BREVO_API_KEY is unset (local runs, or before the key is provisioned), so
 * a missing key degrades to "no email" rather than a crash.
 *
 * ONE digest per run listing every degraded/broken source — never one email per
 * dead link (an offer closing is normal and constant; a SOURCE dying is the
 * actionable signal).
 */

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

function alertRecipient(): string {
  return process.env.ALERT_EMAIL || 'loic.melane@catwalks.io';
}

/** Escapes a value for inclusion in the HTML digest. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(report: AlertReport): string {
  const rows = report.incidents
    .map((incident) => {
      const before = incident.previous ?? '—';
      const note = incident.note ? ` — ${esc(incident.note)}` : '';
      return `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #E1E1E1">${esc(incident.source)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #E1E1E1"><strong>${incident.status}</strong></td>
        <td style="padding:6px 12px;border-bottom:1px solid #E1E1E1;text-align:right">${incident.jobs}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #E1E1E1;text-align:right">${before}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #E1E1E1;color:#767676">${note}</td>
      </tr>`;
    })
    .join('');

  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#000;max-width:640px">
    <h2 style="font-weight:400">Ingestion — ${report.broken} source(s) en panne, ${report.degraded} dégradée(s)</h2>
    <p style="color:#767676">Digest automatique d'un run d'ingestion Fashion Atlas. Chaque ligne est une source à investiguer.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr style="text-align:left;color:#767676">
        <th style="padding:6px 12px">Source</th><th style="padding:6px 12px">État</th>
        <th style="padding:6px 12px;text-align:right">Offres</th><th style="padding:6px 12px;text-align:right">Avant</th>
        <th style="padding:6px 12px">Détail</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/**
 * Sends the health digest if there is anything to report. Returns whether an
 * email was actually sent (false = nothing wrong, or no key). Never throws — an
 * alert failure must not fail the ingest run.
 */
export async function sendHealthAlert(report: AlertReport): Promise<boolean> {
  if (report.incidents.length === 0) return false;

  const apiKey = process.env.BREVO_API_KEY;
  const sender = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !sender) {
    console.warn('[alert] BREVO_API_KEY/SENDER not set — health digest skipped', {
      broken: report.broken,
      degraded: report.degraded,
    });
    return false;
  }

  try {
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender: { email: sender, name: process.env.BREVO_SENDER_NAME || 'Fashion Atlas' },
        to: [{ email: alertRecipient() }],
        subject: `[Atlas] ${report.broken} source(s) en panne, ${report.degraded} dégradée(s)`,
        htmlContent: buildHtml(report),
      }),
    });
    if (!response.ok) {
      console.error('[alert] Brevo error', response.status, await response.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (error) {
    console.error('[alert] exception', error instanceof Error ? error.message : String(error));
    return false;
  }
}
