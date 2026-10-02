# D-520, critère 3 : les problèmes ordinaires absorbés sans intervention

Mesures en lecture seule de la production, le 02/10/2026 entre 14:12 et 14:28 UTC, hors fenêtre du RUN. Code : `apps/aggregator/src/pipeline/ordinaryCauses.ts` et la reprise de `ingestOrchestrator.ts`, sur `development`. Rien n'est en production.

## Fichiers

| Fichier | Contenu | Rejeu |
|---|---|---|
| `catalogue.sql` → `catalogue.csv` | chaque `source.issue_classified` des RUN `ingest-all`, avec l'erreur du même RUN et sa classe | `db.py readonly`, commande en tête du fichier |
| `catalogue.py` → `catalogue.out` | fréquence, sources, offres en jeu, résolution au RUN suivant, matrice classe × RUN | `python3 catalogue.py` |
| `renouvellements.sql` → `renouvellements.out` | requalifications d'accès déjà faites seules par le RUN, releases, état des décisions | `db.py readonly` |
| `simulation.py` → `simulation.out` | la règle de trajectoire rejouée sur les 8 RUN réels | `python3 simulation.py` |

La population compte une ligne par source et par RUN complet. Il y a 8 RUN avec issues classées, du 24/09 au 01/10, soit 91 sources. Les « offres en jeu » d'une source sont son plus grand `SourceRun.jobs` sur la fenêtre. L'événement `source.issue_classified` n'existe que depuis le 24/09 : le RUN du 23/09 est lu à part, dans `renouvellements.out`.

## Catalogue des causes

| Classe | Occurrences (source × RUN) | Sources | Offres en jeu | Disparue au RUN suivant | Trajectoire |
|---|---|---|---|---|---|
| Retenue prouvée par la source | 142 | 28 | 22 419 | 12 | normal, non bloquant |
| Identité d'employeur en revue | 106 | 27 | 17 300 | 27 sur 104 | **revue humaine** |
| Régression de volume ou de champs | 63 | 40 | 30 711 | 39 sur 57 | revient seule, puis à réparer au 2ᵉ RUN |
| Liste incomplète ou non prouvée | 56 | 13 | 13 300 | 11 sur 50 | revient seule, puis à réparer (sauf D-480 : décidée) |
| Capture de qualification rejetée | 26 | 7 | 6 918 | 7 sur 25 | revient seule, puis à réparer (lecteur) |
| Capture indisponible, base (passager interne) | 17 | 16 | 941 | **15 sur 15** | **reprise dans le RUN** |
| Refus 406 Avature | 8 | 1 | 0 | 0 sur 7 | décidée (D-480) |
| Transport, délai | 8 | 3 | 10 256 | 3 sur 8 | reprise dans le RUN (transport), RUN suivant (délai) |
| Refus d'accès explicite en vigueur | 6 | 1 | 40 | 1 sur 6 | **revue humaine** |
| Autre 4xx (405 Kering) | 2 | 1 | 1 080 | 2 sur 2 | cause inconnue : à instruire |
| Hors périmètre qualifié | 2 | 2 | 1 861 | 2 sur 2 | requalification, puis revue humaine au 2ᵉ RUN |
| Refus 403 | 1 | 1 | 52 | dernier RUN | revient seule, puis à réparer |
| Inclassés (Selfridges 0 offre lue, lignes rejetées) | 3 | 2 | 419 | 2 sur 3 | cause inconnue : à instruire |

## Ce que le RUN absorbait déjà seul

Chaque RUN qui suit une release renouvelle seul les décisions d'accès de 406 à 411 sources (`source.access_qualification_started`, motif `ACCESS_STALE`, le 24, 25, 26, 28/09 et les 30/09 et 01/10). Ces renouvellements sont journalisés et faits par `normal-worker:git:<sha>`. Les RUN des 27 et 29/09, sans nouvelle release depuis le RUN précédent, n'en ont pas fait. La cause est mesurée : le lecteur d'une décision est le SHA de la release, et 29 révisions ont tourné du 22/09 au 02/10. À 14:16 UTC le 02/10, 410 des 412 sources actives portaient une décision d'un autre lecteur que la release r5. C'est le message « Access decision must be renewed… » vu pour lvmh : un état ordinaire, que le RUN de ce soir lève seul. Une révision de source changée suit le même chemin, avec la même requalification. Depuis le RUN du 23/09 à 07:51, aucune source n'a échoué au RUN pour ce motif, alors que 346 avaient échoué au RUN de 07:19 le même jour, avant l'entretien automatique.

