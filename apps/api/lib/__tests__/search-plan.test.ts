import { describe, expect, it } from 'vitest';
import { facettesContrat } from '@catwalks/db/marches';
import { exigerPerimetre, PerimetreRequisError, resoudrePerimetre } from '../perimetre';
import { planifierRecherche } from '../search-plan';
import { parseFilters } from '../jobs';

/**
 * LE PLAN DE RECHERCHE (lot 6) — pur, sans base : ce que le moteur honore,
 * ce qu'il refuse, et ce qu'il nomme. Chaque témoin affirme d'abord que sa
 * prémisse exerce le cas, sinon il passerait au vert sans rien prouver.
 */
const FR = () => exigerPerimetre('FR');
const US = () => exigerPerimetre('US');
const criteres = (extra: Partial<ReturnType<typeof parseFilters>>) => ({ filtres: {}, ...extra });

describe('le périmètre est obligatoire', () => {
  it('un marché absent, vide ou mal formé est refusé, jamais dégradé en mondial', () => {
    for (const absent of [undefined, '', '   ']) {
      expect(() => exigerPerimetre(absent)).toThrow(PerimetreRequisError);
      try { exigerPerimetre(absent); } catch (e) { expect((e as PerimetreRequisError).code).toBe('MARCHE_REQUIS'); }
    }
    for (const inconnu of ['ZZ', 'zzzzz', '<script>', 'us-east-1', 'FRANCE']) {
      try {
        exigerPerimetre(inconnu);
        throw new Error(`${inconnu} aurait dû être refusé`);
      } catch (e) {
        expect(e).toBeInstanceOf(PerimetreRequisError);
        expect((e as PerimetreRequisError).code).toBe('MARCHE_INCONNU');
        expect((e as PerimetreRequisError).corps('rid')).toMatchObject({ error: 'MARCHE_INCONNU', requestId: 'rid' });
        expect((e as PerimetreRequisError).corps('rid').marches).toContain('FR');
      }
    }
  });

  it('un marché mesuré porte son périmètre géographique, plusieurs pays compris', () => {
    expect(resoudrePerimetre('fr')).toMatchObject({ code: 'FR', pays: ['FR'] });
    expect(resoudrePerimetre('DE')).toMatchObject({ code: 'DE', pays: ['DE', 'AT'] });
    expect(resoudrePerimetre('GB')).toMatchObject({ code: 'GB', pays: ['GB', 'IE'] });
    expect(resoudrePerimetre('DE')?.marche?.nom).toBe('Deutschland');
  });

  it('un pays connu sans marché mesuré est un périmètre d’un seul pays, sans facettes natives', () => {
    /*
     * Prémisse : la Bulgarie est un pays réel du catalogue (45 offres publiables mesurées le
     * 17/09/2026) sans marché — SOUS le seuil de 50 qui ouvre un marché routable.
     *
     * `JP` tenait ce rôle jusqu'au 17/09 et il est devenu un marché routable (552 offres). Le
     * remplacer plutôt que supprimer ce témoin : le cas NORMAL en production reste un code pays
     * parfaitement valide qui n'est simplement pas un marché.
     */
    const bg = resoudrePerimetre('BG');
    expect(bg).toMatchObject({ code: 'BG', pays: ['BG'], marche: undefined });
    expect(facettesContrat(bg!).map((f) => f.cle)).toEqual(['secteur', 'ville', 'maison', 'groupe', 'langue']);
    expect(facettesContrat(bg!).find((f) => f.cle === 'ville')?.libelle).toBe('Ville');
  });
});

describe('les facettes du contrat suivent le registre', () => {
  it('la France sert quatre dimensions mesurées et les facettes du site, dans l’ordre du contrat', () => {
    expect(facettesContrat(FR()).map((f) => f.cle)).toEqual(['secteur', 'contrat', 'temps', 'ville', 'maison', 'groupe', 'langue']);
    expect(facettesContrat(FR()).find((f) => f.cle === 'contrat')?.libelle).toBe('Type de contrat');
  });
  it('le contrat regroupe les programmes, le pays ne raffine que les marchés composites', () => {
    const us = facettesContrat(US()).map((f) => f.cle);
    expect(us).toContain('contrat');
    expect(us).not.toContain('programme');
    expect(us).toContain('temps');
    expect(facettesContrat(exigerPerimetre('BE')).map((f) => f.cle)).not.toContain('pays');
    expect(facettesContrat(exigerPerimetre('CA')).find((f) => f.cle === 'contrat')?.libelle).toBe('Employment type');
    // Deux pays dans le périmètre : le candidat peut s'y restreindre.
    expect(facettesContrat(exigerPerimetre('DE')).map((f) => f.cle)).toContain('pays');
  });
  it('INVARIANT : un marché NATIVE sert ses facettes dans SA langue, jamais en repli', () => {
    /*
     * Ce que ce témoin garde est durable : la Chine est localisée en `zh-CN`, donc tout ce qu'elle
     * expose doit être écrit en chinois. La LISTE des facettes, elle, suit les mesures et change
     * d'une version du registre à l'autre — la graver ici reviendrait à re-dater le témoin à
     * chaque nouvelle mesure, ce qui vient d'arriver avec `contrat` (54 %, libellé ajouté).
     */
    const cn = facettesContrat(exigerPerimetre('CN'));
    expect(cn.length, 'la prémisse : la Chine expose bien des facettes').toBeGreaterThan(0);
    expect(cn.find((f) => f.cle === 'contrat')?.libelle).toBe('合同类型');
    expect(cn.find((f) => f.cle === 'ville')?.libelle).toBe('城市');
    /* Aucun libellé servi ne doit être du latin : ce serait un repli non déclaré. */
    for (const f of cn) {
      expect(/[\u4e00-\u9fff]/.test(f.libelle), `CN/${f.cle} « ${f.libelle} » doit être en chinois`).toBe(true);
    }
  });
});

