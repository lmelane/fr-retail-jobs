import { describe, expect, it } from 'vitest';
import v1 from '../../../packages/db/data/occupations-v1.json' with { type: 'json' };
import v3 from '../../../audits/2026-09-28/curation-v3/6-manifeste-v3.json' with { type: 'json' };
import sectors from '../../../packages/db/data/sectors-v1.json' with { type: 'json' };
import figeeV1 from './__fixtures__/search-concepts-v1.json' with { type: 'json' };
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

  it('la garde compare comme la recherche : accents, casse, idéogrammes, et entre genres', () => {
    // Une garde qui ne ferait que mettre en minuscules ne verrait aucune de ces trois collisions.
    const concepts = [
      { key: 'a', kind: 'role', aliases: ['Vendeuse Élégante'] }, { key: 'b', kind: 'family', aliases: ['vendeuse elegante'] },
      { key: 'c', kind: 'role', aliases: ['销售顾问'] }, { key: 'd', kind: 'family', aliases: ['销 售 顾 问'] },
      { key: 'e', kind: 'family', aliases: ['Store-Management'] }, { key: 'f', kind: 'sector', aliases: ['store management'] },
    ];
    const paires = (cle: (v: string) => string) => vocabularyCollisions(concepts, cle).map((c) => c.concepts.join(' + ')).sort();
    expect(paires(cleRecherche)).toEqual(['family:b + role:a', 'family:d + role:c', 'family:e + sector:f']);
    expect(paires((v) => v.toLowerCase())).toEqual([]);
  });

  it('la v3 porte tout le vocabulaire historique de l\'API', () => {
    const concepts = new Map(searchConcepts(v3 as OccupationManifest, sectors).map((c) => [`${c.kind} ${c.key}`, c]));
    for (const [cle, alias] of Object.entries(ROLE_ALIASES))
      for (const a of alias) expect([...concepts.get(`role ${cle}`)!.aliases, ...(concepts.get(`role ${cle}`)!.titleOnlyAliases ?? [])]).toContain(a);
    // Sauf le nom d'un secteur : une famille qui le porte rend la recherche muette (« Hospitality » est le secteur).
    const secteur = new Set(sectors.flatMap((x) => Object.values(x.labels).map(cleRecherche)));
    for (const [cle, alias] of Object.entries(FAMILY_ALIASES))
      if (concepts.has(`family ${cle}`)) for (const a of alias)
        if (secteur.has(cleRecherche(a))) expect(concepts.get(`family ${cle}`)!.aliases).not.toContain(a);
        else expect(concepts.get(`family ${cle}`)!.aliases).toContain(a);
    expect(secteur.has('hospitality')).toBe(true);
    expect(concepts.get('role financial-controller')!.titleOnlyAliases).toEqual(ROLE_ALIASES['financial-controller']);
  });

  it('une seule source : l\'API n\'ajoute rien à un manifeste qui porte son vocabulaire', () => {
    const sansAlias = { ...(v3 as OccupationManifest), families: (v3 as OccupationManifest).families.map((f) => ({ ...f, aliases: [] })) };
    const famille = searchConcepts(sansAlias, sectors).find((c) => c.kind === 'family' && c.key === 'retail-client-advisor')!;
    expect(famille.aliases).not.toContain('Retail sales');
  });

  it('la version servie v1 garde son vocabulaire à l\'identique (instantané complet, figé avant le lot 2B)', () => {
    expect(JSON.parse(JSON.stringify(searchConcepts(v1 as OccupationManifest, sectors)))).toEqual(figeeV1);
  });

  it('toute recherche qui trouvait son concept en v1 le trouve en v3, sauf exception décidée', () => {
    const EXCEPTIONS: Record<string, string> = {
      'relief dispenser': 'jugé Préparateur en pharmacie sur les offres (étape 3) ; la release du 14/09 disait Assistant en pharmacie',
    };
    const index = (m: OccupationManifest) => {
      const x = new Map<string, Set<string>>();
      for (const c of searchConcepts(m, sectors)) for (const a of c.aliases) x.set(cleRecherche(a), new Set([...(x.get(cleRecherche(a)) ?? []), `${c.kind}:${c.key}`]));
      return x;
    };
    const avant = index(v1 as OccupationManifest), apres = index(v3 as OccupationManifest);
    const perdues = [...avant].filter(([k, cs]) => cs.size === 1 && !(k in EXCEPTIONS) && (apres.get(k)?.size !== 1 || [...apres.get(k)!][0] !== [...cs][0]))
      .map(([k, cs]) => `${k} (${[...cs][0]} → ${[...(apres.get(k) ?? [])].join('+') || 'rien'})`);
    expect(perdues).toEqual([]);
    for (const k of Object.keys(EXCEPTIONS)) expect(avant.has(k)).toBe(true);
  });

  it('un alias « titre seulement » est aussi un alias indexé (la recherche n\'indexe que les alias)', () => {
    for (const c of searchConcepts(v3 as OccupationManifest, sectors))
      for (const a of c.titleOnlyAliases ?? []) expect(c.aliases).toContain(a);
  });
});
