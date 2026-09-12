/**
 * UN DÉFAUT D'OFFRE N'EST PAS UN DÉFAUT D'ÉNUMÉRATION.
 *
 * La distinction est celle de P4, et c'est la même cause racine que le correctif de `ingest.ts` : une retenue
 * de publication annulait l'exhaustivité de toute la source, alors qu'une retenue est un défaut de CETTE
 * offre-là. Deux adaptateurs reproduisaient la confusion sur leurs `issues` :
 *
 *   `complete: terminated && !issues.length && !rejectedRows.length`
 *
 * Mesuré sur GANNI le 2026-09-12 : parcours PROUVÉ — `DECLARED_TOTAL_REACHED`, une seule page, 16 identifiants
 * uniques pour un total annoncé de 16, compteurs natifs concordants (`customer=16 search=16 list=16 skipped=0`),
 * `truncated: false` — mais **deux offres sans description** ont produit `complete: false`, donc
 * `canAttestAbsence: false`. La même source, avec exactement la même preuve de parcours, était `complete: true`
 * trois jours plus tôt : seules les deux descriptions manquantes avaient changé.
 *
 * Ce que cela coûterait de laisser en place : une source dont on a DÉMONTRÉ qu'on a lu tout le board ne peut
 * jamais fermer une offre, donc son catalogue se remplit de postes morts — exactement le risque que la garde de
 * couverture de champ était censée écarter, et qui est déjà nommé dans `attestation.ts` (« un DEGRADED de
 * couverture de CHAMP a vu tout le board et atteste toujours »).
 *
 * La règle, donc : seul ce qui met en cause le PARCOURS réfute l'énumération. Un champ manquant sur une offre
 * dégrade la QUALITÉ de cette offre, et se mesure ailleurs (taux de couverture, retenues).
 *
 * La liste est POSITIVE et FERMÉE : un motif inconnu réfute par défaut. C'est le sens conservateur — un
 * nouveau motif d'énumération qu'on aurait oublié de classer ne doit pas obtenir le droit de fermer par
 * accident de configuration. C'est l'inverse du choix fait pour `countryIntegrity`, et pour la même raison :
 * dans les deux cas, le défaut par omission doit être le REFUS.
 */
import { isRejectionFailure } from '../pipeline/rejectedRows.js';

/**
 * Les motifs qui ne concernent QUE l'offre citée, jamais le parcours.
 *
 * Ils portent presque tous un identifiant en suffixe (`DESCRIPTION_MISSING:144681`) : c'est le signe qu'ils
 * décrivent une ligne, pas un balayage. On compare donc le préfixe, avant le `:`.
 */
const PER_POSTING_DEFECTS: ReadonlySet<string> = new Set([
  'DESCRIPTION_MISSING',         // l'annonce ne publie pas de texte : défaut de CONTENU, la source l'a publié ainsi
  'UNRECOGNISED_PROJECT_TYPE',   // le type d'opportunité d'UNE offre est inconnu → elle part en retenue
]);

/**
 * CE QUI N'EST PAS un simple défaut d'offre, et pourquoi la frontière est là.
 *
 * `DETAIL_READ_FAILED` et `PUBLIC_PAGE_READ_FAILED` sont des ÉCHECS DE COLLECTE : la source publie bien
 * quelque chose, et nous n'avons pas réussi à le lire (un 403, un timeout). Ils restent donc bloquants, pour la
 * même raison que `isRejectionFailure` classe `FETCH_FAILED` en échec — nous ne savons pas ce que contenait la
 * page, donc nous ne savons pas si l'offre est encore ouverte. Les traiter comme bénins donnerait le droit de
 * fermer à un run qui n'a pas lu ce qu'il prétend avoir lu.
 *
 * La frontière est donc : *la source a-t-elle publié une valeur que nous avons lue ?*
 *   · valeur absente CHEZ LA SOURCE  → défaut d'offre, l'énumération tient (`DESCRIPTION_MISSING`) ;
 *   · valeur que NOUS n'avons pas pu lire → échec de collecte, l'énumération ne tient pas.
 */

/** Un motif porte-t-il sur une seule offre ? */
export function isPerPostingDefect(issue: string): boolean {
  return PER_POSTING_DEFECTS.has(issue.split(':', 1)[0]!);
}

/**
 * Les motifs qui mettent réellement en cause le PARCOURS, et donc réfutent l'énumération.
 * Rendus séparément pour que l'adaptateur puisse les nommer dans sa preuve.
 */
export function enumerationBlockers(issues: readonly string[]): string[] {
  return issues.filter((issue) => !isPerPostingDefect(issue));
}

/**
 * L'énumération est-elle complète ?
 *
 * @param terminated   l'adaptateur a-t-il DÉMONTRÉ la fin du parcours (fin d'endpoint, total atteint, toutes
 *                     les partitions lues) — jamais un ratio
 * @param issues       les motifs relevés pendant le balayage
 * @param rejectedRows les lignes refusées, triées par le classifieur QUI EXISTE DÉJÀ (`isRejectionFailure`)
 *
 * Les refus ne se traitent PAS en bloc, et le dépôt porte déjà la bonne distinction (`rejectedRows.ts`) :
 *  · un refus EXPLIQUÉ (page périmée encore listée, doublon inter-pages, ligne sans identifiant) est un
 *    TÉMOIN du parcours — il prouve qu'on a lu la ligne et décidé de ne pas la publier ;
 *  · un ÉCHEC (`FETCH_FAILED`, `UNPARSED`, `TIMEOUT`…) est une lacune de collecte : l'offre existe peut-être
 *    et n'a pas été lue, donc le parcours n'est PAS démontré.
 *
 * Réutiliser ce classifieur plutôt que d'ignorer tous les refus : sans lui, un `FETCH_FAILED` obtiendrait le
 * droit de fermer. Le précédent est documenté au même endroit — compter les refus expliqués comme des erreurs
 * avait rendu Alberto DEGRADED (6 offres, 74 pages périmées) ; l'excès inverse serait pire.
 */
export function enumerationComplete(
  terminated: boolean,
  issues: readonly string[],
  rejectedRows: ReadonlyArray<{ reason: string }> = [],
): boolean {
  if (!terminated) return false;
  if (enumerationBlockers(issues).length > 0) return false;
  return !rejectedRows.some((row) => isRejectionFailure(row.reason) || isEnumerationRejection(row.reason));
}

/**
 * Les motifs de REFUS qui mettent en cause le parcours, et pas seulement une ligne.
 *
 * Un DOUBLON d'identifiant natif en est un : la liste du publieur se contredit elle-même, et on ne peut donc
 * pas affirmer que les N identifiants lus couvrent les N offres annoncées. Workday traite déjà le même cas
 * comme un motif d'énumération (`REPEATED_IDS_ACROSS_PAGES`) — la cohérence entre adaptateurs l'exige.
 *
 * Une ligne sans identifiant, titre ou URL exploitable relève du même doute : elle a été VUE, mais rien ne
 * permet de dire ce qu'elle était, donc le périmètre lu n'est pas identifiable.
 */
const ENUMERATION_REJECTIONS = /DUPLICATE|REPEATED|INVALID_ID|INVALID_POSTING_ID/i;

export function isEnumerationRejection(reason: string): boolean {
  return ENUMERATION_REJECTIONS.test(reason);
}
