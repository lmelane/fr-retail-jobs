import { employmentLabel, langueDesLibelles } from '@catwalks/db/presentation';
import { filtresDuMarche, localeServie, TYPE_FILTRE_PAR_DEFAUT, type CleFacette, type TypeFiltre } from '@catwalks/db/marches';
import type { Facet } from './job-search-query';
import { getSectorPresentation } from './sectors';
import type { OptionalOccupationPresentation } from './occupations';
import type { PlanRecherche } from './search-plan';

export type OptionFacette = { value: string; label: string; count: number };
/** Une facette telle que l'API la sert : sa clé d'URL, son libellé natif, ses options comptées. */
/**
 * Une facette servie au front : sa clé, son libellé natif, son TYPE D'INTERACTION et ses options.
 *
 * `type` dit au front ce qu'il doit RENDRE — liste à cocher, autocomplétion ou interrupteur — et
 * lui évite de refaire une règle de seuil ou de cardinalité que le registre a déjà tranchée.
 */
export type FacetteServie = { cle: CleFacette; libelle: string; type: TypeFiltre; options: OptionFacette[] };

/**
 * A city name canonicalized for display: trimmed and Title Cased so "PARIS",
 * "paris" and "Paris" collapse to one "Paris". The facet groups on
 * `lower(trim(city))`, so one city is one option whatever the source spelling.
 */
export function canonicalCity(raw: string): string {
  return raw
    .trim()
    .toLocaleLowerCase('fr-FR')
    .replace(/(^|[\s'’-])([a-zà-ÿ])/g, (_, sep, ch) => sep + ch.toLocaleUpperCase('fr-FR'));
}

/** Les noms de pays et de langues dans la langue de service du périmètre, sans texte inventé. */
function nomsIntl(locale: string, type: 'region' | 'language'): (code: string) => string {
  try {
    const noms = new Intl.DisplayNames([locale], { type, fallback: 'none' });
    return (code) => {
      try {
        const nom = noms.of(type === 'region' ? code.toUpperCase() : code);
        return nom ? nom.charAt(0).toUpperCase() + nom.slice(1) : code;
      } catch {
        return code;
      }
    };
  } catch {
    return (code) => code;
  }
}

/**
 * LES OPTIONS LIBELLÉES DU CONTRAT DE FACETTES (lot 6).
 *
 * Les libellés de facette viennent du registre ; les libellés d'OPTIONS
 * viennent du vocabulaire unique de l'API : la taxonomie des métiers, la
 * présentation des secteurs, les libellés d'emploi, et `Intl` dans la langue
 * de service du marché pour les pays et les langues. Une option à zéro n'est
 * jamais servie : les comptes excluent déjà la sélection de la facette, donc
 * une option absente est une option qu'aucune offre ne remplirait.
 *
 * Lot 8 : les libellés d'emploi suivent la langue des libellés du marché
 * (`langueDesLibelles` : sa langue de service quand un catalogue existe, sinon
 * le français, nommément). Limite : les libellés de métier et de secteur
 * viennent de présentations françaises (taxonomie, secteurs) sur tous les
 * marchés.
 */
export async function libellerFacettes(
  plan: PlanRecherche,
  brutes: Record<CleFacette, Facet[]>,
  taxonomy: OptionalOccupationPresentation,
): Promise<FacetteServie[]> {
  /*
   * LA LOCALE SERVIE, PAS LA LOCALE CIBLE — voir `localeServie` dans le registre.
   *
   * Un marché en repli (`pl-PL` visé, `en-GB` servi) doit rendre TOUTE sa page dans la même
   * langue. Lire `localeParDefaut` ici produirait un mélange : `Intl` sait nommer les pays en
   * polonais, mais `employmentLabel` n'a pas de catalogue `pl` et retomberait sur le français —
   * une même barre de filtres moitié polonaise, moitié française.
   */
  const locale = localeServie(plan.perimetre.marche) ?? 'fr-FR';
  const langue = langueDesLibelles(locale);
  const pays = nomsIntl(locale, 'region');
  const langues = nomsIntl(locale, 'language');
  const secteurs = (await getSectorPresentation()).labels;
  const libelle: Record<CleFacette, (value: string) => string> = {
    pays,
    metier: (v) => v === 'unclassified' ? 'Métier à préciser' : taxonomy.occupationLabel(v) ?? 'Libellé indisponible',
    secteur: (v) => secteurs[v] ?? 'Secteur à vérifier',
    contrat: (v) => employmentLabel('employmentTerm', v, langue) ?? v,
    temps: (v) => employmentLabel('workTime', v, langue) ?? v,
    programme: (v) => employmentLabel('programType', v, langue) ?? v,
    ville: canonicalCity,
    maison: (v) => v,
    groupe: (v) => v,
    langue: langues,
  };
  /* Le type vient du registre, jamais d'un calcul local : une ville se cherche partout. */
  const types = new Map(filtresDuMarche(plan.perimetre).map((f) => [f.cle, f.type]));
  return plan.facettes.map(({ cle, libelle: nom }) => ({
    cle,
    libelle: nom,
    type: types.get(cle) ?? TYPE_FILTRE_PAR_DEFAUT[cle],
    options: (brutes[cle] ?? []).filter((f) => f.count > 0).map((f) => ({ value: f.value, label: libelle[cle](f.value), count: f.count })),
  }));
}
