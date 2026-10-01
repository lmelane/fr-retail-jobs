import { describe, expect, it } from 'vitest';
import v3 from '../../../../audits/2026-09-28/curation-v3/6-manifeste-v3.json' with { type: 'json' };
import { compileOccupationManifest, occupationTitleRoles, type OccupationManifest } from '@catwalks/db/occupations';

/**
 * D-500 (Q5) — LA LECTURE DES INTITULÉS AU PLURIEL ET AUX DEUX GENRES (`titleReadingVersion: 2`), témoin pur.
 *
 * La v3 active ne la porte pas : tant qu'elle est servie, rien ne change (aucune offre reclassée au déploiement). La v3.1
 * (`audits/2026-10-01/d500-requete/q5/manifeste-v3-1.mts`) la porte, avec « Vendeur » vérifié pour la lecture du
 * Conseiller de vente. Les garde-fous viennent des deux tours de mesure de justesse (`q5/tour1`, `q5/tour2`) : chaque faux
 * relevé par l'assistant et par le juge y est un témoin.
 */
const manifestV3 = v3 as unknown as OccupationManifest;
const v31 = structuredClone(manifestV3) as OccupationManifest & { titleReadingVersion?: 1 | 2 };
v31.id = 'catwalks-occupations-20261001-v3-1';
v31.titleReadingVersion = 2;
const vente = v31.occupations.find((o) => o.key === 'sales-advisor')!;
vente.titleReadingAliases = [...new Set([...(vente.titleReadingAliases ?? []), 'Vendeur'])];
const avant = compileOccupationManifest(manifestV3), apres = compileOccupationManifest(v31);
const sansMetier = { occupationCode: null, occupationStatus: 'FAMILY_ONLY', occupationEvidence: { candidates: [], matchedRules: [] } };
const lus = (c: typeof avant, titre: string, d = sansMetier) => occupationTitleRoles(c, titre, d);

describe('D-500 (Q5) : les métiers lus au pluriel et aux deux genres', () => {
  const RATTACHES: [string, string][] = [
    ['Vendeurs (f/h) - CDI 25h - Rouen les Docks', 'sales-advisor'],
    ['[Fashion] - Conseiller.e de ventes CDD 35h - Parly 2 - H/F', 'sales-advisor'],
    ['CDI - Conseiller de Ventes H/F', 'sales-advisor'],
    ['2026 Seasonal Casual Sales Associates - Westgate', 'sales-advisor'],
    ['VENDEURS POLYVALENTS H/F, CDI 24H', 'sales-advisor'],
    ['Responsables de Boutique H/F', 'store-manager'],
  ];

  it('PRÉMISSE : la v3 active ne lit aucun de ces intitulés (les offres restent hors de `metier=`)', () => {
    for (const [titre, metier] of RATTACHES) expect(lus(avant, titre), titre).not.toContain(metier);
  });

  it('la v3.1 les rattache à leur métier', () => {
    for (const [titre, metier] of RATTACHES) expect(lus(apres, titre), titre).toContain(metier);
  });

  it('les garde-fous mesurés : enseigne, encadrement, assistant, nom de tête (tour 1 : 8 faux, tour 2 : 1 faux)', () => {
    const magasin = { occupationCode: 'store-manager', occupationStatus: 'CLASSIFIED', occupationEvidence: { candidates: ['store-manager'], matchedRules: [] } };
    // PRÉMISSE : sans garde-fou, la lecture 2 lirait l'opticien dans « Opticians » (le pluriel d'un métier connu).
    expect(lus(apres, 'Opticians - Paris')).toContain('dispensing-optician');
    expect(lus(apres, 'Store Manager - Opticians', magasin)).not.toContain('dispensing-optician');
    expect(lus(apres, 'L&D Capability Partner - Boots Opticians')).not.toContain('dispensing-optician');
    expect(lus(apres, 'STAGE - Assistant Chef de Projets Supply Chain (H/F)')).not.toContain('chef-de-projet-supply-chain');
    expect(lus(apres, 'Buyers Admin- Beauty')).not.toContain('buyer');
    // Les exclusions décidées tiennent au pluriel : la parfumerie reste au conseil beauté (D-475 §35, §37).
    expect(lus(apres, 'CONSEILLERE VENDEUSE EN PARFUMERIE SELECTIVE H/F')).not.toContain('sales-advisor');
  });

  it('rien ne se perd : toute offre garde les métiers que la v3 lui lisait', () => {
    for (const titre of ['Chargé d\'affaires', 'Conseiller de vente - Paris', 'Store Manager', 'Sales Associate - London', 'Addetto alle vendite'])
      for (const m of lus(avant, titre)) expect(lus(apres, titre), titre).toContain(m);
  });
});
