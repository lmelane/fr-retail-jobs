/**
 * D-517 — LA LECTURE INCRÉMENTALE : découvrir le neuf d'une source sans la relire en entier.
 *
 * « Toutes les sources significatives découvertes en quelques heures ; le RUN quotidien devient le filet de sécurité. »
 * Relire toutes les 6 h les grosses sources en entier coûterait un RUN par passe (une page par offre chez Workday,
 * SmartRecruiters, SuccessFactors…). La lecture incrémentale lit la LISTE entière, comme le RUN, puis ne lit le détail
 * que des publications que la source n'a jamais montrées, et ne rend qu'elles : une publication déjà connue n'est ni
 * relue, ni réécrite, ni touchée.
 *
 * POURQUOI LA LISTE ENTIÈRE, ET PAS « LA PREMIÈRE PAGE PAR DATE, PUIS ARRÊT ». Aucun des adaptateurs concernés n'envoie
 * de tri par date, deux le documentent instable (SuccessFactors RMK, Phenom), et la mesure le confirme : dans les
 * collectes des 3 derniers RUN, une publication nouvelle se trouve au-delà de 90 % de la liste pour Tapestry, adidas,
 * Sephora France, Skechers, Rituals ou WTTJ (`audits/2026-10-02/fraicheur-d517/mesure.out`, F3). S'arrêter à la
 * première offre connue en perdrait. La liste coûte peu (une page pour 20 à 100 offres) ; le détail, une page par offre.
 *
 * CE QU'ELLE N'EST JAMAIS. Une preuve d'absence : elle ne rend que le neuf, donc ne dit rien de ce qu'elle ne rend pas.
 * Son résultat est marqué `incremental` dans le manifeste scellé, `complete: false` et `truncated: true` : il ne peut ni
 * attester une absence (`attestingCapture.ts`), ni rendre une collecte crédible pour la revue de disponibilité
 * (`availability.ts`), ni servir de référence aux gardes du RUN (`referenceRuns.ts`). Seul le RUN complet, ou une
 * lecture complète prouvée, ferme ou masque.
 *
 * L'ÉTAT EXTÉRIEUR, ET LE REJEU. Ce qui est « connu » vient de la base (`knownPostings`), donc la lecture dépend d'un
 * état que la capture ne contient pas. La validation et l'adoption rejouent pourtant chaque collecte hors réseau et
 * exigent le même résultat. Le résultat scelle donc `knownSkipped` : les identifiants que la lecture a vus et laissés
 * de côté. Le rejeu rétablit exactement cet ensemble (`capture/batch.ts`) et refait les mêmes choix ; hors d'une
 * lecture incrémentale, le rejeu s'exécute explicitement SANS contexte, pour qu'une lecture en cours ne déteigne
 * jamais sur la vérification d'une autre capture.
 *
 * Un adaptateur qui sait lire le détail à part demande `isKnownPosting(id)` AVANT de le lire, avec l'identifiant
 * canonique (celui de `JobSource.externalId`) ; ceux qui ne le savent pas (liste qui porte tout : Teamtailor, Jibe,
 * LVMH…) sont filtrés après coup par `fetchAtsJobs` (`ats/index.ts`), qui rend le même verdict pour tous.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AdapterResult } from '../types.js';

export const INCREMENTAL_READING_POLICY = 'd517-incremental/1';

type Reading = { known: ReadonlySet<string>; skipped: Set<string> };
const readings = new AsyncLocalStorage<Reading | null>();

/** Runs `work` as an incremental reading of a source whose already-known canonical ids are `known`. */
export function withIncrementalReading<T>(known: Iterable<string>, work: () => Promise<T>): Promise<T> {
  return readings.run({ known: new Set(known), skipped: new Set() }, work);
}

/** Runs `work` with NO incremental reading, whatever the caller's context (a replay of another capture). */
export function withoutIncrementalReading<T>(work: () => Promise<T>): Promise<T> {
  return readings.run(null, work);
}

export const incrementalReadingActive = (): boolean => !!readings.getStore();

/**
 * Is this canonical id already known to the source, in an incremental reading? Records it as skipped when it is.
 * Outside an incremental reading, always false: the adapter reads everything, exactly as before.
 */
export function isKnownPosting(externalId: string | null | undefined): boolean {
  const reading = readings.getStore();
  if (!reading || !externalId || !reading.known.has(externalId)) return false;
  reading.skipped.add(externalId);
  return true;
}

/** The known ids this incremental reading has set aside so far (none outside a reading): a named disposition. */
export function incrementalSkippedIds(): string[] {
  return [...(readings.getStore()?.skipped ?? [])];
}

/**
 * The adapter result of an incremental reading: only the postings the source never showed, sealed as never complete
 * and never attesting, with the sorted ids it saw and set aside. Outside an incremental reading, `result` unchanged.
 */
export function finishIncrementalReading(result: AdapterResult): AdapterResult {
  const reading = readings.getStore();
  if (!reading) return result;
  const jobs = result.jobs.filter(job => !isKnownPosting(job.externalId));
  return { ...result, jobs, complete: false, truncated: true, enumerationVerdict: 'REFUTED',
    incremental: { policy: INCREMENTAL_READING_POLICY, knownSkipped: [...reading.skipped].sort() } };
}

/** Does this sealed adapter metadata come from an incremental reading? */
export function isIncrementalResult(metadata: { incremental?: unknown } | null | undefined): boolean {
  return !!metadata && metadata.incremental !== undefined && metadata.incremental !== null;
}

/**
 * LA PASSE QUI DEMANDE LA LECTURE INCRÉMENTALE. La passe de découverte (`pipeline/lightPass.ts`) l'arme autour de chaque
 * source ; seule la COLLECTE D'OFFRES de l'ingestion (`pipeline/ingest.ts`) la convertit en lecture incrémentale. Une
 * qualification native (`maintainSourceAccess`) lit toujours tout ; la passe n'en déclenche pas (elle laisse au RUN toute
 * source dont la qualification expire dans l'heure), et sa propre collecte validée rafraîchit la qualification.
 */
const passes = new AsyncLocalStorage<boolean>();
export const withIncrementalPass = <T>(work: () => Promise<T>): Promise<T> => passes.run(true, work);
export const incrementalPassActive = (): boolean => passes.getStore() === true;
