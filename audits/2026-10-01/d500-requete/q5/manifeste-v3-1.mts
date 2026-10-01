/**
 * D-500 (Q5) — LE MANIFESTE v3.1 : la v3 active (`catwalks-occupations-20260929-v3`), à l'identique, plus :
 *  - `titleReadingVersion: 2` : la lecture des métiers d'un intitulé au pluriel et aux deux genres
 *    (`packages/db/occupation-title-roles.ts`) ;
 *  - « Vendeur » vérifié pour la lecture du Conseiller de vente dans un intitulé plus long (« Vendeurs (f/h) - CDI 25h »),
 *    sous ses exclusions inchangées (encadrement, « Premier vendeur », rayon…).
 * Rien d'autre ne change : métiers, libellés, variantes, règles. Écrit `manifeste-v3-1.json` ; son activation est une
 * écriture de production, sous GO (README de ce dossier).
 *
 *   npx tsx audits/2026-10-01/d500-requete/q5/manifeste-v3-1.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileOccupationManifest, occupationManifestHash } from '@catwalks/db/occupations';

const ICI = new URL('.', import.meta.url).pathname;
const v3 = JSON.parse(readFileSync(join(ICI, '..', '..', '..', '2026-09-28', 'curation-v3', '6-manifeste-v3.json'), 'utf8'));
const v31 = structuredClone(v3);
v31.id = 'catwalks-occupations-20261001-v3-1';
v31.titleReadingVersion = 2;
v31.review = { author: 'Assistant (D-492), lot D-500 Q5', at: '2026-10-01T21:00:00.000Z',
  basis: 'v3 inchangée ; lecture des intitulés au pluriel et aux deux genres ; « Vendeur » vérifié pour la lecture du Conseiller de vente (mesure de justesse : audits/2026-10-01/d500-requete/q5/)' };
const vente = v31.occupations.find((o: { key: string }) => o.key === 'sales-advisor');
vente.titleReadingAliases = [...new Set([...(vente.titleReadingAliases ?? []), 'Vendeur'])];
compileOccupationManifest(v31);
writeFileSync(join(ICI, 'manifeste-v3-1.json'), JSON.stringify(v31, null, 1) + '\n');
console.log(`${v31.id} ; empreinte ${occupationManifestHash(v31)} ; v3 ${occupationManifestHash(v3)}`);
