import { fetchRitualsJobs } from '../ats/adapters/rituals.js';

/**
 * g4 — Rituals, locale par locale : total annoncé, offres lues, pays, et
 * combien d'identifiants sont DÉJÀ vus dans une locale précédente (une offre
 * publiée en plusieurs langues n'est qu'une offre).
 */
const LOCALES = ['da-DK', 'de-AT', 'de-CH', 'de-DE', 'en-GB', 'en-IE', 'en-NL', 'es-ES', 'fi-FI', 'fr-BE', 'fr-CH', 'fr-FR', 'fr-LU', 'hu-HU', 'it-IT', 'nb-NO', 'nl-BE', 'nl-NL', 'pl-PL', 'pt-PT', 'ro-RO', 'sv-SE'];
const seen = new Set<string>();
for (const locale of LOCALES) {
  const { jobs, declaredTotal } = await fetchRitualsJobs({ language: locale });
  const dup = jobs.filter((j) => seen.has(j.externalId)).length;
  for (const j of jobs) seen.add(j.externalId);
  const countries = [...new Set(jobs.map((j) => j.country))].join(',');
  console.log(`${locale.padEnd(6)} total=${String(declaredTotal).padStart(4)} lues=${String(jobs.length).padStart(4)} déjà-vues=${String(dup).padStart(3)} pays=${countries}`);
}
console.log(`uniques toutes locales: ${seen.size}`);
