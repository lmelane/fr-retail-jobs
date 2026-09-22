import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeRmkItem, brandPropertyOf, fetchRmkV2Jobs } from './successfactors.js';

/**
 * LA MARQUE SERVIE AU NIVEAU LISTE — l'employeur que la source nomme elle-même.
 *
 * ── CE QUE LA MESURE A ÉTABLI ──────────────────────────────────────────────────────────────────
 *
 * `douglas-sf`, RAW archivé du 2026-09-21 : l'API de liste
 * `POST /services/recruiting/v1/jobs` sert `sfstd_marketingBrand_obj` sur ses offres —
 * `["DOUGLAS"]` et `["NOCIBE"]` — dans 150 des réponses du lot. Ce n'est pas une donnée de page
 * de détail : elle arrive avec le listing, à côté de `custFullTimePartTime` que l'adaptateur lit
 * déjà.
 *
 * Sans cette lecture, les 315 offres Douglas tombent en `PORTAL_OWNER_NOT_CERTIFIED` : faute
 * d'employeur natif, l'étiquette vient du registre, et la règle d'identité refuse de l'attribuer
 * sur un portail non certifié SINGLE_BRAND.
 *
 * ── CE QUE CE LOT NE FAIT PAS ──────────────────────────────────────────────────────────────────
 *
 * Il ne devine aucune marque. Le champ est déclaré PAR TENANT (`brandProperty`, opt-in) et la
 * valeur n'est retenue que si la source la sert. Un tenant qui ne la configure pas, ou qui sert
 * un champ vide, garde exactement le comportement d'avant — c'est le troisième témoin.
 */
const base = {
  id: 4711,
  unifiedStandardTitle: 'Beauty Advisor',
  urlTitle: 'beauty-advisor',
  brandUrl: 'default',
  jobLocationShort: ['Düsseldorf, DE'],
  unifiedStandardStart: '10.07.26',
};

afterEach(() => vi.unstubAllGlobals());

describe('marque servie au niveau liste (SuccessFactors RMK)', () => {
  it('retient la marque native quand le tenant la déclare', () => {
    /* LE CAS MESURÉ chez Douglas, à l'identique : un tableau à une entrée. */
    const job = normalizeRmkItem({ ...base, sfstd_marketingBrand_obj: ['DOUGLAS'] }, 'de_DE',
      'https://jobs.douglas.group', 'sfstd_marketingBrand_obj');

    expect(job?.employerEvidence).toEqual({
      rawName: 'DOUGLAS',
      path: 'listing.sfstd_marketingBrand_obj',
      rule: 'CONFIGURED_BRAND_PROPERTY',
    });
  });

  it('distingue deux marques du MÊME tenant', () => {
    /*
     * PRÉMISSE DU DÉFAUT : Douglas sert DOUGLAS **et** NOCIBÉ. Un correctif qui prendrait le nom
     * du registre attribuerait « Douglas » aux deux — exactement l'attribution erronée que la
     * règle d'identité protège. Ce témoin échoue si les deux convergent.
     */
    const douglas = normalizeRmkItem({ ...base, sfstd_marketingBrand_obj: ['DOUGLAS'] }, 'de_DE', 'https://x.test', 'sfstd_marketingBrand_obj');
    const nocibe = normalizeRmkItem({ ...base, id: 4712, sfstd_marketingBrand_obj: ['NOCIBE'] }, 'de_DE', 'https://x.test', 'sfstd_marketingBrand_obj');

    expect(douglas?.employerEvidence?.rawName).toBe('DOUGLAS');
    expect(nocibe?.employerEvidence?.rawName).toBe('NOCIBE');
    expect(douglas?.employerEvidence?.rawName).not.toBe(nocibe?.employerEvidence?.rawName);
  });

  it('ne change RIEN quand le tenant ne déclare pas de champ de marque', () => {
    /*
     * LE TÉMOIN DE NON-RÉGRESSION. `adidas` et `breitling-sf` passent par le même code : mesuré
     * le 2026-09-21, aucun des deux ne sert de champ de marque. Ils doivent rester intacts.
     */
    const job = normalizeRmkItem({ ...base, sfstd_marketingBrand_obj: ['DOUGLAS'] }, 'de_DE', 'https://x.test');
    expect(job?.employerEvidence).toBeUndefined();
    expect(job?.company).toBeUndefined();
  });

  it('ignore un champ déclaré mais VIDE plutôt que de produire une preuve creuse', () => {
    /*
     * Une preuve d'employeur vide serait pire que pas de preuve : elle ferait passer le contrôle
     * d'identité en portant une chaîne sans contenu.
     */
    for (const vide of [[], [''], ['   '], undefined] as const) {
      const job = normalizeRmkItem({ ...base, sfstd_marketingBrand_obj: vide }, 'de_DE', 'https://x.test', 'sfstd_marketingBrand_obj');
      expect(job?.employerEvidence, `valeur ${JSON.stringify(vide)}`).toBeUndefined();
    }
  });

  it('la CHAÎNE DE COLLECTE transmet bien le champ configuré', async () => {
    /*
     * LE TÉMOIN QUI MANQUAIT — et son absence a été démontrée : débrancher l'appelant
     * (`normalizeRmkItem(row.response, locale, origin)`, sans `brandProperty`) laissait les cinq
     * autres témoins au VERT, puisqu'ils appellent la fonction pure directement. Un paramètre
     * ajouté mais jamais transmis, c'est un moteur sans appelant : la règle du projet l'interdit.
     *
     * Celui-ci part de `fetchRmkV2Jobs`, le vrai chemin de collecte.
     */
    let page = 0;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(
      page++ === 0
        ? { totalJobs: 1, jobSearchResult: [{ response: { ...base, sfstd_marketingBrand_obj: ['NOCIBE'] } }] }
        : { totalJobs: 1, jobSearchResult: [] }),
      { headers: { 'content-type': 'application/json' } })));

    const res = await fetchRmkV2Jobs('https://x.test', ['de_DE'], 'sfstd_marketingBrand_obj');

    expect(res.jobs).toHaveLength(1);
    expect(res.jobs[0].employerEvidence?.rawName).toBe('NOCIBE');
  });

  it('le nom du champ reste contraint par la validation existante', () => {
    /* `brandProperty` vient de la configuration : il ne doit jamais devenir un chemin arbitraire. */
    expect(brandPropertyOf({ brandProperty: 'sfstd_marketingBrand_obj' })).toBe('sfstd_marketingBrand_obj');
    expect(brandPropertyOf({})).toBeUndefined();
    expect(() => brandPropertyOf({ brandProperty: '../../etc/passwd' })).toThrow();
  });
});
