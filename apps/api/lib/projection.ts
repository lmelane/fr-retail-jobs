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
 * Projections JSON de l'API de lecture (F1, phase 1 ; lot 6).
 *
 * Mesuré le 14/09/2026 : une page de 25 offres pesait 173 Ko parce que chaque
 * ligne embarquait sa `description` complète, qu'aucune liste n'affiche. La
 * projection « liste » la retire — c'est la seule forme que `/api/jobs` sert.
 * Les deux projections AJOUTENT les libellés d'affichage des dimensions
 * d'emploi (« CDI » pour `PERMANENT`) et des pays, calculés ici avec le
 * vocabulaire unique de `@catwalks/db/presentation` et `lib/countries` : un
 * front ne recopie jamais ces tables. Les facettes arrivent déjà libellées
 * depuis le contrat (`lib/facettes.ts`) ; rien n'est réécrit ici.
 *
 * Limite connue, à lever au lot 8 : ces libellés de ligne sont français quel
 * que soit le marché servi.
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
export type JobsResultListe = Omit<JobsResult, 'jobs'> & { jobs: JobListe[] };

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

export function projeterListe(result: JobsResult): JobsResultListe {
  return { ...result, jobs: projeterLignes(result.jobs) };
}
