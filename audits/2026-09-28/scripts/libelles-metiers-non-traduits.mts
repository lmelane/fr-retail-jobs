/**
 * LIBELLÉS DE MÉTIERS SERVIS EN FRANÇAIS HORS DU FRANÇAIS (D-475, écarts de R-140, 28/09/2026).
 *
 * Pour chaque langue d'affichage, compte les métiers du catalogue dont le libellé RÉELLEMENT servi
 * (`libelleConcept`, la fonction que lit `/emplois`) est identique au libellé français alors qu'il diffère de
 * l'anglais : une traduction restée en français. Aucun accès réseau ni base : le manifeste versionné et la
 * table de présentation versionnée.
 *
 * Un homographe juste est aussi relevé : la liste se relit à la main. Au 28/09/2026, le néerlandais « Opticien »
 * est le mot de cette langue ; les 9 thaïs et 7 vietnamiens sont bien restés en français.
 *
 *   npx tsx audits/2026-09-28/scripts/libelles-metiers-non-traduits.mts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { libelleConcept } from '../../../apps/api/lib/taxonomy-labels';
import catalogue from '../../../apps/api/lib/data/taxonomy-labels.json';

const MANIFESTE = fileURLToPath(new URL('../../../packages/db/data/occupations-v1.json', import.meta.url));
const manifeste = JSON.parse(readFileSync(MANIFESTE, 'utf8')) as {
  id: string;
  occupations: { key: string; labels: Record<string, string> }[];
};

const langues = [
  ...new Set(
    Object.values(catalogue.occupations as Record<string, { labels: Record<string, string> }>).flatMap((e) =>
      Object.keys(e.labels),
    ),
  ),
].filter((l) => l !== 'fr').sort();

console.log(`Manifeste ${manifeste.id} : ${manifeste.occupations.length} métiers ; ${langues.length} langues d'affichage hors français`);
console.log('langue\tmétiers servis en français\texemples');
for (const langue of langues) {
  const restes = manifeste.occupations.filter((o) => {
    const servi = libelleConcept('occupations', o.key, o.labels, langue as Parameters<typeof libelleConcept>[3]);
    return o.labels.fr && o.labels.fr !== o.labels.en && servi === o.labels.fr;
  });
  if (restes.length) console.log(`${langue}\t${restes.length}\t${restes.slice(0, 4).map((o) => o.labels.fr).join(' · ')}`);
}
