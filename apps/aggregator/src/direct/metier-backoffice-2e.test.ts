import { describe, expect, it } from 'vitest';
import { lireOffre } from './contrat.js';
import { contexteTemoin, offreBrute, offreListe } from './fixture.js';
import { lireItemListe, offreCatalogueDepuisListe } from './liste.js';
import { colonnesProjetees, hashPayload } from './projection.js';

/**
 * Lot 2E de D-475 (§20, §32 ; plan §3.7) : pour une offre Catwalks, le métier choisi au back-office PRIME sur le titre.
 * Il arrive par un champ ADDITIF de la liste publique (`occupationCode`) ; l'agrégateur le prend tel quel s'il est publié
 * par la version active, sinon il classe l'intitulé comme avant.
 */
describe('le métier choisi au back-office (lot 2E)', () => {
  const contexte = contexteTemoin({ metiers: { 'Conseiller de vente H/F': 'sales-advisor' }, publies: ['sales-advisor', 'client-advisor-clienteling'] });

  it('prime sur l’intitulé quand la version active le publie, et le dit (`backoffice`)', () => {
    const item = lireItemListe(offreListe({ occupationCode: 'client-advisor-clienteling' }));
    const colonnes = colonnesProjetees(offreCatalogueDepuisListe(item, 'FR'), contexte);
    // Prémisse : sans le choix, l'intitulé donnerait un AUTRE métier.
    expect(contexte.metier('Conseiller de vente H/F').occupationCode).toBe('sales-advisor');
    expect(colonnes).toMatchObject({ occupationCode: 'client-advisor-clienteling', occupationReleaseId: 'release-temoin', occupationDecisionSource: 'backoffice' });
  });

  it('un code que la version active ne publie pas n’est jamais écrit : l’intitulé reprend la main', () => {
    const item = lireItemListe(offreListe({ occupationCode: 'metier-futur' }));
    expect(item.metier?.code).toBe('metier-futur');
    expect(colonnesProjetees(offreCatalogueDepuisListe(item, 'FR'), contexte))
      .toMatchObject({ occupationCode: 'sales-advisor', occupationDecisionSource: null });
  });

  it('un code hors forme est ignoré et signalé, l’offre reste lue', () => {
    const item = lireItemListe(offreListe({ occupationCode: 'Sales Advisor' }));
    expect(item.metier).toMatchObject({ slug: 'CONSEILLER_VENTE', code: null });
    expect(item.ecarts).toContain('offre.occupationCode');
  });

  it('une offre sans ancien référentiel mais avec un code garde un métier, au libellé servi', () => {
    const item = lireItemListe(offreListe({ jobCategoryRef: null, occupationCode: 'client-advisor-clienteling', occupationLabel: 'Conseiller clienteling' }));
    expect(item.metier).toEqual({ slug: 'client-advisor-clienteling', libelle: 'Conseiller clienteling', code: 'client-advisor-clienteling' });
    expect(colonnesProjetees(offreCatalogueDepuisListe(item, 'FR'), contexte)).toMatchObject({ occupationLabel: 'Conseiller clienteling', occupationDecisionSource: 'backoffice' });
  });

  it('une liste d’avant le lot (sans `occupationCode`) garde exactement son contrat et son empreinte', () => {
    const avant = offreCatalogueDepuisListe(lireItemListe(offreListe()), 'FR');
    expect(avant.metier).toEqual({ slug: 'CONSEILLER_VENTE', libelle: 'Conseiller de vente' });
    expect('code' in (avant.metier ?? {})).toBe(false);
    const nulle = offreCatalogueDepuisListe(lireItemListe(offreListe({ occupationCode: null })), 'FR');
    expect(hashPayload(nulle)).toBe(hashPayload(avant));
  });

  it('le contrat du flux relit le code additif et refuse une clé hors forme', () => {
    expect(lireOffre(offreBrute({ metier: { slug: 'VM', libelle: 'VM', code: 'visual-merchandiser' } })).metier).toEqual({ slug: 'VM', libelle: 'VM', code: 'visual-merchandiser' });
    expect(() => lireOffre(offreBrute({ metier: { slug: 'VM', libelle: 'VM', code: '../x' } }))).toThrow(/metier\.code/);
  });
});
