import { log } from '../observability/logger.js';
import type { HealthReport, SourceHealth } from './health.js';
import { retentionStatusLabel, retentionText } from './publicationDisposition.js';

/** The minimal health shape the alert needs — both ingest paths can satisfy it. */
type AlertReport = Pick<HealthReport, 'degraded' | 'broken' | 'incidents'>;

/** The subject leads with what blocks; what is only visible follows. */
export function alertSubject(report: AlertReport): string {
  const { blocking, retentions, outages, retained } = alertSections(report.incidents);
  return [`[Catwalks] ${count(blocking.length, 'source bloquante', 'sources bloquantes')}`,
    retentions.length ? `${count(retentions.length, 'source', 'sources')} avec retenues non bloquantes (${count(retained, 'offre', 'offres')})` : '',
    outages.length ? `${count(outages.length, 'panne éditeur prouvée, non bloquante', 'pannes éditeur prouvées, non bloquantes')}` : ''].filter(Boolean).join(' · ');
}

/** Exposed for the witness: the digest exactly as it is sent. */
export function alertHtml(report: AlertReport): string {
  return buildHtml(report);
}

const NUMBER = new Intl.NumberFormat('fr-FR');
function count(n: number, one: string, many: string): string {
  return `${NUMBER.format(n)} ${n > 1 ? many : one}`;
}

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

/**
 * Escapes a value for inclusion in the HTML digest. A note can carry a source's own error text: the em dash is
 * reworded (D-319, no « — » in an e-mail), whatever produced it.
 */
