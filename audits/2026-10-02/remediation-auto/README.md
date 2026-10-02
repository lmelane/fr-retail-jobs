# D-520, critère 3 : les problèmes ordinaires absorbés sans intervention

Mesures en lecture seule de la production, le 02/10/2026 entre 14:12 et 14:40 UTC, hors fenêtre du RUN. Code : `apps/aggregator/src/pipeline/ordinaryCauses.ts` et la reprise de `ingestOrchestrator.ts`, sur `development`. Rien n'est en production.

## Fichiers

| Fichier | Contenu | Rejeu |
|---|---|---|
| `catalogue.sql` → `catalogue.csv` | chaque `source.issue_classified` des RUN `ingest-all`, avec l'erreur du même RUN et sa classe | `db.py readonly`, commande en tête du fichier |
| `catalogue.py` → `catalogue.out` | fréquence, sources, offres en jeu, résolution au RUN suivant, matrice classe × RUN | `python3 catalogue.py` |
| `renouvellements.sql` → `renouvellements.out` | requalifications d'accès déjà faites seules par le RUN, releases, état des décisions | `db.py readonly` |
| `simulation.py` → `simulation.out` | la règle de trajectoire rejouée sur les 8 RUN réels, et l'option à arbitrer | `python3 simulation.py` |
| `captures-refusees.sql` → `captures-refusees.out` | la cause enveloppée des 15 « captures indisponibles » | `db.py readonly` |

La population compte une ligne par source et par RUN complet. Il y a 8 RUN avec issues classées, du 24/09 au 01/10, soit 91 sources. Les « offres en jeu » d'une source sont son plus grand `SourceRun.jobs` sur la fenêtre. L'événement `source.issue_classified` n'existe que depuis le 24/09 : le RUN du 23/09 est lu à part, dans `renouvellements.out`.

## Catalogue des causes

| Classe mesurée | Occurrences (source × RUN) | Sources | Offres en jeu | Disparue au RUN suivant | Classe de `sourceState.ts` | Reprise dans le RUN |
|---|---|---|---|---|---|---|
| Retenue prouvée par la source | 142 | 28 | 22 419 | 12 | pas un défaut | non |
| Identité d'employeur en revue | 106 | 27 | 17 300 | 27 sur 104 | IDENTITE_EMPLOYEUR | non |
| Régression de volume ou de champs | 63 | 40 | 30 711 | 39 sur 57 | ANOMALIE_VOLUME | non |
| Liste incomplète ou non prouvée | 56 | 13 | 13 300 | 11 sur 50 | LISTE_NON_PROUVEE (D-480 : décision) | non |
| Capture de qualification rejetée, admission sans résultat qualifié | 26 | 7 | 6 918 | 7 sur 25 | QUALIFICATION_REFUSEE | non |
| Capture native refusée (15) et base indisponible (2) | 17 | 16 | 941 | 15 sur 15 | DEFAUT_INTERNE | **base seulement** |
| Refus 406 Avature | 8 | 1 | 0 | 0 sur 7 | ACCES_REFUSE (D-480 : décision) | non |
| Transport (2), délai (1) | 8 | 3 | 10 256 | 3 sur 8 | INDISPONIBILITE_PASSAGERE / LECTEUR | **transport seulement, jamais Avature** |
| Refus d'accès explicite en vigueur | 6 | 1 | 40 | 1 sur 6 | QUALIFICATION_REFUSEE | non |
| Autre 4xx (405 Kering) | 2 | 1 | 1 080 | 2 sur 2 | LECTEUR | non |
| Hors périmètre qualifié | 2 | 2 | 1 861 | 2 sur 2 | QUALIFICATION_REFUSEE | non |
| Refus 403 | 1 | 1 | 52 | dernier RUN | ACCES_REFUSE | non |
| Inclassés (Selfridges 0 offre lue, lignes rejetées) | 3 | 2 | 419 | 2 sur 3 | LECTEUR, CONTENU_INCOMPLET | non |

**Correction de prémisse.** Les 15 « captures indisponibles » des RUN du 27 et du 29/09 enveloppaient toutes « This access policy certifies only native HTTP requests » (`captures-refusees.out`). C'est un refus de la politique d'accès, déterministe. La requalification d'après déploiement le masquait, et `scopeOutgrown` l'a corrigé ensuite. Leur « disparition au RUN suivant, 15 sur 15 » prouve ce masquage, pas un incident passager. Une première version de ce lot les reprenait dans le RUN : l'audit l'a refusé.

## Ce que le RUN absorbait déjà seul

Chaque RUN qui suit une release renouvelle seul les décisions d'accès de 406 à 411 sources (`source.access_qualification_started`, motif `ACCESS_STALE`, le 24, 25, 26, 28/09 et les 30/09 et 01/10). Ces renouvellements sont journalisés et faits par `normal-worker:git:<sha>`. Les RUN des 27 et 29/09, sans nouvelle release depuis le RUN précédent, n'en ont pas fait. La cause est mesurée : le lecteur d'une décision est le SHA de la release, et 29 révisions ont tourné du 22/09 au 02/10. À 14:16 UTC le 02/10, 410 des 412 sources actives portaient une décision d'un autre lecteur que la release r5. C'est le message « Access decision must be renewed… » vu pour lvmh : un état ordinaire, que le RUN de ce soir lève seul. Une révision de source changée suit le même chemin, avec la même requalification. Depuis le RUN du 23/09 à 07:51, aucune source n'a échoué au RUN pour ce motif, alors que 346 avaient échoué au RUN de 07:19 le même jour, avant l'entretien automatique.

