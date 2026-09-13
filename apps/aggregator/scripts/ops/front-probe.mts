/**
 * LE SITE PUBLIC PENDANT LA CHARGE — un contrôle de non-régression, PAS un test de charge.
 *
 * La question n'est pas « combien le front encaisse-t-il » : personne ne l'a demandé, et le savoir exigerait
 * de le bombarder. La question est : *une ingestion qui tourne dégrade-t-elle ce que voit un candidat ?* Une
 * capacité gagnée sur le pipeline au prix d'un site plus lent serait un mauvais échange, et on ne le verrait
 * pas en regardant le seul pipeline.
 *
 * D'où une sonde délibérément LÉGÈRE : une requête par surface, séquentielle, sans concurrence. Elle mesure
 * ce qu'un visiteur unique vit, pendant que l'ingestion travaille.
 *
 * usage: npx tsx scripts/ops/front-probe.mts --phase=<avant|pendant|apres> [--base=…] [--out=…]
 */
import { writeFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const phase = arg('phase') ?? 'inconnue';
const base = arg('base') ?? 'https://modecareers.com';

type Probe = { surface: string; path: string; expect: number };

const PROBES: Probe[] = [
  { surface: 'accueil', path: '/', expect: 200 },
  { surface: 'résultats', path: '/emplois', expect: 200 },
  { surface: 'API jobs', path: '/api/jobs?limit=20', expect: 200 },
  { surface: 'entreprises', path: '/entreprises', expect: 200 },
];

async function timed(url: string): Promise<{ status: number; ms: number; bytes: number | null; error?: string }> {
  const started = Date.now();
  try {
    const r = await fetch(url, { redirect: 'follow' });
    const body = await r.text();
    return { status: r.status, ms: Date.now() - started, bytes: body.length };
  } catch (error) {
    // Une erreur réseau est un RÉSULTAT, pas une raison d'abandonner la sonde : la surface suivante compte.
    return { status: 0, ms: Date.now() - started, bytes: null, error: (error as Error).message.slice(0, 100) };
  }
}

const results: any[] = [];
for (const p of PROBES) {
  const r = await timed(`${base}${p.path}`);
  results.push({ ...p, ...r, conforme: r.status === p.expect });
}

/**
 * Une fiche ACTIVE et une fiche FERMÉE : les deux comportements publics que P7 a gravés (200 + JobPosting,
 * 410 + noindex). Les identifiants sont passés en argument pour que la sonde ne dépende pas de la base — elle
 * doit pouvoir tourner pendant que l'ingestion écrit.
 */
const activeId = arg('active-job');
const closedId = arg('closed-job');
if (activeId) {
  const r = await timed(`${base}/offre/${activeId}`);
  results.push({ surface: 'fiche active', path: `/offre/${activeId}`, expect: 200, ...r, conforme: r.status === 200 });
}
if (closedId) {
  // `fetch` suit les redirections mais conserve le statut final : une offre fermée doit rendre 410.
  const r = await timed(`${base}/offre/${closedId}`);
  results.push({ surface: 'fiche fermée', path: `/offre/${closedId}`, expect: 410, ...r, conforme: r.status === 410 });
}

const report = {
  at: new Date().toISOString(), phase, base,
  results,
  conformes: results.filter((r) => r.conforme).length,
  total: results.length,
  medianeMs: (() => {
    const ok = results.filter((r) => r.status > 0).map((r) => r.ms).sort((a, b) => a - b);
    return ok.length ? ok[Math.floor(ok.length / 2)] : null;
  })(),
  maxMs: results.length ? Math.max(...results.map((r) => r.ms)) : null,
};

const out = arg('out');
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
// Une surface non conforme est un échec du contrôle, pas une note de bas de page.
if (report.conformes !== report.total) process.exitCode = 1;
