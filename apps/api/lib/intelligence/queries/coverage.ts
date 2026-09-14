import { cached } from '../cache';
import { byCountry, headline, historyStart } from '../facts';
import { firstSnapshotDate } from '../snapshots';
import { OBSERVATION_START } from '../format';

/**
 * La ligne de couverture affichée sur CHAQUE page (règle 3) : « N offres
 * analysées · N Maisons · N pays · historique depuis le <premier snapshot> ·
 * mis à jour <date> ». Un seul jeu de requêtes, mémorisé 1 h.
 */
export type Coverage = {
  jobs: number;
  companies: number;
  countries: number;
  cities: number;
  /** Date du premier snapshot global, sinon le début de l'observation fiable (aucun snapshot encore). */
  historyStart: string;
  /** Vrai s'il existe au moins un snapshot. */
  hasSnapshots: boolean;
  /** Première offre observée dans Job (ISO date), null si base vide. */
  firstJobSeen: string | null;
  /** Dernière observation d'une offre vivante (ISO datetime), null si base vide. */
  updatedAt: string | null;
};

export const getCoverage = cached('coverage', async (): Promise<Coverage> => {
  const [h, countries, firstSnapshot, firstJob] = await Promise.all([headline(), byCountry(), firstSnapshotDate(), historyStart()]);
  return {
    jobs: h.active,
    companies: h.companies,
    countries: countries.rows.length,
    cities: h.cities,
    historyStart: firstSnapshot ?? OBSERVATION_START,
    hasSnapshots: firstSnapshot !== null,
    firstJobSeen: firstJob,
    updatedAt: h.lastSeenAt,
  };
});