function esc(value: string): string {
  return value
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * D-453 §1 et D-456 : l'alerte sépare ce qui fait échouer le RUN de ce qui reste seulement visible.
 *   · BLOQUANT : toute source que l'orchestrateur n'a pas déclarée non bloquante (`blocking` absent = bloquant) ;
 *   · RETENUES NON BLOQUANTES : toutes listées, par nombre d'offres décroissant, avec un texte par motif et le
 *     total ; la preuve de la source et la décision de l'équipe y sont nommées pour ce qu'elles sont ;
 *   · PANNES DE L'ÉDITEUR PROUVÉES : un 5xx archivé, non bloquant, mais ce n'est pas une retenue.
 */
export function alertSections(incidents: readonly SourceHealth[]) {
  const blocking = incidents.filter(incident => incident.blocking !== false);
  const retentions = incidents.filter(incident => incident.blocking === false && incident.nonBlockingRetentionOnly)
    .sort((a, b) => (b.retained ?? 0) - (a.retained ?? 0) || a.source.localeCompare(b.source));
  const outages = incidents.filter(incident => incident.blocking === false && !incident.nonBlockingRetentionOnly);
  const retained = retentions.reduce((total, incident) => total + (incident.retained ?? 0), 0);
  return { blocking, retentions, outages, retained };
}

/**
 * What a retention does, per reason: it keeps THIS RUN from publishing the posting; it withdraws an earlier
 * publication only when its reason carries a disposition (`publicationHold.ts`). So each line says how many of its
 * postings are still online from an earlier collection, as the ingestion counted them (`heldOnline`).
 */
function onlineText(incident: SourceHealth, reason: string, retained: number): string {
  const held = retained > 1 ? 'non publiées par ce RUN' : 'non publiée par ce RUN';
  const online = incident.retention?.online;
  if (!online) return `${held} ; maintien en ligne non mesuré`;
  const n = online[reason] ?? 0;
  return `${held} ; ${n === 0 ? 'aucune ne reste en ligne' : `${NUMBER.format(n)} ${n > 1 ? 'restent' : 'reste'} en ligne depuis une collecte antérieure`}`;
}

/** One text per retention reason, most postings first: what, standing, and what stays online. */
function retentionLines(incident: SourceHealth): string[] {
  const collected = incident.retention?.collected ?? 0;
  return Object.entries(incident.retention?.byReason ?? {}).sort(([a, n], [b, m]) => m - n || a.localeCompare(b))
    .map(([reason, n]) => {
      // A reason to instruct already says so in its text (« à instruire (REASON) »): no standing to repeat.
      const status = retentionStatusLabel(reason);
      return `${count(n, 'offre', 'offres')} : ${retentionText(reason, collected > 0 ? n / collected : 0)}` +
        `${status === 'à instruire' ? '' : ` · ${status}`} · ${onlineText(incident, reason, n)}`;
    });
}

const STATE: Readonly<Record<SourceHealth['status'], string>> = { OK: 'saine', NEW: 'nouvelle', DEGRADED: 'dégradée', BROKEN: 'en panne' };
/** A source that failed before any collection completed is not « en panne, 0 offre publiée »: its offers stay online. */
const NOT_COLLECTED = 'aucune collecte aboutie par ce RUN ; ses offres en ligne restent publiées';
const line = (text: string, muted = true) =>
  `<p style="margin:2px 0;${muted ? 'color:#767676;' : ''}overflow-wrap:anywhere;word-break:break-word">${text}</p>`;

/**
 * One block per source, stacked: readable on a 375 px screen, where a six-column table pushed the detail off
 * the screen. Each block says whether the source blocks.
 */
function sourceBlock(incident: SourceHealth, blocks: boolean, lines: string[]): string {
  return `<div data-source="${esc(incident.source)}" data-bloquant="${blocks ? 'oui' : 'non'}" style="border-top:1px solid #E1E1E1;padding:10px 0">
      ${line(`<strong>${esc(incident.source)}</strong> · ${blocks ? 'bloquant' : 'non bloquant'} · ${incident.notCollected ? 'non collectée' : STATE[incident.status]}`, false)}
      ${lines.map(text => line(esc(text))).join('')}
    </div>`;
}

function buildHtml(report: AlertReport): string {
  const { blocking, retentions, outages, retained } = alertSections(report.incidents);
  const previous = (incident: SourceHealth) => incident.previous != null ? `${NUMBER.format(incident.previous)} au run précédent` : '';
  const volume = (incident: SourceHealth) => incident.notCollected
    ? [NOT_COLLECTED, previous(incident)].filter(Boolean).join(', ')
    : [count(incident.jobs, 'offre publiée par ce RUN', 'offres publiées par ce RUN'), previous(incident)].filter(Boolean).join(', ');
  const blockingBlocks = blocking.map(incident => sourceBlock(incident, true,
    [volume(incident), ...(incident.note ? [incident.note] : []), ...retentionLines(incident)])).join('');
  const retentionBlocks = retentions.map(incident => sourceBlock(incident, false, [...retentionLines(incident),
    ...(incident.guardWithoutReference ? ['garde technique sans référence : aucun RUN complet antérieur n’a collecté la source'] : []),
    volume(incident)])).join('');
  const outageBlocks = outages.map(incident => sourceBlock(incident, false,
    [...(incident.notCollected ? [volume(incident)] : []), ...(incident.note ? [incident.note] : [])])).join('');
  const heading = (text: string) => `<h3 style="font-weight:400;font-size:17px;margin:24px 0 4px">${text}</h3>`;
  // A source that failed before collecting is counted apart: its offers stay online, it is not « en panne » with none.
  const notCollected = report.incidents.filter(incident => incident.notCollected && incident.status === 'BROKEN').length;

  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#000;max-width:600px;font-size:14px;line-height:1.45">
    <h2 style="font-weight:400;font-size:20px">Ingestion : ${count(blocking.length, 'source bloquante', 'sources bloquantes')} à instruire</h2>
    ${line(`Bilan automatique d'un run d'ingestion Catwalks : ${[notCollected ? count(notCollected, 'source non collectée', 'sources non collectées') : '',
      count(Math.max(0, report.broken - notCollected), 'source en panne', 'sources en panne'), count(report.degraded, 'dégradée', 'dégradées')].filter(Boolean).join(', ')}.`)}
    ${heading(`Bloquant : ${count(blocking.length, 'source', 'sources')}`)}
    ${blocking.length ? `${line('Chaque ligne est une source à investiguer : elle fait échouer le RUN.')}${blockingBlocks}` : line('Aucune.')}
    ${retentions.length ? `${heading(`Non bloquant, retenues : ${count(retentions.length, 'source', 'sources')}, ${count(retained, 'offre retenue', 'offres retenues')}`)}
    ${line('Le RUN n’échoue pas pour ces retenues. Chaque motif dit son statut : décidé (avec sa décision), ou application non arbitrée de D-453 §1 ; et combien de ses offres restent en ligne : une retenue empêche ce RUN de publier, elle ne retire une offre déjà en ligne que si son motif le prévoit.')}
    ${retentionBlocks}
    ${line(`Total : ${count(retained, 'offre retenue', 'offres retenues')} sur ${count(retentions.length, 'source', 'sources')}.`, false)}` : ''}
    ${outages.length ? `${heading(`Non bloquant, pannes de l'éditeur prouvées : ${count(outages.length, 'source', 'sources')}`)}
    ${line('Réponse 5xx de la source, archivée : ce n’est pas une retenue.')}
    ${outageBlocks}` : ''}
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
    await log.warn('alert.unconfigured', '[alert] BREVO_API_KEY/SENDER not set — health digest skipped', {
      broken: report.broken,
      degraded: report.degraded,
    });
    return false;
  }

  try {
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender: { email: sender, name: process.env.BREVO_SENDER_NAME || 'Catwalks' },
        to: [{ email: alertRecipient() }],
        subject: alertSubject(report),
        htmlContent: buildHtml(report),
      }),
    });
    if (!response.ok) {
      await log.error('alert.http_failed', '[alert] Brevo error', response.status, await response.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (error) {
    log.assertHealthy();
    await log.error('alert.failed', { error });
    return false;
  }
}
