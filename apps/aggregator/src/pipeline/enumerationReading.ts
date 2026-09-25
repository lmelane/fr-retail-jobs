/**
 * LA LECTURE D'UNE ÉNUMÉRATION PAR LE RUN : PROUVÉE, NON PROUVÉE, RÉFUTÉE OU INCONNUE (D-453 §1, 24/09/2026).
 *
 * `complete` est à trois valeurs (`enumeration.ts`) : `true` prouve, l'absence ne dit rien, `false` refuse la
 * preuve. Mais `false` recouvre deux faits que le bilan confondait :
 *
 *   · RÉFUTÉE — un fait OBSERVÉ contredit la fin du parcours : troncature, total annoncé non atteint ou
 *     contredit, identifiant répété, motif de parcours nommé par l'adaptateur, ligne illisible ;
 *   · NON PROUVÉE — l'adaptateur ne sait pas démontrer la fin (lien depuis une page d'accueil, flux RSS/Atom,
 *     pager terminé sur une page vide) et aucun fait ne la contredit.
 *
 * Au RUN du 24/09, cinq sources (attaquer, kastner-ohler, lumentee, marc-o-polo, picard) étaient dites
 * « réfutées » alors que leur preuve scellée ne portait que `ENUMERATION_NOT_PROVEN` ou rien du tout.
 *
 * LES DEUX RESTENT BLOQUANTES (D-453 §1 : « les énumérations non prouvées et les troncatures restent des échecs
 * à instruire »). La lecture ne change que l'étiquette et le code d'attribution, jamais le statut ni le droit
 * d'attester, et elle ne touche pas à la sortie de l'adaptateur : `complete` et `enumerationVerdict` restent
 * scellés tels quels dans le manifeste, sans quoi le rejeu des collectes antérieures divergerait.
 *
 * `UNKNOWN` (`complete` absent) garde la règle du 11/09 : aucun incident de santé, aucun droit d'attester.
 */
import type { AdapterResult } from '../types.js';
import { ENUMERATION_MIN_COVERAGE } from './enumeration.js';
import { enumerationBlockers, isEnumerationRejection } from '../ats/enumerationIssues.js';
import { isRejectionFailure } from './rejectedRows.js';

export type EnumerationReading = 'PROVEN' | 'NOT_PROVEN' | 'REFUTED' | 'UNKNOWN';

/**
 * Les motifs par lesquels un adaptateur dit qu'il ne DÉTIENT PAS de preuve — jamais qu'il a vu une coupure.
 * Liste POSITIVE et FERMÉE : tout autre motif de parcours réfute, comme dans `enumerationIssues.ts`.
 */
export const ABSENCE_OF_PROOF_MARKERS: ReadonlySet<string> = new Set(['ENUMERATION_NOT_PROVEN', 'NO_PUBLISHER_LISTING_OR_SITEMAP']);

/** Ce que le RUN sait de l'énumération d'une collecte : la sortie normalisée de l'adaptateur, sans les offres. */
export type EnumerationFacts = {
  complete?: boolean | null;
  truncated?: boolean | null;
  declaredTotal?: number | null;
  /** Les identifiants des sorties, dans l'ordre du manifeste : un identifiant répété dit qu'on ne sait pas ce qu'on a lu. */
  externalIds: readonly (string | null)[];
  /** `enumeration.issues` et `enumeration.blockers` de la preuve scellée. */
  issues?: readonly string[];
  /** Les motifs des lignes rejetées. */
  rejectedReasons?: readonly string[];
};

export function enumerationFactsOf(result: AdapterResult): EnumerationFacts {
  return {
    complete: result.complete, truncated: result.truncated, declaredTotal: result.declaredTotal,
    externalIds: result.jobs.map(job => job.externalId),
    issues: [...(result.enumeration?.issues ?? []), ...(result.enumeration?.blockers ?? [])],
    rejectedReasons: (result.rejectedRows ?? []).map(row => row.reason),
  };
}

/** Les faits observés qui contredisent la fin du parcours, nommés. Vide : rien n'a été vu qui la contredise. */
export function refutingFacts(facts: EnumerationFacts): string[] {
  const found: string[] = [];
  if (facts.truncated) found.push('TRUNCATED');
  const unique = new Set(facts.externalIds).size;
  const declared = facts.declaredTotal;
  if (declared === 0 && facts.externalIds.length > 0) found.push('DECLARED_ZERO_WITH_OUTPUTS');
  if (declared != null && declared > 0 && unique / declared < ENUMERATION_MIN_COVERAGE) found.push('DECLARED_TOTAL_NOT_REACHED');
  if (unique !== facts.externalIds.length) found.push('REPEATED_OUTPUT_ID');
  for (const issue of enumerationBlockers(facts.issues ?? [])) if (!ABSENCE_OF_PROOF_MARKERS.has(issue)) found.push(issue);
  for (const reason of facts.rejectedReasons ?? []) {
    if (isRejectionFailure(reason) || isEnumerationRejection(reason)) found.push(`REJECTED:${reason}`);
  }
  return [...new Set(found)];
}

export function enumerationReading(facts: EnumerationFacts): EnumerationReading {
  if (facts.complete === true) return 'PROVEN';
  if (facts.complete !== false) return 'UNKNOWN';
  return refutingFacts(facts).length ? 'REFUTED' : 'NOT_PROVEN';
}

/** What the RUN records of a collection's enumeration (`IngestStats`): its reading and, when refuted, why (bounded). */
export function readEnumeration(result: AdapterResult): { enumerationReading: EnumerationReading; enumerationRefutedBy?: string[] } {
  const facts = enumerationFactsOf(result);
  const reading = enumerationReading(facts);
  return { enumerationReading: reading, ...(reading === 'REFUTED' ? { enumerationRefutedBy: refutingFacts(facts).slice(0, 5) } : {}) };
}
