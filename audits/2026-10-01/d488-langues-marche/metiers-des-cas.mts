/**
 * D-488 : le métier de chaque cas de la grille (`resultats/cas-grille.txt`), lu par le vrai modèle et restreint aux
 * langues du marché, pour que `choisir-chemin.py` applique la règle de `search-chemin.ts` avec les comptes de production.
 * Usage : npx tsx metiers-des-cas.mts > metiers-des-cas.json
 */
import { readFileSync } from 'node:fs';
import { MARCHES, type CodeMarche } from '@catwalks/db/marches';
import type { OccupationManifest } from '@catwalks/db/occupations';
import { snapshotModel, type SnapshotMetadata } from '../../../apps/api/lib/search-model';

const manifest = JSON.parse(readFileSync(new URL('../../2026-09-28/curation-v3/6-manifeste-v3.json', import.meta.url), 'utf8')) as OccupationManifest;
const model = snapshotModel({ asOf: new Date().toISOString(), occupationRelease: { id: manifest.id, manifest }, companies: [], aliases: [], sectorConcepts: [] } as unknown as SnapshotMetadata);
const sortie: Record<string, string | null> = {};
for (const c of readFileSync(new URL('resultats/cas-grille.txt', import.meta.url), 'utf8').trim().split(',')) {
  const code = c.slice(0, c.indexOf(':')) as CodeMarche, q = c.slice(c.indexOf(':') + 1);
  const role = model.intention(q, MARCHES[code]).clauses.find((x) => x.kind === 'role' && !x.exclude);
  sortie[`${code} ${q}`] = role?.keys[0] ?? null;
}
console.log(JSON.stringify(sortie, null, 1));
