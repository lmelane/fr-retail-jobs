import { describe, it, expect } from 'vitest';
import { resolveGeography } from '../geography.js';
import { normalizeCountry, countryFromLocation } from '../country.js';
import { declaredPlaceVerdict } from '../declaredPlaceCountry.js';

/**
 * D-435 LOT 1A — LA CHAÎNE COMPLÈTE, PAS SEULEMENT LE MAILLON.
 *
 * ── POURQUOI CE FICHIER EXISTE ────────────────────────────────────────────
 *
 * Le CEO, le 14/09/2026 : « obtenir `undefined` dans un helper ne suffit pas à
 * démontrer que l'ancienne valeur sera retirée ou signalée lors de la mise à
 * jour. Vérifier qu'une abstention pour ambiguïté ne peut pas être annulée par
 * un lecteur de secours utilisant la même information. »
 *
 * Le témoin `collision-pays-etat-d435.test.ts` ne teste QUE
 * `countryFromLocation`. Celui-ci rejoue l'ORDRE RÉEL de `retainedCountryOf`
 * (`publication/content.ts` ; `dedup/upsert.ts` à l'écriture de ce témoin), sans
 * le contrôle par les lieux déclarés (D-440/D-442) qui s'applique ensuite :
 *
 *     normalizeCountry(candidate.country)
 *       ?? resolveGeography(...).countryCode
 *       ?? countryFromLocation(candidate.location)
 *
 * C'est cet ordre qui décide, pas la fonction corrigée seule.
 *
 * ── LIMITE DE CE TÉMOIN, À NE PAS SURVENDRE ───────────────────────────────
 *
 * Il REPRODUIT la chaîne, il ne l'IMPORTE pas : `retainedCountryOf` n'est pas
 * exportée. Il peut donc diverger si `upsert.ts` change sans que ce fichier
 * suive. Une assertion de garde ci-dessous vérifie au moins que les trois
 * maillons existent et sont appelables ; l'import direct relève du lot 2.
 */

/** L'ordre de `retainedCountryOf` + `countryWithProvenance`, reproduit. */
function chaineComplete(candidat: { country?: string | null; location?: string | null; city?: string | null }): {
  pays: string | undefined;
  integrite: string | null;
} {
  const geo = resolveGeography({
    rawCountry: candidat.country ?? undefined,
    location: candidat.location ?? undefined,
    city: candidat.city ?? undefined,
  });
  const pays =
    normalizeCountry(candidat.country ?? undefined) ??
    geo.countryCode ??
    countryFromLocation(candidat.location ?? undefined);
  const integrite = pays && pays === geo.countryCode ? (geo.countryIntegrity ?? null) : null;
  return { pays, integrite };
}