describe('les filtres sont honorés dans le périmètre, refusés explicitement hors de lui', () => {
  it('un filtre sur une facette que le marché ne sert pas est refusé et nommé, jamais honoré ni ignoré', () => {
    // Les programmes ne sont plus une dimension de menu séparée.
    expect(facettesContrat(US()).some((f) => f.cle === 'programme')).toBe(false);
    const plan = planifierRecherche(US(), criteres({ filtres: { programme: ['INTERNSHIP'], temps: ['FULL_TIME'] } }));
    expect(plan.selections).toEqual({ temps: ['FULL_TIME'] });
    expect(plan.refus).toEqual([{ cle: 'programme', valeurs: ['INTERNSHIP'], motif: 'FACETTE_NON_SERVIE' }]);
  });

  it('un pays hors périmètre est refusé ; un pays du périmètre est honoré', () => {
    const gb = exigerPerimetre('GB');
    const plan = planifierRecherche(gb, criteres({ filtres: { pays: ['IE', 'FR'] } }));
    expect(plan.selections.pays).toEqual(['IE']);
    expect(plan.refus).toEqual([{ cle: 'pays', valeurs: ['FR'], motif: 'PAYS_HORS_MARCHE' }]);
    // Le marché français ne sert pas la facette pays : `pays=FR` (lien hérité) ne change rien, `pays=US` est refusé.
    const herite = planifierRecherche(FR(), criteres({ filtres: { pays: ['FR'] } }));
    expect(herite.selections).toEqual({});
    expect(herite.refus).toEqual([]);
    expect(planifierRecherche(FR(), criteres({ filtres: { pays: ['US'] } })).refus).toEqual([{ cle: 'pays', valeurs: ['US'], motif: 'PAYS_HORS_MARCHE' }]);
  });

  it('un pays tapé dans le champ lieu n’est honoré que dans le périmètre — « aucun choix de pays dans l’input 2 »', () => {
    const dansLeMarche = planifierRecherche(FR(), criteres({ lieu: 'France' }));
    expect(dansLeMarche.lieu).toEqual({ type: 'pays', country: 'FR', libelle: 'France' });
    expect(dansLeMarche.refus).toEqual([]);

    const horsMarche = planifierRecherche(US(), criteres({ lieu: 'France' }));
    expect(horsMarche.lieu).toBeUndefined();
    expect(horsMarche.lieuCompris).toEqual({ type: 'pays', libelle: 'France' });
    expect(horsMarche.refus).toEqual([{ cle: 'lieu', valeurs: ['France'], motif: 'LIEU_HORS_MARCHE' }]);

    // L'Autriche appartient au périmètre allemand.
    expect(planifierRecherche(exigerPerimetre('DE'), criteres({ lieu: 'Autriche' })).lieu).toMatchObject({ type: 'pays', country: 'AT' });
  });

  it('ville, code postal et télétravail se résolvent sans jamais changer de périmètre', () => {
    expect(planifierRecherche(US(), criteres({ lieu: 'Paris' })).lieu).toEqual({ type: 'ville', cityLoose: 'Paris', libelle: 'Paris' });
    expect(planifierRecherche(FR(), criteres({ lieu: '75008' })).lieu).toEqual({ type: 'codePostal', postalCode: '75008', libelle: '75008' });
    expect(planifierRecherche(FR(), criteres({ lieu: 'télétravail' })).lieu).toEqual({ type: 'teletravail', remote: true, libelle: 'Télétravail' });
  });

  it('ET entre dimensions, OU entre valeurs : toutes les sélections servies coexistent', () => {
    const plan = planifierRecherche(FR(), criteres({ q: 'vendeuse', filtres: { maison: ['Dior', 'Chanel'], groupe: ['LVMH'], contrat: ['PERMANENT', 'FIXED_TERM'], secteur: ['unclassified'] } }));
    expect(plan.q).toBe('vendeuse');
    expect(plan.selections).toEqual({ maison: ['Dior', 'Chanel'], groupe: ['LVMH'], contrat: ['PERMANENT', 'FIXED_TERM'], secteur: ['unclassified'] });
    expect(plan.refus).toEqual([]);
  });

  it('preserves complete intentions and explicitly rejects excessive input', () => {
    const q = Array.from({ length: 30 }, (_, i) => `mot${i}`).join(' ');
    expect(planifierRecherche(FR(), criteres({ q })).q).toBe(q);
    expect(() => planifierRecherche(FR(), criteres({ q: 'x'.repeat(501) }))).toThrow('SEARCH_QUERY_TOO_LONG');
    expect(() => planifierRecherche(FR(), criteres({ q: 'mot '.repeat(65) }))).toThrow('SEARCH_QUERY_TOO_MANY_WORDS');
  });

  it('le pays prioritaire du visiteur ne compte que dans le périmètre, et n’est jamais un filtre', () => {
    expect(planifierRecherche(exigerPerimetre('DE'), criteres({ prioritePays: 'AT' })).prioritePays).toBe('AT');
    expect(planifierRecherche(FR(), criteres({ prioritePays: 'US' })).prioritePays).toBeUndefined();
    expect(planifierRecherche(FR(), criteres({ prioritePays: 'US' })).selections).toEqual({});
  });
});
