import type { JobRow, JobsResult } from './jobs';
import { countryLabel } from './countries';
import {
  employmentTermLabel,
  engagementTypeLabel,
  programTypeLabel,
  workTimeLabel,
  workplaceTypeLabel,
  type LangueLibelles,
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
 * Lot 8 : les libellés d'emploi, de pays et de langue suivent la LANGUE DES
 * LIBELLÉS du périmètre servi (`perimetre.langueDesLibelles` : la langue de
 * service du marché quand un catalogue existe, sinon le français) ; une fiche
 * lue par son identifiant suit le marché du pays de l'offre.
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

function nomsIntl(langue: LangueLibelles, type: 'language' | 'region'): Intl.DisplayNames | null {
  try {
    return typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames([langue], { type, fallback: 'none' }) : null;
  } catch {
    return null;
  }
}
const NOMS = {
  fr: { language: nomsIntl('fr', 'language'), region: nomsIntl('fr', 'region') },
  en: { language: nomsIntl('en', 'language'), region: nomsIntl('en', 'region') },
} as const;

/** « fr » → « Français » / « French », capitalisé ; un code inconnu reste tel quel. */
export function languageLabel(code: string, langue: LangueLibelles = 'fr'): string {
  try {
    const l = NOMS[langue].language?.of(code);
    return l ? l.charAt(0).toUpperCase() + l.slice(1) : code;
  } catch {
    return code;
  }
}

/** Le nom d'un pays : la table française vérifiée, ou `Intl` dans la langue des libellés. */
function nomPays(code: string, langue: LangueLibelles): string {
  if (langue === 'fr') return countryLabel(code);
  try {
    const nom = NOMS[langue].region?.of(code.toUpperCase());
    return nom && nom !== code ? nom : countryLabel(code);
  } catch {
    return countryLabel(code);
  }
}

function libelles(job: JobRow, langue: LangueLibelles): Libelles {
  return {
    employmentTermLabel: employmentTermLabel(job.employmentTerm, langue),
    workTimeLabel: workTimeLabel(job.workTime, langue),
    programTypeLabel: programTypeLabel(job.programType, langue),
    engagementTypeLabel: engagementTypeLabel(job.engagementType, langue),
    workplaceTypeLabel: workplaceTypeLabel(job.workplaceType, langue),
    countryLabel: job.countryCode ? nomPays(job.countryCode, langue) : null,
  };
}

/** Une ligne de liste : sans description, avec ses libellés dans la langue demandée. */
export function projeterLigne(job: JobRow, langue: LangueLibelles = 'fr'): JobListe {
  const { description: _description, ...reste } = job;
  return { ...reste, ...libelles(job, langue) };
}

export function projeterLignes(jobs: JobRow[], langue: LangueLibelles = 'fr'): JobListe[] {
  return jobs.map((job) => projeterLigne(job, langue));
}

/** Une fiche : la ligne complète, description comprise, avec ses libellés. */
export function projeterFiche(job: JobRow, langue: LangueLibelles = 'fr'): JobFiche {
  return { ...job, ...libelles(job, langue) };
}

/** La liste servie : chaque ligne libellée dans la langue des libellés du périmètre. */
export function projeterListe(result: JobsResult): JobsResultListe {
  return { ...result, jobs: projeterLignes(result.jobs, result.perimetre.langueDesLibelles) };
}
