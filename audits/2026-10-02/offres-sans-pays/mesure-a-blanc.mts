/**
 * D-520, offres sans pays — LA MESURE À BLANC du rattrapage, en lecture seule (transaction READ ONLY : Postgres refuse toute
 * écriture de la session, quel que soit le rôle ; aucune PipelineRun). Exécute l'aperçu même de `resoudre-pays`
 * (`previewRattrapagePays`) sur la base désignée par DATABASE_URL, et écrit dans ce dossier :
 *   - `07-apercu.json.gz`        l'aperçu complet (résolutions et restants), tel que la commande l'écrirait ;
 *   - `07-mesure-a-blanc.txt`    résolues par motif et par source, restantes par cause et par source ;
 *   - `08-relecture-30.txt`      30 résolutions tirées au hasard (graine fixe), à relire à la main.
 * Rejouable : `python3 apps/aggregator/scripts/ops/db.py readonly npx tsx audits/2026-10-02/offres-sans-pays/mesure-a-blanc.mts`.
 */
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { previewRattrapagePays, type ResolutionPays } from '../../../apps/aggregator/src/geo/rattrapagePays.js';

const ici = (nom: string) => fileURLToPath(new URL(nom, import.meta.url));
const GRAINE = 20261002;

function melange<T>(items: readonly T[], seed: number): T[] {
  let a = seed >>> 0;
  const rand = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}
const table = (paires: Map<string, Map<string, number>>) => [...paires].sort((a, b) => sum(b[1]) - sum(a[1]) || a[0].localeCompare(b[0]))
  .map(([cle, detail]) => `  ${cle.padEnd(28)} ${String(sum(detail)).padStart(5)}  ${[...detail].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
const ajouter = (m: Map<string, Map<string, number>>, cle: string, sous: string) => {
  const d = m.get(cle) ?? new Map<string, number>(); d.set(sous, (d.get(sous) ?? 0) + 1); m.set(cle, d);
};

const prisma = new PrismaClient({ errorFormat: 'minimal', log: [] });
try {
  const debut = Date.now();
  const apercu = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return previewRattrapagePays(tx);
  }, { isolationLevel: 'RepeatableRead', timeout: 1_800_000, maxWait: 10_000 });
  writeFileSync(ici('07-apercu.json.gz'), gzipSync(JSON.stringify(apercu, null, 1) + '\n'));

  const motifs = new Map<string, Map<string, number>>(), sourcesR = new Map<string, Map<string, number>>();
  const causes = new Map<string, Map<string, number>>(), sourcesS = new Map<string, Map<string, number>>();
  for (const r of apercu.resolutions) { ajouter(motifs, r.motif, r.apres.countryCode); ajouter(sourcesR, r.sourceKey, `${r.motif}→${r.apres.countryCode}`); }
  for (const r of apercu.restants) { ajouter(causes, r.cause, r.sourceKey); ajouter(sourcesS, r.sourceKey, r.cause); }
  const texte = [
    `Mesure à blanc du rattrapage des offres sans pays (D-520), ${apercu.observedAt}, ${Math.round((Date.now() - debut) / 1000)} s, transaction READ ONLY.`,
    `Offres actives sans pays : ${apercu.resolutions.length + apercu.restants.length} ; résolues ${apercu.resolutions.length} ; restantes ${apercu.restants.length}.`,
    `Empreinte de l'aperçu : ${apercu.empreinte}`,
    '', 'RÉSOLUES PAR MOTIF (pays)', ...table(motifs),
    '', 'RÉSOLUES PAR SOURCE (motif→pays)', ...table(sourcesR),
    '', 'RESTANTES PAR CAUSE (sources)', ...table(causes),
    '', 'RESTANTES PAR SOURCE (cause)', ...table(sourcesS),
  ];
  writeFileSync(ici('07-mesure-a-blanc.txt'), texte.join('\n') + '\n');

  const fiche = (r: ResolutionPays, i: number) => [
    `${String(i + 1).padStart(2)}. ${r.sourceKey} · ${r.jobId}`,
    `    lieu « ${r.lieu ?? '∅'} » · ville « ${r.ville ?? '∅'} » · point ${r.latitude ?? '∅'}, ${r.longitude ?? '∅'}`,
    `    → ${r.apres.countryCode}${r.apres.adminArea1 ? ` (${r.apres.adminArea1})` : ''} · ${r.motif} · marché observé [${r.marche.join(', ')}]`,
    `    relecture : `,
  ].join('\n');
  writeFileSync(ici('08-relecture-30.txt'), [`30 résolutions tirées au hasard (graine ${GRAINE}) sur ${apercu.resolutions.length}.`, '',
    ...melange(apercu.resolutions, GRAINE).slice(0, 30).map(fiche)].join('\n') + '\n');
  console.log(texte.slice(0, 3).join('\n'));
} finally {
  await prisma.$disconnect();
}
