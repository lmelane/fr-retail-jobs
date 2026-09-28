/**
 * PROTOTYPE, LECTURE SEULE, SANS BASE (D-475, audit de la conception du lot 2, 28/09/2026) : si l'ESCO était la liste
 * officielle, où iraient les offres que le catalogue range aujourd'hui en « Conseiller de vente » (`sales-advisor`) ?
 * On croise la classification du manifeste du dépôt et le choix de l'itération 3 de la preuve du pivot sur les mêmes
 * intitulés d'offres agrégées. Et : combien de libellés français ESCO commencent par « vendeu ».
 * Données : `esco-metiers.json`, `echantillon.json`, `rattachements-v3.json` de la preuve du pivot du backend (hors git).
 *
 *   node --import tsx audits/2026-09-28/scripts/prototype-esco-fragmentation.mts
 */
import { readFileSync } from 'node:fs';
import { compileOccupationManifest } from '../../../packages/db/occupation-engine';

const PREUVE = process.env.PREUVE_PIVOT ?? '/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-backend/scripts/preuve-pivot-metiers-2026-09-28/sortie';
const manifest = JSON.parse(readFileSync(new URL('../../../packages/db/data/occupations-v1.json', import.meta.url), 'utf8'));
const esco = JSON.parse(readFileSync(`${PREUVE}/esco-metiers.json`, 'utf8'));
const v3 = JSON.parse(readFileSync(`${PREUVE}/rattachements-v3.json`, 'utf8')).rattachements as { source: string; titre: string; choix: { code: string; fr?: string; en: string } | null }[];
const moteur = compileOccupationManifest(manifest);
const offres = v3.filter((r) => r.source.startsWith('offre ') && r.source !== 'offre Catwalks');
const ventes = offres.filter((r) => moteur.classify(r.titre).occupationCode === 'sales-advisor');
const repartition = new Map<string, number>();
for (const r of ventes) {
  const k = r.choix ? `${r.choix.code} ${r.choix.fr ?? r.choix.en}` : 'aucun';
  repartition.set(k, (repartition.get(k) ?? 0) + 1);
}
console.log(`offres agrégées de l'échantillon : ${offres.length} ; rangées sales-advisor par le catalogue : ${ventes.length}`);
console.log(`codes ESCO choisis pour elles (itération 3) : ${[...repartition.keys()].filter((k) => k !== 'aucun').length}`);
for (const [k, n] of [...repartition].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${k}`);
const fr = esco.metiers.map((m: { libelles: Record<string, string> }) => m.libelles.fr).filter(Boolean) as string[];
console.log(`libellés français ESCO : ${fr.length} ; au double genre (« / ») : ${fr.filter((l) => l.includes('/')).length} ; commençant par « vendeu » : ${fr.filter((l) => /^vendeu/i.test(l)).length}`);