**Ce qui n'est pas possible** : renouveler une décision sans nouvelle capture quand seul le lecteur a changé. Le trigger SQL de `SourceAccessDecision` exige une capture faite par le même lecteur que la décision. Rattacher une ancienne preuve à un nouveau lecteur affaiblirait cette preuve. Le renouvellement passe donc par une capture fraîche, ce que fait le RUN.

## Ce que ce lot ajoute

1. **Branché sur le vocabulaire unique** de l'état des sources (`sourceState.ts`, D-520 §2, construit par ailleurs et arrivé sur `development` pendant ce lot). La classe, la trajectoire et « ce qui manque » de chaque issue viennent de `issueCause` et `CAUSES`, sans redéfinition. `ordinaryCauses.ts` n'ajoute que la décision de reprise. L'ensemble est inscrit dans `source.issue_classified.remediation`, dans la ligne du bilan et dans le bloc de chaque source bloquante de l'alerte.
2. **Reprise unique dans le RUN**, seulement pour les deux causes passagères par leur **classe** d'erreur : base Prisma (`DATABASE_FAILURE`) et transport (`TRANSPORT_*`).
   - Conditions : à la première occurrence, sur les deux chemins d'échec (l'erreur absorbée par `runIngest`, et celle levée hors de la collecte), après toutes les sources.
   - Exclusions : jamais un refus, un délai, une capture refusée, Avature ni une source à amorçage anti-robot.
   - Bornes : au plus 20 sources, sinon aucune ; chaque reprise finit avant la fin de la fenêtre du RUN (18:30 UTC) et avant la prochaine passe ; aucune n'est commencée à moins de 2 minutes de cette échéance.
   - Une reprise échouée, ou une famille passagère déjà là au RUN complet précédent : à réparer, plus de reprise.
   - Journal : la ligne `SourceRun` de la première tentative reste en base, et ses lecteurs prennent la dernière ligne ou la dernière collecte productive. Événements `source.retry_started`, `source.retry_skipped`, `source.retry_completed`, `run.transient_retry_completed`.
   - Interrupteur : `RUN_TRANSIENT_RETRY=off`.

## Effet mesuré (`simulation.out`, règles rejouées sur les 8 RUN réels)

| | Bloquantes par RUN | Reprises dans le RUN (borne haute) | Interventions, désormais nommées | Option à arbitrer : la 1re occurrence attend un RUN |
|---|---|---|---|---|
| Moyenne des 7 RUN du 25/09 au 01/10 | 31,7 | 0,3 | 31,4 | 26,6 |
| RUN du 01/10 | 11 | 2 | 9 | 3 |

La reprise absorbe peu : 2 sources le 01/10, browns-shoes et diptyque-workday. Le gain de ce lot est ailleurs : chaque intervention arrive classée, avec ce qui est attendu, au lieu d'une enquête pour savoir de quoi il s'agit. Le seul levier qui réduit fortement le nombre d'interventions est d'attendre un RUN avant d'instruire la première occurrence d'une régression de santé, d'une liste non prouvée ou d'une qualification rejetée (39 régressions sur 57 ont disparu seules). C'est une question métier sous D-453 §1 : elle n'est pas tranchée ici.

## Écarts connus

- Après chaque release, la passe de découverte (D-517) laisse au RUN toute source dont la décision est périmée (`QUALIFICATION_DUE`), soit toutes jusqu'au RUN suivant. Requalifier dans la passe coûterait une lecture complète par source, de l'ordre des 56 874 requêtes de qualification du RUN du 01/10 pour 411 sources : ce sera à borner et mesurer après l'activation de D-517.
- La trajectoire d'une source en passe n'escalade que sur les RUN complets.
- Une reprise absorbée n'apparaît pas dans l'alerte e-mail : elle est dans `run.sources_completed` (« reprises : a/n absorbées ») et dans les événements de reprise.
- `consecutiveRuns` ne compte que « déjà là au RUN complet précédent » (2), pas la chronicité au-delà.
- Une reprise absorbée au RUN précédent compte comme présence : la même panne le lendemain n'est plus reprise. C'est voulu.
- `RUN_TRANSIENT_RETRY` n'est pas encore décrit dans le `CLAUDE.md` du dépôt.
- `sourceState.ts` présente la régression de volume, la liste non prouvée et l'identité à identifier comme « revient seule » jusqu'à leur échéance. Ces issues restent bloquantes au RUN (D-453 §1 veut qu'elles soient instruites). C'est la question métier ci-dessus : ce lot ne la tranche pas, il la mesure (option à arbitrer).
- Le lot ne persiste pas l'état (`SourceOperationalState`) : cela revient au module d'état.
