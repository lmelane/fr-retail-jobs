import { prisma } from '@catwalks/db';

/** Aucun run terminé depuis ce délai = le pipeline est mort quelque part. */
const STALL_HOURS = Number(process.env.PIPELINE_DEADMAN_HOURS ?? 24);
const CHECK_EVERY_MS = 60 * 60 * 1000;
/** Un seul email par période de silence, pas un par heure. */
const REALERT_MS = 24 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | undefined;
let lastAlertAt = 0;

export function startPipelineDeadman(): void {
  // Next.js peut évaluer le module plusieurs fois (HMR, workers) — un seul timer.
  if (timer) return;
  timer = setInterval(() => void check(), CHECK_EVERY_MS);
  timer.unref?.();
  void check();
}

async function check(): Promise<void> {
  try {
    const last = await prisma.sourceRun.findFirst({
      orderBy: { ranAt: 'desc' },
      select: { ranAt: true },
    });
    const ageMs = last ? Date.now() - last.ranAt.getTime() : Number.POSITIVE_INFINITY;
    if (ageMs < STALL_HOURS * 3_600_000) return;
    if (Date.now() - lastAlertAt < REALERT_MS) return;

    const ageText = last
      ? `${Math.round(ageMs / 3_600_000)} h (dernier run : ${last.ranAt.toISOString()})`
      : 'jamais (table SourceRun vide)';
    const sent = await sendBrevoAlert(
      `[Mode Careers] Pipeline muet depuis ${ageText}`,
      `Aucun SourceRun enregistré depuis ${ageText}.\n\n` +
        `Causes probables : migration en échec au démarrage des crons (la commande tombe avant le pipeline), ` +
        `cron déplanifié, orchestrateur pendu. Vérifier les déploiements Railway du service catwalks-aggregator.\n\n` +
        `— dead man's switch, service web (domaine de panne séparé des crons).`,
    );
    if (sent) lastAlertAt = Date.now();
  } catch {
    // Le garde-fou ne doit jamais faire tomber le site.
  }
}

/** Même transport que le digest du pipeline (D24) : Brevo, no-op sans clé. */
async function sendBrevoAlert(subject: string, text: string): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const to = process.env.ALERT_EMAIL ?? 'loic.melane@catwalks.io';
  if (!apiKey) {
    console.warn(`[deadman] ${subject} — BREVO_API_KEY absente, alerte non envoyée`);
    return true; // compté comme traité : inutile de re-logguer chaque heure
  }
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: {
        email: process.env.BREVO_SENDER_EMAIL ?? 'alerts@catwalks.io',
        name: process.env.BREVO_SENDER_NAME ?? 'Mode Careers',
      },
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
  });
  return response.ok;
}
