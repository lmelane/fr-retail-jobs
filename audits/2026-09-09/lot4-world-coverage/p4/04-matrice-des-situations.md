# Les douze situations, l'état produit et les mutations autorisées

> Règle qui gouverne tout le tableau : **une indisponibilité technique n'est jamais enregistrée comme une
> fermeture employeur.** `closedAt` dit « l'employeur ne publie plus » ; `withdrawnAt` dit « nous ne publions
> plus ». Confondre les deux ferait mentir le catalogue sur un fait qui appartient à l'employeur.

Chaque ligne est vérifiée dans le code cité, et les huit scénarios exécutés sur clone
(`lifecycle-scenarios.mts`, 8/8 PASS) couvrent les cas de fermeture, de retrait, de réouverture et les quatre
modes d'échec.

| Situation | État produit | Mutations AUTORISÉES | Mutations INTERDITES | Où c'est appliqué |
|---|---|---|---|---|
| **HTTP 403** | `SourceRun` transitoire puis `CHALLENGED` si un anti-bot est signé, sinon nouvel essai | aucune sur l'offre | `closedAt`, `withdrawnAt`, `lastSeenAt` avancé | `lib/http.ts` (403 rejouable), `lib/responseIntegrity.ts` (signature d'infrastructure), `NEVER_ATTESTS` |
| **Timeout** | run `TIMEOUT`, source exclue de la clôture | aucune | toute désactivation | `attestation.ts` `NEVER_ATTESTS`, `refresh.ts` |
| **Erreur réseau** | run `ERROR` | aucune | toute désactivation | idem |
| **Erreur de parsing** | `errors > 0` → run `DEGRADED` ou `BROKEN` ; droit d'attester **retiré** | aucune | toute désactivation | `health.ts`, `isTrustedForAttestation` (`errors > 0` refuse) |
| **Échec de lecture d'un DÉTAIL** | retenue `*_DETAIL_FETCH_FAILED` → `SourceObservation`, offre **non publiée** ; classée `DETAIL_UNREADABLE` | archivage de l'observation | publication de l'offre ; **et depuis le 2026-09-11, retirer le droit d'attester au reste de la source** | `publicationHold.ts`, `ingest.ts` (le `stats.complete = false` a été supprimé), `unverifiable.ts` |
| **Listing partiellement lu** | verdict `REFUTED` si la couverture < 90 % → run `DEGRADED`, aucune clôture | aucune | fermer les offres non revues | `enumeration.ts`, `attestation.ts` |
| **Pagination incomplète (troncature)** | `truncated` → verdict `REFUTED` | aucune | fermer quoi que ce soit | `enumeration.ts` (la troncature l'emporte sur tout) |
| **Offre absente d'un listing ÉNUMÉRÉ et fiable** | `closedAt` daté + événement `CLOSED` | `deactivateJob({kind:'CLOSED'})` | poser `withdrawnAt` en même temps | `lifecycle.ts`, `refresh.ts` — scénario clone *fermeture propagée* |
| **Offre absente d'un run INCOMPLET** | rien : l'offre survit telle quelle | aucune | toute désactivation | `refresh.ts` (exclusion des sources sans droit d'attester) — scénarios clone *aucune fermeture abusive* ×4 |
| **Offre explicitement marquée FERMÉE par l'éditeur** (404/410/closed) | `closedAt` daté, via la disposition de la retenue | `deactivateJob({kind:'CLOSED'})` sur l'observation datée | inventer la date : elle vient de `publicationWithdrawnAt`, refusée si future ou non finie | `publicationDisposition.ts`, `publicationHold.ts` |
| **Offre explicitement RETIRÉE** (source retirée, hors périmètre, identité contredite) | `withdrawnAt` + motif nommé, `closedAt` **nul** | `deactivateJob({kind:'WITHDRAWN', reason})` | être présenté comme une fermeture employeur ; incrémenter `reopenedCount` au retour | `lifecycle.ts`, `retireSource.ts` — scénario clone *retrait ≠ fermeture* |
| **Redirection vers une autre annonce** | fusion tracée `MERGED`, identifiants et `firstSeenAt` conservés | réassignation du rang canonique | modifier `postedAt`, `firstSeenAt` ou poser une date employeur | `reconcile.ts`, `dedup/` |
| **Réapparition d'une offre FERMÉE** | réactivée sous la **même** identité, `closedAt` effacé, `reopenedCount` +1, événement `REOPENED` | `reactivateJob` | créer une seconde offre ; réécrire `firstSeenAt` | `lifecycle.ts` — scénario clone *réouverture propagée* |
| **Réapparition d'une offre RETIRÉE** | réactivée, `reopenedCount` **inchangé**, événement `REPUBLISHED` | `reactivateJob` | incrémenter `reopenedCount` : il n'y avait pas de fermeture employeur à annuler | `lifecycle.ts` — scénario clone *republication après retrait* |

## Les quatre états de l'énumération, et ce qu'ils autorisent

| Verdict | Signification | Ferme-t-on sur une absence ? |
|---|---|---|
| `PROVEN` | le balayage a atteint la fin du listing, et on peut le montrer | **oui** |
| `UNKNOWN` **avec** référence (run précédent ou total déclaré) | on ne sait pas ; l'effondrement est la seule preuve disponible | **oui**, sous garde d'effondrement |
| `UNKNOWN` **sans** aucune référence | on ne sait rien du tout | **non** |
| `REFUTED` | preuve du contraire : troncature, couverture < 90 %, total à 0 contredit par des offres | **non** |

## Ce qui change pour une offre retenue (item 6)

Avant le 2026-09-11, une retenue non résolue posait `complete = false` pour **toute la source**. Une offre
retenue empêchait donc :
la vérification des autres offres · l'enregistrement de leur dernière observation · la fermeture justifiée des
autres offres · la mesure de la complétude du run.

Depuis, une retenue **n'affecte que son offre**. Les autres offres de la source sont vérifiées, datées, fermées si
elles le méritent, et la complétude du run se mesure sur l'énumération — pas sur la qualité d'une page.
Mesuré : **186 sources portant 20 503 représentations** retrouvent leur droit d'attester, dont 4 dont le blocage
venait exclusivement des retenues (`tapestry` 5 retenues sur 2 091 offres, `vf-corporation` 695 sur 1 273,
`nordstrom` 3, `intersport-france` 12).

L'offre retenue, elle, n'est **ni publiée ni perdue** : elle est archivée dans `SourceObservation` et suivie
nommément dans le registre des invérifiables, avec son ancienneté, son action suivante et sa condition de levée.

## Attestation par partition (item 7)

Une absence n'est significative que si le run **couvre le périmètre où l'offre devait apparaître**. Le mécanisme
existe et reste la seule voie autorisée pour une source multi-pays, multi-marques ou multi-portails :
`partitionFacet` lit un tableau par valeur de facette puis le résiduel, et **la valeur de facette est
l'attribution du tenant** (D59). Un résiduel sans facette sous plafond laisse la source **non prouvée**.

Conséquence tenue dans ce lot : une source dont une seule partition a été lue ressort `REFUTED` ou `UNKNOWN`,
jamais `PROVEN` — c'est le cas de `ulta-jibe` (9 964 lues sur 9 966 déclarées, mais **arrêtée sur un plafond de
pages**), qui reste bloquée après correctif, comme elle doit l'être.