**Ce qui n'est pas possible** : renouveler une décision sans nouvelle capture quand seul le lecteur a changé. Le trigger SQL de `SourceAccessDecision` exige une capture faite par le même lecteur que la décision. Rattacher une ancienne preuve à un nouveau lecteur affaiblirait cette preuve. Le renouvellement passe donc par une capture fraîche, ce que fait le RUN.

## Ce que ce lot ajoute

1. **Vocabulaire unique** (`ordinaryCauses.ts`) : 15 causes, chacune avec une trajectoire (`NORMALE`, `REVIENT_SEULE`, `A_REPARER`, `REVUE_HUMAINE`, `DECIDEE`), son moyen (`RUN_RETRY`, `REQUALIFICATION`, `NEXT_RUN`) et ce qui est attendu. Une seule règle d'escalade : une cause qui revient seule et que la même source portait déjà au RUN complet précédent passe « à réparer », ou en revue humaine pour un périmètre. Inscrit dans `source.issue_classified.remediation`, dans la ligne du bilan et dans le bloc de l'alerte.
2. **Reprise unique dans le RUN** des causes passagères à leur première occurrence : capture indisponible, base, transport, 5xx. La reprise a lieu après toutes les sources, par l'étape exacte du RUN. Au-delà de 20 sources, aucune reprise : c'est une panne de masse, elle reste rouge. Jamais pour un refus de l'éditeur ni un délai, jamais dans une passe de découverte. La première tentative reste au journal (`SourceRun` en erreur). La reprise est journalisée (`source.retry_started`, `source.retry_completed`, `run.transient_retry_completed`). Interrupteur : `RUN_TRANSIENT_RETRY=off`.

## Effet estimé (`simulation.out`)

| | Sources bloquantes par RUN (avant) | Interventions attendues (après) |
|---|---|---|
| 7 RUN du 25/09 au 01/10 | 31,7 | 23,9 |
| Régime actuel (30/09 et 01/10) | 7 | 1 |
| RUN du 29/09 | 57 | 36 ; 14 autres sources reprises dans le RUN, 7 attendent le RUN suivant |

L'écart des premiers jours vient de causes réellement humaines : 16 à 20 revues d'identité par RUN. La règle les nomme, elle ne les résout pas. Chaque intervention restante arrive classée, avec ce qui est attendu. Elle ne demande plus d'enquête pour savoir de quoi il s'agit.

**Estimation, non mesure** : l'effet de la reprise suppose qu'une capture indisponible se lève dans l'heure. Il est prouvé au lendemain, 15 fois sur 15, mais n'est pas mesurable avant un RUN qui en porte.

## Écarts connus

- Après chaque release, la passe de découverte (D-517) laisse au RUN toute source dont la décision est périmée (`QUALIFICATION_DUE`), soit toutes jusqu'au RUN suivant. Requalifier dans la passe coûterait une lecture complète par source, de l'ordre des 56 874 requêtes de qualification du RUN du 01/10 pour 411 sources : ce sera à borner et mesurer après l'activation de D-517.
- La trajectoire d'une source en passe n'escalade que sur les RUN complets.
- Les régressions de santé et les listes incomplètes attendent un RUN avant d'être « à réparer ». C'est voulu, puisque 39 régressions sur 57 ont disparu seules, mais une vraie panne se voit un jour plus tard qu'une enquête immédiate.
- Le module d'état opérationnel de D-520 §2 n'existait pas sur `development` au moment du lot : il devra reprendre ces trajectoires telles quelles.
