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
export type JobsResultListe = Omit<JobsResult, 'jobs' | 'facets'> & {
  jobs: JobListe[];
  facets: JobsResult['facets'] & {
    contracts: FacetteLibellee[];
    workTimes: FacetteLibellee[];
    programs: FacetteLibellee[];
    engagements: FacetteLibellee[];
    countries: FacetteLibellee[];
    languages: FacetteLibellee[];
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

function libellerFacette(
  facette: { value: string; count: number }[] | undefined,
  libelle: (value: string) => string | null,
): FacetteLibellee[] {
  return (facette ?? []).map((f) => ({ ...f, label: libelle(f.value) ?? f.value }));
}

export function projeterListe(result: JobsResult): JobsResultListe {
  return {
    ...result,
    jobs: projeterLignes(result.jobs),
    facets: {
      ...result.facets,
      contracts: libellerFacette(result.facets.contracts, employmentTermLabel),
      workTimes: libellerFacette(result.facets.workTimes, workTimeLabel),
      programs: libellerFacette(result.facets.programs, programTypeLabel),
      engagements: libellerFacette(result.facets.engagements, engagementTypeLabel),
      countries: libellerFacette(result.facets.countries, (code) => countryLabel(code)),
      languages: libellerFacette(result.facets.languages, languageLabel),
    },
  };
}
