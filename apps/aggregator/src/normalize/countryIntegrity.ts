/**
 * `countryIntegrity` — LE VERDICT PERSISTÉ SUR LA PROVENANCE DU PAYS.
 *
 * La colonne existe depuis D54 mais n'a jamais été écrite : `resolveGeography` produit la provenance
 * (`method`) et `dedup/upsert.ts` n'en gardait que le `countryCode`. **La preuve était calculée puis jetée.**
 * Conséquence mesurée le 2026-09-12 : 0 valeur sur 78 932 offres actives, et 8 843 offres à code pays ambigu
 * inéligibles au balisage faute de provenance exploitable.
 *
 * Ce module est le SEUL endroit où une provenance devient un verdict. Deux propriétés le gouvernent :
 *
 * 1. **LISTE POSITIVE FERMÉE.** Seules trois valeurs prouvent le pays — `RAW_COUNTRY_CODE`, `RAW_COUNTRY`,
 *    `VERIFIED`. Tout le reste ne prouve rien. La liste est fermée dans les deux sens : une provenance inconnue
 *    ne produit AUCUN verdict positif (elle ne « passe » pas par défaut), et un verdict positif ne peut pas
 *    naître ailleurs que d'une entrée de cette table.
 *
 * 2. **UN CODE AMBIGU N'EST PAS UNE PREUVE, MÊME DÉCLARÉ DANS UN CHAMP PAYS.** C'est la conséquence directe de
 *    H-GEO-01, et le défaut que la lecture du code a révélé : `resolveGeography` classe `RAW_COUNTRY` aussi bien
 *    `country: "Canada"` (un nom, preuve indépendante du suffixe) que `country: "CA"` (un code nu, qui ne dit
 *    rien de plus que le suffixe « …, CA » que la règle web refuse déjà). Les deux produisaient le même verdict,
 *    donc le même privilège de balisage — la validation circulaire réintroduite par une autre porte.
 *    `RAW_COUNTRY` ne prouve donc QUE lorsque la source a écrit le pays autrement qu'en deux lettres ambiguës.
 *
 * Ce qui ne produit JAMAIS de verdict positif, nommément :
 *   · le suffixe d'un libellé de lieu (`LOCATION_ADMIN1_SUFFIX`, `LOCATION_COUNTRY_PREFIX`) ;
 *   · le seul fait qu'un `countryCode` existe déjà en base ;
 *   · un format de code postal compatible (H-GEO-01 : `DE`, `US`, `ID`, `IL`, `MA` partagent cinq chiffres) ;
 *   · une provenance inconnue ou absente.
 */
import type { GeoMethod, ResolvedGeography } from './geography.js';

/**
 * Les verdicts POSITIFS. Cette liste est le contrat partagé avec le web
 * (`apps/web/lib/job-posting-schema.ts` — `COUNTRY_INTEGRITY_PROVING`) : les deux doivent énumérer exactement
 * les mêmes valeurs, sans quoi la mesure et le rendu divergeraient en silence.
 */
export const COUNTRY_INTEGRITY_PROVING = ['RAW_COUNTRY_CODE', 'RAW_COUNTRY', 'VERIFIED'] as const;
export type ProvingVerdict = (typeof COUNTRY_INTEGRITY_PROVING)[number];

/**
 * Les codes à deux lettres qui sont À LA FOIS un pays ISO et une subdivision d'un pays fédéral.
 * Sous l'un de ces codes, la forme seule ne tranche pas : « CA » est la Californie ou le Canada, « IN »
 * l'Indiana ou l'Inde, « DE » le Delaware ou l'Allemagne.
 */
const AMBIGUOUS_CODES: ReadonlySet<string> = new Set([
  'AL', 'AR', 'CA', 'CO', 'CT', 'DE', 'GA', 'ID', 'IL', 'IN', 'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO',
  'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'VA', 'VT',
  'WA', 'WI', 'WY',
  // Provinces canadiennes qui sont aussi des codes pays ISO.
  'NL', 'PE', 'SK', 'NU',
]);

/** Le verdict est-il dans la liste positive ? Utilisé par les invariants et les tests. */
export function isProvingVerdict(v: string | null | undefined): v is ProvingVerdict {
  return v != null && (COUNTRY_INTEGRITY_PROVING as readonly string[]).includes(v);
}

/**
 * Le verdict à PERSISTER pour cette résolution géographique.
 *
 * `null` signifie « aucune preuve positive » — ce n'est pas un échec, c'est l'état par défaut et il est
 * conservateur : sans verdict, le balisage exige une autre preuve indépendante ou refuse.
 *
 * @param geo   ce que `resolveGeography` a réellement produit — jamais un drapeau recalculé ailleurs
 * @param rawCountry la valeur brute du champ pays de la source, nécessaire pour distinguer un NOM d'un CODE nu
 */
export function countryIntegrityOf(
  geo: Pick<ResolvedGeography, 'countryCode' | 'method'>,
  rawCountry?: string | null,
): ProvingVerdict | null {
  const { countryCode, method } = geo;
  if (!countryCode || !method) return null;

  switch (method satisfies GeoMethod) {
    /**
     * Un champ `country_code` DÉDIÉ : la source a délibérément publié un code pays, dans un champ dont c'est
     * l'unique objet. Il n'y a pas d'ambiguïté de lecture possible — ce n'est pas un suffixe de libellé.
     */
    case 'RAW_COUNTRY_CODE':
      return 'RAW_COUNTRY_CODE';

    /**
     * Un champ `country` : preuve SEULEMENT s'il ne se réduit pas à un code ambigu.
     * « Canada » prouve ; « CA » ne prouve rien de plus que « …, CA », que la règle web refuse déjà.
     */
    case 'RAW_COUNTRY': {
      const raw = rawCountry?.trim().toUpperCase() ?? '';
      const isBareAmbiguousCode = /^[A-Z]{2}$/.test(raw) && AMBIGUOUS_CODES.has(raw);
      return isBareAmbiguousCode ? null : 'RAW_COUNTRY';
    }

    /**
     * Tout ce qui est LU DANS LE LIBELLÉ ne produit AUCUN verdict persisté.
     *
     * `LOCATION_ADMIN1_SUFFIX` et `LOCATION_COUNTRY_PREFIX` sont précisément le suffixe et le préfixe que
     * H-GEO-01 a écartés : ils ne prouvent rien, et la question ne se pose pas.
     *
     * `LOCATION_COUNTRY_NAME` mérite sa justification, parce qu'il ne se déclenche QUE sur un pays nommé en
     * toutes lettres (« Tokyo, Japan ») ou un code alpha-3 (« Montreal, Quebec, CAN ») — jamais sur un suffixe
     * ambigu à deux lettres. Ce serait donc une preuve recevable. On ne l'ajoute pourtant PAS à la liste
     * positive, pour deux raisons : la liste des verdicts persistés est arrêtée à trois valeurs, et le web sait
     * DÉJÀ lire cette preuve-là directement dans le libellé (`spellsOutCountry`). L'ajouter ici dupliquerait la
     * même preuve dans deux mécanismes, sans rendre une seule offre éligible de plus.
     */
    case 'LOCATION_COUNTRY_PREFIX':
    case 'LOCATION_COUNTRY_NAME':
    case 'LOCATION_ADMIN1_SUFFIX':
      return null;

    default:
      return null;
  }
}
