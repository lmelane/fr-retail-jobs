import type { JobRow, JobsResult } from './jobs';
import { employmentTermLabel, workTimeLabel, workplaceTypeLabel } from './format';

/**
 * Projection « liste » de `/api/jobs?champs=liste` (F1, phase 1).
 *
 * Mesuré le 14/09/2026 : une page de 25 offres pesait 173 Ko parce que chaque
 * ligne embarquait sa `description` complète, qu'aucune liste n'affiche. La
 * projection la retire et AJOUTE les libellés d'affichage des dimensions
 * d'emploi (« CDI » pour `PERMANENT`), calculés ici avec le vocabulaire
 * unique de `@catwalks/db/presentation` : un front ne recopie jamais cette
 * table.
 */
export type JobListe = Omit<JobRow, 'description'> & {
  employmentTermLabel: string | null;
  workTimeLabel: string | null;
  workplaceTypeLabel: string | null;
};

export type JobsResultListe = Omit<JobsResult, 'jobs'> & { jobs: JobListe[] };

export function projeterListe(result: JobsResult): JobsResultListe {
  return {
    ...result,
    jobs: result.jobs.map((job) => {
      const { description: _description, ...reste } = job;
      return {
        ...reste,
        employmentTermLabel: employmentTermLabel(job.employmentTerm),
        workTimeLabel: workTimeLabel(job.workTime),
        workplaceTypeLabel: workplaceTypeLabel(job.workplaceType),
      };
    }),
  };
}
