import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import dns from 'node:dns/promises';
import { fetchText } from '../lib/http.js';

/**
 * Sonde d'egress, exécutée EN TÊTE du process réel (avant hostGate, avant
 * l'ingest) — protocole imposé par Loïc, 2026-09-04.
 *
 * Contexte : 7 sources SuccessFactors renvoient 0 offre en production alors
 * que le même adaptateur, sur les mêmes configs, rend leurs volumes exacts
 * depuis un poste local. Les sondes lancées dans un conteneur `railway ssh`
 * réveillé à la demande ont montré un TCP en timeout ; le service web, lui,
 * atteint les mêmes hôtes. Ces deux mesures ne discriminent PAS la cause :
 * un conteneur SSH n'est pas le conteneur du cron, et deux services ont deux
 * egress distincts.
 *
 * Cette sonde produit la preuve discriminante, dans le vrai run :
 *   direct curl KO                    -> réseau / service / cold-start
 *   curl OK + fetch Node KO           -> runtime Node / TLS
 *   fetch direct OK + via hostGate KO -> hostGate (motif D25)
 *   hostGate OK + ingest 0 offre      -> pipeline
 *   échec à t0 puis succès à +5/15/30s -> cold-start démontré
 *
 * Ne s'active que si EGRESS_PROBE=1 : c'est un instrument de diagnostic, pas
 * un coût permanent sur chaque run.
 */

const execFileAsync = promisify(execFile);

/** Hôte témoin du problème + l'URL EXACTE que l'adaptateur construit. */
const TARGET_HOST = 'jobs.dolcegabbana.com';
const TARGET_URL = `https://${TARGET_HOST}/search/?createNewAlert=false&q=&locationsearch=&startrow=0`;

/** Compte les liens d'offres — la seule preuve qui vaut (un 200 ne suffit pas). */
function offerLinks(html: string): number {
  return new Set([...html.matchAll(/href="(\/job\/[^"]{5,80})"/g)].map((m) => m[1])).size;
}

async function publicIp(): Promise<string> {
  try {
    const body = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(15_000) });
    const data = (await body.json()) as { ip?: string; org?: string; country?: string };
    return `${data.ip} (${data.org}, ${data.country})`;
  } catch (error) {
    return `INDISPONIBLE ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** curl -4 chronométré : DNS / TCP / TLS / TTFB / total / statut. */
async function curlTimings(): Promise<string> {
  const format =
    'connect=%{time_connect}s tls=%{time_appconnect}s ttfb=%{time_starttransfer}s total=%{time_total}s http=%{http_code} ip=%{remote_ip}';
  try {
    const { stdout } = await execFileAsync(
      'curl',
      ['-4', '-s', '-o', '/tmp/egress-probe.html', '--connect-timeout', '10', '--max-time', '30', '-w', format, TARGET_URL],
      { timeout: 45_000 },
    );
    return stdout.trim();
  } catch (error) {
    return `ÉCHEC ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`;
  }
}

/** fetch Node NU — sans hostGate, sans retry : isole le runtime du transport. */
async function rawFetch(): Promise<string> {
  const started = Date.now();
  try {
    const response = await fetch(TARGET_URL, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(25_000),
    });
    const body = await response.text();
    return `http=${response.status} ${Date.now() - started}ms liens=${offerLinks(body)}`;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    return `ÉCHEC ${cause ?? (error instanceof Error ? error.message : String(error))} ${Date.now() - started}ms`;
  }
}

/** Le MÊME appel, mais par le transport du pipeline (hostGate + retries). */
async function viaHostGate(): Promise<string> {
  const started = Date.now();
  try {
    const body = await fetchText(TARGET_URL);
    return `OK ${Date.now() - started}ms liens=${offerLinks(body)}`;
  } catch (error) {
    return `ÉCHEC ${error instanceof Error ? error.message.slice(0, 120) : String(error)} ${Date.now() - started}ms`;
  }
}

export async function runEgressProbe(): Promise<void> {
  if (process.env.EGRESS_PROBE !== '1') return;

  const line = (label: string, value: string) => console.log(`[egress] ${label.padEnd(22)} ${value}`);

  line('timestamp', new Date().toISOString());
  line('service', process.env.RAILWAY_SERVICE_NAME ?? '?');
  line('replica', process.env.RAILWAY_REPLICA_ID ?? '?');
  line('region', process.env.RAILWAY_REPLICA_REGION ?? process.env.RAILWAY_REGION ?? '?');
  line('ip publique', await publicIp());

  try {
    line('dns A', (await dns.resolve4(TARGET_HOST)).join(','));
  } catch (error) {
    line('dns A', `ÉCHEC ${error instanceof Error ? error.message : String(error)}`);
  }

  line('curl -4 direct', await curlTimings());
  line('fetch Node direct', await rawFetch());
  line('fetch via hostGate', await viaHostGate());

  /**
   * Test explicite du cold-start : si et seulement si le direct a échoué,
   * on rejoue le MÊME appel à +5s, +15s, +30s. Un succès différé démontre
   * que le réseau du conteneur n'était pas prêt ; un échec constant l'exclut.
   */
  const retryable = (await rawFetch()).startsWith('ÉCHEC');
  if (retryable) {
    for (const delay of [5_000, 10_000, 15_000]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      line(`retry +${delay / 1000}s`, await rawFetch());
    }
  } else {
    line('cold-start', 'non testé (le direct fonctionne déjà)');
  }
}
