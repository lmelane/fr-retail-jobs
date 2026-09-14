/**
 * CONSTRUIRE LE VIVIER D'UNE VAGUE — en SONDANT les portails, jamais en devinant une URL.
 *
 * D33 a mesuré le piège : **45 % des tenants « descriptifs » pointaient sur un `careers.<domaine>` généré
 * mécaniquement, en NXDOMAIN.** Les Maisons étaient bien vivantes ; c'est l'URL qui était inventée. Un
 * gabarit d'URL n'est donc pas une source, et un vivier bâti sur des gabarits est un vivier de fantômes.
 *
 * Ce programme essaie les formes usuelles, mais ne retient que ce qui **répond réellement** et porte un
 * indice de recrutement. Ce qui ne répond pas n'est pas « à intégrer plus tard » : c'est un portail non
 * établi, et il ressort comme tel.
 *
 * usage: npx tsx scripts/ops/wave-candidates.mts --actors=<actors.csv> [--limit=40] [--out=<f.json>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { detectFromHtml } from '../../src/ats/detect.js';
import { ADAPTERS } from '../../src/ats/index.js';
import { CRAWLER_IDENTITY } from '../../src/lib/crawlerIdentity.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const actorsFile = arg('actors')!;
const limit = Number(arg('limit') ?? 40);
const out = arg('out');

/** Les formes réellement observées sur les portails déjà catalogués — pas une liste d'imagination. */
const FORMES = (d: string) => [
  `https://careers.${d}/`, `https://jobs.${d}/`, `https://www.${d}/careers`,
  `https://www.${d}/carrieres`, `https://${d}/careers`, `https://recrutement.${d}/`,
];

/** Un mot de recrutement, dans les langues du périmètre : un 200 sur une page d'accueil ne prouve rien. */
const INDICES = /career|carrière|carriere|recrut|job|stelle|empleo|lavora con noi|vacature|offre d'emploi/i;

type Candidat = {
  acteur: string; domaine: string; urlTrouvee: string | null; statut: number;
  ats: string | null; adaptateurExistant: boolean; indiceRecrutement: boolean; note: string;
};

const rows = readFileSync(actorsFile, 'utf8').split('\n');
const head = rows[0].split(',');
const idx = (n: string) => head.indexOf(n);

/** Un parseur CSV minimal mais correct : les libellés contiennent des virgules entre guillemets. */
function cells(line: string): string[] {
  const out: string[] = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}

const sansSource = rows.slice(1).filter(Boolean).map(cells)
  .filter((c) => !(c[idx('activeSources')] ?? '').trim() || c[idx('activeSources')] === '0')
  .filter((c) => (c[idx('domain')] ?? '').trim())
  .map((c) => ({ acteur: c[idx('actor')], domaine: c[idx('domain')].trim(), action: c[idx('nextAction')] ?? '' }));

console.error(`${sansSource.length} acteurs sans source active et avec un domaine ; sondage des ${limit} premiers`);

const resultats: Candidat[] = [];
for (const a of sansSource.slice(0, limit)) {
  let trouve: Candidat | null = null;
  for (const url of FORMES(a.domaine)) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': CRAWLER_IDENTITY }, redirect: 'follow',
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const det = detectFromHtml(html, res.url);
      const indice = INDICES.test(html.slice(0, 60_000));
      // Une page qui répond mais ne parle pas de recrutement n'est pas un portail : on continue à chercher.
      if (!indice && !det) continue;
      trouve = {
        acteur: a.acteur, domaine: a.domaine, urlTrouvee: res.url, statut: res.status,
        ats: det?.type ?? null,
        adaptateurExistant: det?.type ? Object.hasOwn(ADAPTERS, String(det.type)) : false,
        indiceRecrutement: indice,
        note: det ? `ATS ${det.type} détecté` : 'page de recrutement sans ATS reconnu',
      };
      break;
    } catch { /* forme suivante : un hôte qui ne résout pas est le cas nominal de D33 */ }
  }
  resultats.push(trouve ?? {
    acteur: a.acteur, domaine: a.domaine, urlTrouvee: null, statut: 0,
    ats: null, adaptateurExistant: false, indiceRecrutement: false,
    note: 'aucune forme usuelle ne répond — portail à établir, jamais à inventer (D33)',
  });
  process.stderr.write('.');
}
process.stderr.write('\n');

const avecPortail = resultats.filter((r) => r.urlTrouvee);
const resume = {
  sondes: resultats.length,
  portailTrouve: avecPortail.length,
  avecAtsReconnu: avecPortail.filter((r) => r.ats).length,
  avecAdaptateurExistant: avecPortail.filter((r) => r.adaptateurExistant).length,
  sansPortail: resultats.length - avecPortail.length,
  parAts: Object.fromEntries(Object.entries(
    avecPortail.reduce<Record<string, number>>((m, r) => {
      const k = r.ats ?? 'AUCUN'; m[k] = (m[k] ?? 0) + 1; return m;
    }, {})).sort((a, b) => b[1] - a[1])),
};

if (out) writeFileSync(out, JSON.stringify({ resume, candidats: resultats }, null, 1));
console.log(JSON.stringify(resume, null, 1));
