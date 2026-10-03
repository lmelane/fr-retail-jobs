import type { NormalizedJob } from '../types.js';
import { htmlToPlainText } from '../lib/html.js';
import { DETAIL_CONTENT_MISSING } from './publicationDisposition.js';

/**
 * D-523 §3 (03/10/2026) : « une offre qui ne peut pas être servie est retenue ; sa source ne change pas ». La fiche dont la
 * description est vide une fois réduite à son texte (le contrôle de contenu de la validation native, `publication/recovery.ts`)
 * est retenue (`DETAIL_CONTENT_MISSING`) au lieu d'être publiée sans contenu. Avant, la validation refusait la SOURCE entière
 * au-delà de quelques fiches vides (cotton-on 9, Nike à la limite de 5) et publiait celles d'en dessous.
 *
 * Appliquée par `fetchAtsJobs`, avant le scellement de la sortie, comme la règle de la candidature spontanée : la retenue est
 * dans la capture, donc identique au rejeu et à l'écriture (la politique de publication exige une retenue scellée). Une
 * retenue déjà posée par le lecteur l'emporte (la description vide chez l'éditeur, D-481 §3) ; sans preuve archivable
 * (`raw`), rien ne change.
 */
export function applyContentRetention(job: NormalizedJob): NormalizedJob {
  if (job.publicationHold || job.raw == null) return job;
  return htmlToPlainText(job.description)?.trim() ? job : { ...job, publicationHold: DETAIL_CONTENT_MISSING };
}
