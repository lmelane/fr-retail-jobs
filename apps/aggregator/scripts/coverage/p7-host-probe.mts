/**
 * P7 PHASE 0 — la joignabilité et la latence RÉELLES de chaque hôte de la vague.
 *
 * Un plan de politesse par hôte ne se rédige pas depuis une table de valeurs par défaut : il se règle sur ce
 * que les hôtes font réellement. Ce programme lit `robots.txt` (une requête, la plus légère et la plus polie
 * qui soit) sur chaque hôte de la vague et mesure la latence — sans toucher aux offres.
 *
 * Ce qu'il PROUVE et ce qu'il ne prouve pas : il établit que l'hôte répond depuis ce poste, avec quel délai et
 * quel verdict d'accès. Il ne dit RIEN de l'egress de la production — leçon D32, un conteneur voisin n'est pas
 * la source. La mesure définitive appartient au run borné, depuis l'egress du cron.
 *
 * Aucune écriture, aucune base. usage: p7-host-probe.mts [--out=<file.json>]
 */
import { writeFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

/** Hôte réel de chaque source, lu dans la configuration du catalogue (mesuré par p7-wave-profile). */
const HOSTS: Array<{ key: string; kind: string; host: string }> = [
  { key: 'mecca', kind: 'workday', host: 'mecca.wd3.myworkdayjobs.com' },
  { key: 'dr-pierre-ricaud', kind: 'successfactors', host: 'careers.groupe-rocher.com' },
  { key: 'lagardere-travel-retail', kind: 'talentsoft', host: 'lagardere-recrute.talent-soft.com' },
  { key: 'urbn-hub', kind: 'icims', host: 'hub-urbn.icims.com' },
  { key: 'beiersdorf', kind: 'generic-listing', host: 'www.beiersdorf.com' },
  { key: 'lindex-easycruit', kind: 'easycruit', host: 'lindex.easycruit.com' },
  { key: 'american-vintage-dr', kind: 'digitalrecruiters', host: 'careers.am-vintage.com' },
  { key: 'saltrock-harri', kind: 'harri', host: 'harri.com' },
  { key: 'ganni-talentrecruiter', kind: 'talentrecruiter', host: 'candidate.hr-manager.net' },
];

const results = [];
for (const h of HOSTS) {
  const started = Date.now();
  let status: number | null = null;
  let error: string | null = null;
  let bytes = 0;
  try {
    const res = await fetch(`https://${h.host}/robots.txt`, {
      redirect: 'follow',
      headers: { 'user-agent': process.env.USER_AGENT ?? 'CatwalksJobsBot/0.1' },
      signal: AbortSignal.timeout(20_000),
    });
    status = res.status;
    bytes = (await res.text()).length;
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  const ms = Date.now() - started;
  results.push({ ...h, status, ms, bytes, error });
  console.log(`${h.key.padEnd(26)} ${h.host.padEnd(38)} ${String(status ?? 'ERR').padEnd(5)} ${String(ms).padStart(6)}ms ${error ?? ''}`);
  // On espace nos propres sondes : la politesse commence par la mesure.
  await new Promise((r) => setTimeout(r, 250));
}

const reachable = results.filter((r) => r.status !== null);
const summary = {
  measuredAt: new Date().toISOString(),
  note: 'Latence depuis le poste local ; l\'egress de la production est différent (D32). Indicatif, pas contractuel.',
  hosts: results,
  reachable: reachable.length,
  unreachable: results.length - reachable.length,
  slowestMs: Math.max(...results.map((r) => r.ms)),
  medianMs: [...reachable.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(reachable.length / 2)] ?? null,
};
console.log(`\njoignables ${summary.reachable}/${results.length} · médiane ${summary.medianMs} ms · plus lent ${summary.slowestMs} ms`);
const file = arg('out');
if (file) writeFileSync(file, JSON.stringify(summary, null, 2));
