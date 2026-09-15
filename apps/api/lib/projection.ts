import type { JobRow, JobsResult } from './jobs';
import { countryLabel } from './countries';
import {
  employmentTermLabel,
  engagementTypeLabel,
  programTypeLabel,
  workTimeLabel,
  workplaceTypeLabel,
} from './format';

/**
 * Projections JSON de l'API de lecture (F1, phase 1).
 *
 * Mesuré le 14/09/2026 : une page de 25 offres pesait 173 Ko parce que chaque
 * ligne embarquait sa `description` complète, qu'aucune liste n'affiche. La
 * projection « liste » la retire. Les deux projections AJOUTENT les libellés
 * d'affichage des dimensions d'emploi (« CDI » pour `PERMANENT`) et des pays,
 * calculés ici avec le vocabulaire unique de `@catwalks/db/presentation` et
 * `lib/countries` : un front ne recopie jamais ces tables.
 */
type Libelles = {
  employmentTermLabel: string | null;
  workTimeLabel: string | null;
  programTypeLabel: string | null;
  engagementTypeLabel: string | null;
  workplaceTypeLabel: string | null;
  countryLabel: string | null;
};

export type JobListe = Omit<JobRow, 'description'> & Libelles;
export type JobFiche = JobRow & Libelles;

type FacetteLibellee = { value: string; count: number; label: string };
/**
 * Les facettes libellées CONSERVENT l'absence décidée par le marché.
 *
 * `contracts` et consorts sont optionnelles ici comme dans `JobsResult` : une
 * facette que le marché ne justifie pas est ABSENTE de la réponse, jamais
 * réduite à `[]`. Les remettre à `[]` au moment de poser les libellés
 * annulerait le lot « facettes natives » sur le seul chemin qui compte — c'est
 * `projeterListe` que sert `/api/jobs`, donc le front ne verrait jamais la
 * distinction que l'API prend soin de produire en amont.
 *
 * Rappel du contrat : clé absente = « pas de facette sur ce marché » ; tableau
 * vide = « facette légitime, aucune valeur pour cette recherche ».
 */
export type JobsResultListe = Omit<JobsResult, 'jobs' | 'facets'> & {
  jobs: JobListe[];
  facets: JobsResult['facets'] & {
    contracts?: FacetteLibellee[];
    workTimes?: FacetteLibellee[];
    programs?: FacetteLibellee[];
    engagements?: FacetteLibellee[];
    countries: FacetteLibellee[];
    languages?: FacetteLibellee[];
  };
};

const LANGUES_FR = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['fr'], { type: 'language', fallback: 'none' }) : null;
/** « fr » → « Français », capitalisé ; un code inconnu reste tel quel. */
export function languageLabel(code: string): string {
  try {
    const l = LANGUES_FR?.of(code);
    return l ? l.charAt(0).toUpperCase() + l.slice(1) : code;
  } catch {
    return code;
  }
}

function libelles(job: JobRow): Libelles {
  return {
    employmentTermLabel: employmentTermLabel(job.employmentTerm),
    workTimeLabel: workTimeLabel(job.workTime),
    programTypeLabel: programTypeLabel(job.programType),
    engagementTypeLabel: engagementTypeLabel(job.engagementType),
    workplaceTypeLabel: workplaceTypeLabel(job.workplaceType),
    countryLabel: job.countryCode ? countryLabel(job.countryCode) : null,
  };
}

/** Une ligne de liste : sans description, avec ses libellés. */
export function projeterLigne(job: JobRow): JobListe {
  const { description: _description, ...reste } = job;
  return { ...reste, ...libelles(job) };
}

export function projeterLignes(jobs: JobRow[]): JobListe[] {
  return jobs.map(projeterLigne);
}

/** Une fiche : la ligne complète, description comprise, avec ses libellés. */
export function projeterFiche(job: JobRow): JobFiche {
  return { ...job, ...libelles(job) };
}

/**
 * Pose les libellés SANS jamais inventer une facette absente.
 *
 * Le `?? []` d'origine transformait « facette non servie sur ce marché » en
 * « facette vide » — deux messages opposés pour le front, confondus au dernier
 * moment. Une surcharge garde la garantie côté appelant : une facette
 * obligatoire en entrée reste obligatoire en sortie.
 */
function libellerFacette(
  facette: { value: string; count: number }[],
  libelle: (value: string) => string | null,
): FacetteLibellee[];
function libellerFacette(
  facette: { value: string; count: number }[] | undefined,
  libelle: (value: string) => string | null,
): FacetteLibellee[] | undefined;
function libellerFacette(
  facette: { value: string; count: number }[] | undefined,
  libelle: (value: string) => string | null,
): FacetteLibellee[] | undefined {
  // `undefined` traverse intact ; `[]` reste `[]`. La distinction est le contrat.
  return facette?.map((f) => ({ ...f, label: libelle(f.value) ?? f.value }));
}

/** `{ cle: valeur }` si la facette existe, `{}` sinon — pour un spread qui n'invente pas de clé. */
function siPresente<K extends string>(cle: K, valeur: FacetteLibellee[] | undefined) {
  return (valeur === undefined ? {} : { [cle]: valeur }) as { [P in K]?: FacetteLibellee[] };
}

export function projeterListe(result: JobsResult): JobsResultListe {
  /*
   * Les facettes à libeller sont SORTIES du spread, pas simplement réécrites
   * par-dessus. Laissées dedans, elles y apporteraient leur type NON libellé
   * (`{value,count}` sans `label`) ; un spread suivi de clés optionnelles ne
   * remplace pas ce type aux yeux du compilateur, il l'unit. La destructuration
   * rend l'intention explicite et garde le typage juste sans aucun `as`.
   */
  const { contracts, workTimes, programs, engagements, countries, languages, ...autresFacettes } = result.facets;
  return {
    ...result,
    jobs: projeterLignes(result.jobs),
    /*
     * SPREAD CONDITIONNEL, et ce n'est pas une coquetterie.
     *
     * Écrire `contracts: libellerFacette(...)` recrée la CLÉ avec la valeur
     * `undefined`. `JSON.stringify` l'omet, donc la réponse HTTP paraît
     * correcte — mais tout code qui teste `'contracts' in facets` (côté rendu
     * serveur, où l'objet ne passe par aucune sérialisation) la verrait
     * PRÉSENTE. Le contrat « absente ≠ vide » se serait alors tenu sur un
     * chemin et pas sur l'autre : exactement le genre d'écart qu'aucun
     * typecheck ne signale.
     *
     * Le spread conditionnel n'ajoute la clé que si la facette existe.
     */
    facets: {
      ...autresFacettes,
      ...siPresente('contracts', libellerFacette(contracts, employmentTermLabel)),
      ...siPresente('workTimes', libellerFacette(workTimes, workTimeLabel)),
      ...siPresente('programs', libellerFacette(programs, programTypeLabel)),
      ...siPresente('engagements', libellerFacette(engagements, engagementTypeLabel)),
      // `countries` n'est jamais conditionnelle : un pays est un pays sur tous
      // les marchés, et le registre n'a aucune mesure la concernant.
      countries: libellerFacette(countries, (code) => countryLabel(code)),
      ...siPresente('languages', libellerFacette(languages, languageLabel)),
    },
  };
}