describe('la chaîne géographique complète (D-435 lot 1A)', () => {
  it('PRÉMISSE : les trois maillons de la chaîne existent et sont appelables', () => {
    // Sans cela, ce témoin pourrait passer au vert en testant du vide.
    expect(typeof normalizeCountry).toBe('function');
    expect(typeof resolveGeography).toBe('function');
    expect(typeof countryFromLocation).toBe('function');
  });

  it('forme RÉELLE des 176 offres : le repli ne défait plus l’abstention', () => {
    /*
     * `avature.ts:335` remplit `country` avec `portalField(html, 'Location')` :
     * pour ces offres, le champ « pays » contient donc le LIBELLÉ DU LIEU.
     * C'est la forme qui a produit le défaut mesuré en production.
     */
    for (const libelle of [
      'Indianapolis, IN',
      'Florence, KY',
      'Richmond, VA',
      'North Little Rock, AR',
      'Attleboro, MA',
      'Champaign, IL',
    ]) {
      const { pays } = chaineComplete({ country: libelle, location: libelle });
      expect(pays, `« ${libelle} » ne doit plus produire de pays étranger`).toBeUndefined();
    }
  });

  it('les libellés étrangers légitimes traversent la chaîne intacts', () => {
    // Le correctif ne doit pas assécher le catalogue international.
    const cas: ReadonlyArray<readonly [string, string]> = [
      ['Paris, France', 'FR'],
      ['Berlin, Germany', 'DE'],
      ['Munich, BY, de', 'DE'],
      ['Toronto, ON, CA', 'CA'],
      ['Casablanca, Maroc', 'MA'],
    ];
    for (const [libelle, attendu] of cas) {
      const { pays } = chaineComplete({ country: libelle, location: libelle });
      expect(pays, `« ${libelle} » doit rester ${attendu}`).toBe(attendu);
    }
  });

  it('DÉFAUT CONNU : un champ pays DÉCLARÉ faux traverse la chaîne sans garde', () => {
    /*
     * CE TÉMOIN GRAVE UN DÉFAUT OUVERT, PAS UN SUCCÈS — POUR CETTE FORME PRÉCISE.
     *
     * `retainedCountryOf` (aujourd'hui dans `publication/content.ts`) consulte
     * `normalizeCountry(candidate.country)` EN PREMIER. Si une source déclare
     * `country: "IN"` pour une offre d'Indianapolis, la valeur est retenue telle
     * quelle : ni `resolveGeography` ni `countryFromLocation` ne sont atteints,
     * et le correctif de collision ne s'applique pas du tout.
     *
     * Pire pour la traçabilité : `countryIntegrity` vaut `null` — donc RIEN ne
     * signale l'anomalie. Le modèle prévoit pourtant `AMBIGUOUS` pour ce rôle.
     *
     * L'ARBITRAGE A ÉTÉ RENDU, EN PARTIE (D-440 point 1, D-442, 24/09/2026) : quand
     * les LIEUX DÉCLARÉS de la publication (`sourceFacts.locations`) nomment un
     * autre pays que le champ, la projection prend le pays de l'adresse si trois
     * champs d'adresse au moins le nomment, et s'abstient sinon
     * (`normalize/declaredPlaceCountry.ts`, témoins dans
     * `publication/pays-contradictoire-d440.test.ts` et
     * `publication/pays-adresse-territoire-d442.test.ts`).
     *
     * Cette forme-ci n'y entre PAS : « Indianapolis, IN » ne nomme aucun pays (le
     * suffixe `IN` collisionne avec l'Inde et rien ne confirme les États-Unis), et
     * aucun autre champ d'adresse ne contredit le champ pays. Aucune source du
     * catalogue n'est aujourd'hui CONNUE pour émettre cette forme — Avature met le
     * libellé du lieu dans ce champ, cas couvert par le témoin précédent. Elle
     * reste ouverte, et son traitement reste une décision du CEO.
     *
     * Si ce test passe un jour au ROUGE parce que la chaîne s'abstient, ce
     * n'est PAS une régression : c'est que l'arbitrage a été étendu à cette forme.
     * Mettre alors ce témoin à jour.
     */
    const { pays, integrite } = chaineComplete({ country: 'IN', location: 'Indianapolis, IN' });
    expect(pays, 'état documenté : la déclaration de source prime').toBe('IN');
    expect(integrite, 'et rien ne le signale — c’est le second volet du défaut').toBeNull();
    // Et la règle des lieux déclarés (D-440/D-442) ne la rattrape pas : le lieu redit le champ.
    const lieu = { path: '/0', label: 'Indianapolis, IN', city: null, region: null, postalCode: null, country: 'IN',
      latitude: null, longitude: null, coordinateStatus: 'NOT_OBSERVED' as const, issues: [] };
    expect(declaredPlaceVerdict({ retained: 'IN', countryField: 'IN',
      locations: { status: 'DECLARED', value: [lieu], evidence: [], issues: [] } })).toEqual({ basis: 'RETAINED', countryCode: 'IN' });
  });
});
