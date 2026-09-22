import { describe, expect, it } from 'vitest';
import { resolveGeography } from './geography.js';
import { countryIntegrityOf } from './countryIntegrity.js';

/**
 * LE CHAMP PAYS NATIF DOIT UTILISER LE DICTIONNAIRE CANONIQUE.
 *
 * ── LE DÉFAUT MESURÉ ───────────────────────────────────────────────────────────────────────────
 *
 * Deux dictionnaires coexistaient. `country.ts` connaît 6 232 libellés CLDR en 38 langues ;
 * `geography.ts` portait sa propre table `COUNTRY_NAMES`, réduite. Une source publiant le nom de
 * son pays dans sa langue perdait donc toute preuve géographique :
 *
 *     rawCountry            normalizeCountry   resolveGeography      countryIntegrity
 *     "Germany"             DE                 RAW_COUNTRY → DE      RAW_COUNTRY     ✅
 *     "Chinese Mainland"    CN                 undefined             null            ❌
 *     "Nederland"           NL                 undefined             null            ❌
 *     "Österreich"          AT                 undefined             null            ❌
 *
 * `Germany` passait parce qu'il figurait dans les DEUX tables. Mesuré sur le catalogue consolidé
 * le 2026-09-22 : 1 410 offres non prouvées sur les seuls marchés NL, CN, DE+AT et CA, dont 578
 * pour le seul libellé « Chinese Mainland » de LVMH.
 *
 * ── CE QUE CE LOT NE TOUCHE PAS ────────────────────────────────────────────────────────────────
 *
 * Uniquement le chemin `rawCountry` — un champ dont le pays est l'UNIQUE objet. Le parsing des
 * LIBELLÉS DE LIEU garde sa table conservatrice : y faire entrer 6 232 libellés rendrait
 * « Los Angeles, CA » résoluble en Canada, soit exactement l'inférence que `countryIntegrity.ts`
 * existe pour interdire. Les deux derniers témoins gardent cette frontière.
 */
describe('pays natif : le dictionnaire canonique', () => {
  const resoudre = (rawCountry: string) => {
    const geo = resolveGeography({ rawCountry, location: 'Berlin', city: 'Berlin' } as never);
    return { ...geo, verdict: countryIntegrityOf(geo, rawCountry) };
  };

  it('résout un libellé natif non anglais et le PROUVE', () => {
    /* LES TROIS CAS MESURÉS, dans leur forme exacte servie par les sources. */
    for (const [libelle, attendu] of [['Chinese Mainland', 'CN'], ['Nederland', 'NL'], ['Österreich', 'AT']] as const) {
      const r = resoudre(libelle);
      expect(r.countryCode, libelle).toBe(attendu);
      expect(r.method, libelle).toBe('RAW_COUNTRY');
      expect(r.verdict, libelle).toBe('RAW_COUNTRY');
    }
  });

  it('NON-RÉGRESSION : un libellé déjà reconnu garde son comportement', () => {
    const r = resoudre('Germany');
    expect(r.countryCode).toBe('DE');
    expect(r.method).toBe('RAW_COUNTRY');
    expect(r.verdict).toBe('RAW_COUNTRY');
  });

  it('un CODE AMBIGU en champ pays ne devient JAMAIS une preuve', () => {
    /*
     * La doctrine reste entière : `CA` peut être la Californie, `DE` le Delaware, `IN` l'Indiana.
     * Le code est retenu comme valeur, mais ne prouve rien. C'est `countryIntegrityOf` qui
     * tranche, et ce lot ne modifie pas cette règle.
     */
    for (const code of ['CA', 'DE', 'IN']) {
      const r = resoudre(code);
      expect(r.verdict, `code ${code}`).toBeNull();
    }
  });

  it('un libellé de LIEU ne profite pas de l\'élargissement', () => {
    /*
     * LE GARDE-FOU DU LOT. Si l'élargissement fuitait vers le parsing de `location`,
     * « Los Angeles, CA » deviendrait le Canada — l'inférence exacte que la doctrine interdit.
     */
    const la = resolveGeography({ location: 'Los Angeles, CA', city: 'Los Angeles' } as never);
    expect(countryIntegrityOf(la, undefined)).toBeNull();
    expect(la.countryCode === 'CA' && la.method === 'RAW_COUNTRY').toBe(false);

    const paris = resolveGeography({ location: 'Paris, TX', city: 'Paris' } as never);
    expect(paris.countryCode, 'Paris, TX ne doit pas devenir la France').not.toBe('FR');
  });

  it('un CODE à deux lettres n\'est JAMAIS cherché comme un nom CLDR', () => {
    /*
     * LE DÉFAUT QUE LA MESURE D'IMPACT A ATTRAPÉ, avant tout rerun. Le référentiel CLDR indexe
     * des NOMS, et certains noms courts collisionnent avec des codes ISO : `"ru"` y résout vers
     * **GB**, pas vers la Russie. Une première version interrogeait CLDR avec la valeur brute et
     * transformait donc des offres russes en britanniques.
     *
     * Les codes restent traités par la branche dédiée, qui les valide comme codes ISO.
     */
    const ru = resoudre('ru');
    expect(ru.countryCode, 'ru ne doit pas devenir GB').not.toBe('GB');
    expect(ru.countryCode).toBe('RU');
  });

  it('PRÉMISSE : sans le correctif, ces libellés ne résolvaient RIEN', () => {
    /*
     * Un témoin dont la prémisse n'est pas vérifiée peut passer au vert sans exercer le défaut.
     * Ici : `Germany` a toujours fonctionné, les trois autres non — c'est bien l'écart entre les
     * deux dictionnaires qui est testé, pas la résolution en général.
     */
    expect(resoudre('Germany').countryCode).toBe('DE');
    expect(resolveGeography({ rawCountry: 'libellé qui n\'existe pas' } as never).countryCode).toBeUndefined();
  });
});
