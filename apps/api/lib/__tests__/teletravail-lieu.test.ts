import { describe, expect, it } from 'vitest';
import { exigerPerimetre } from '@/lib/perimetre';
import { planifierRecherche } from '@/lib/search-plan';

const criteres = (lieu: string) => ({ motCle: '', lieu, filtres: {} as never, marche: 'FR' });

describe('télétravail : un MODE DE LIEU, jamais une facette', () => {
  it('le champ de lieu active le télétravail', () => {
    for (const mot of ['télétravail', 'remote', 'à distance', 'home office']) {
      const plan = planifierRecherche(exigerPerimetre('FR'), criteres(mot) as never);
      expect(plan.lieu, `« ${mot} » doit activer le télétravail`).toEqual({ type: 'teletravail', remote: true, libelle: 'Télétravail' });
    }
  });

  it('une ville reste une ville : les deux modes sont EXCLUSIFS par construction', () => {
    const plan = planifierRecherche(exigerPerimetre('FR'), criteres('Paris') as never);
    expect(plan.lieu?.type, 'un lieu porte UN seul mode').toBe('ville');
    /* `lieu` est un champ unique : choisir le télétravail REMPLACE la ville, il n'existe donc
     * aucun état où les deux coexistent. L'exclusivité ne se code pas, elle est structurelle. */
  });
});
