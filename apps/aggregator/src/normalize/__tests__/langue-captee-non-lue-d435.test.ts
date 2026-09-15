import { describe, it, expect } from 'vitest';
import { normalizeLanguage } from '../language.js';
import { parsePhenomJob } from '../../ats/adapters/phenom.js';
import { parseSmartRecruitersPosting } from '../../ats/adapters/smartrecruiters.js';

/**
 * D-435 — UNE INFORMATION CAPTÉE PUIS PERDUE.
 *
 * ── LE GISEMENT, VÉRIFIÉ DANS LE CODE LE 14/09/2026 ───────────────────────
 *
 * `phenom.ts` déclare `language` (« en-us », « fr-fr ») et s'en sert pour
 * COMPTER les variantes de requisition d'une même offre — mais ne l'écrivait
 * jamais dans l'offre normalisée. L'information entrait dans le connecteur et
 * n'en ressortait pas. Foot Locker est servi par cet adaptateur.
 *
 * Ce n'est ni une énigme internationale ni un défaut de la source : c'est un
 * chemin de données à brancher.
 *
 * ── CE QUE CES TÉMOINS PROUVENT, ET CE QU'ILS NE PROUVENT PAS ─────────────
 *
 * Ils appellent les VRAIS points d'entrée des adaptateurs — `parsePhenomJob`,
 * `parseSmartRecruitersPosting` — pas une copie de leur logique.
 *
 * Ils ne disent RIEN du nombre d'offres que cela remplira en production :
 * cela dépend du remplissage réel du champ chez chaque Maison, et se mesurera
 * quand l'accès au catalogue sera rétabli. Aucun gain n'est revendiqué ici.
 */
describe('la langue de l’annonce, captée et désormais transmise', () => {
  it('PRÉMISSE : le module réduit bien une étiquette à sa sous-balise primaire', () => {
    // Sans cela, les témoins suivants pourraient passer au vert sur du vide.
    expect(normalizeLanguage('fr-FR')).toBe('fr');
    expect(normalizeLanguage('EN_us')).toBe('en');
    expect(normalizeLanguage('nl')).toBe('nl');
  });

  it('s’abstient plutôt que d’inventer une langue', () => {
    /*
     * Une étiquette vide, numérique ou hors forme BCP 47 ne devient pas une
     * langue : une case vide se répare, une langue fausse oriente le candidat
     * vers des annonces qu'il ne peut pas lire.
     */
    for (const brut of [undefined, null, '', '   ', '123', 'x', 'français-québécois-long']) {
      expect(normalizeLanguage(brut), `« ${String(brut)} » ne doit pas produire de langue`).toBeUndefined();
    }
  });

  it('PHENOM écrit la langue dans l’offre — le gisement, sur le vrai point d’entrée', () => {
    /*
     * PRÉMISSE — l'offre doit être valide par ailleurs, sinon l'adaptateur
     * rend `null` et le témoin ne testerait rien.
     */
    const offre = parsePhenomJob(
      { title: 'Sales Associate', slug: 'sa-1', city: 'Paris', country_code: 'FR', language: 'fr-fr' },
      'https://careers.footlocker.com',
    );
    expect(offre, 'la prémisse : l’offre est bien normalisée').not.toBeNull();
    expect(offre?.language).toBe('fr');
  });

  it('PHENOM : une offre sans langue publiée reste sans langue', () => {
    // On ne remplit pas la colonne pour la remplir : absence conservée.
    const offre = parsePhenomJob(
      { title: 'Sales Associate', slug: 'sa-2', city: 'Paris', country_code: 'FR' },
      'https://careers.footlocker.com',
    );
    expect(offre?.language).toBeUndefined();
  });

  it('SMARTRECRUITERS garde son comportement après convergence', () => {
    /*
     * Cet adaptateur lisait DÉJÀ `language.code` correctement. La convergence
     * vers le module commun ne doit rien changer pour lui — ce témoin est là
     * pour le prouver, pas pour revendiquer un gain.
     */
    const offre = parseSmartRecruitersPosting(
      { id: 'x1', name: 'Vendeur', language: { code: 'fr-FR' } } as never,
      'HMGroup',
    );
    expect(offre.language).toBe('fr');
  });

  it('l’étiquette « sp » de LVMH vaut l’espagnol, et vaut pour TOUS', () => {
    /*
     * Cette correspondance ne vivait que dans `lvmhAlgolia.ts` : les deux
     * autres adaptateurs l'ignoraient. Trois copies d'une même logique
     * divergent toujours — c'est la raison d'être du module commun.
     */
    expect(normalizeLanguage('sp')).toBe('es');
    const offre = parsePhenomJob(
      { title: 'Vendedor', slug: 'sa-3', city: 'Madrid', country_code: 'ES', language: 'sp' },
      'https://careers.footlocker.com',
    );
    expect(offre?.language, 'la correspondance profite aussi à Phenom').toBe('es');
  });
});
