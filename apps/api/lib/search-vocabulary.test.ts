import { describe, expect, it } from 'vitest';
import v1 from '../../../packages/db/data/occupations-v1.json' with { type: 'json' };
import v3 from '../../../audits/2026-09-28/curation-v3/6-manifeste-v3.json' with { type: 'json' };
import sectors from '../../../packages/db/data/sectors-v1.json' with { type: 'json' };
import { vocabularyCollisions, type OccupationManifest } from '@catwalks/db/occupations';
import { searchWords } from './search-intent';
import { FAMILY_ALIASES, ROLE_ALIASES, searchConcepts } from './search-vocabulary';

/**
 * Garde d'unicité et source unique du vocabulaire (plan `docs/architecture/classification-metiers.md` §3.1, lot 2B de
 * D-475) : la même fonction que l'assemblage, avec la normalisation que la recherche applique réellement.
 */
const cleRecherche = (v: string) => searchWords(v).join(' ');
const vocabulaire = (m: OccupationManifest) => searchConcepts(m, sectors)
  .map((c) => ({ key: c.key, kind: c.kind, aliases: [...c.aliases, ...(c.titleOnlyAliases ?? [])] }));

describe('vocabulaire de recherche de la taxonomie v3', () => {
  it('aucune variante, dans aucune langue, ne désigne deux métiers, deux familles ou deux secteurs', () => {
    expect(vocabularyCollisions(vocabulaire(v3 as OccupationManifest), cleRecherche)).toEqual([]);
  });

  it('le témoin sait échouer : la version servie v1 donne « Demand Planner » à deux métiers', () => {
    const v1Collisions = vocabularyCollisions(vocabulaire(v1 as OccupationManifest), cleRecherche);
    expect(v1Collisions.map((c) => c.key)).toContain('demand planner');
  });

  it('la v3 porte tout le vocabulaire historique de l\'API', () => {
    const concepts = new Map(searchConcepts(v3 as OccupationManifest, sectors).map((c) => [`${c.kind} ${c.key}`, c]));
    for (const [cle, alias] of Object.entries(ROLE_ALIASES))
      for (const a of alias) expect([...concepts.get(`role ${cle}`)!.aliases, ...(concepts.get(`role ${cle}`)!.titleOnlyAliases ?? [])]).toContain(a);
    for (const [cle, alias] of Object.entries(FAMILY_ALIASES))
      if (concepts.has(`family ${cle}`)) for (const a of alias) expect(concepts.get(`family ${cle}`)!.aliases).toContain(a);
    expect(concepts.get('role financial-controller')!.titleOnlyAliases).toEqual(ROLE_ALIASES['financial-controller']);
  });

  it('une seule source : l\'API n\'ajoute rien à un manifeste qui porte son vocabulaire', () => {
    const sansAlias = { ...(v3 as OccupationManifest), families: (v3 as OccupationManifest).families.map((f) => ({ ...f, aliases: [] })) };
    const famille = searchConcepts(sansAlias, sectors).find((c) => c.kind === 'family' && c.key === 'retail-client-advisor')!;
    expect(famille.aliases).not.toContain('Retail sales');
  });

  it('la version servie v1 garde ses alias historiques, à l\'identique', () => {
    const concepts = searchConcepts(v1 as OccupationManifest, sectors);
    const controle = concepts.find((c) => c.kind === 'role' && c.key === 'financial-controller')!;
    expect(controle.titleOnlyAliases).toEqual(ROLE_ALIASES['financial-controller']);
    expect(concepts.find((c) => c.kind === 'family' && c.key === 'retail-client-advisor')!.aliases).toContain('Retail sales');
  });
});
