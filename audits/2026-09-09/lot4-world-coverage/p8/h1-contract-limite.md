# P8 · H1 — jusqu'où la preuve du contrat va, et où elle s'arrête

> Run H1 `81e659cc`, 2026-09-13 08:20:36 → 08:21:46. Document écrit après une objection fondée : la preuve
> précédente n'était pas run-scopée.

## L'objection, vérifiée et retenue

La première réconciliation utilisait `JobSource.lastSeenAt >= PipelineRun.startedAt` pour décider si une ligne
avait été ré-attestée par H1. **`lastSeenAt` est mutable** : un run ultérieur l'avance, et l'écriture du run
ultérieur se retrouve attribuée au précédent.

Ce n'était pas un risque théorique. Mesuré :

| Source | Lignes datées DANS H1 | Lignes datées APRÈS H1 |
|---|--:|--:|
| `uniqlo-graduates` | 11 | 0 |
| `uniqlo-headquarters` | 19 | 0 |
| `uniqlo-stores` | 111 | 0 |
| **`uniqlo-us-retail`** | **0** | **345** |

Le T2 interrompu (09:01–09:02) a ré-écrit **la totalité** des lignes d'`uniqlo-us-retail`. Mes « 345
ré-attestés par H1 » étaient donc **345 écritures de T2**, attribuées rétroactivement à H1. Le chiffre était
juste par coïncidence — les deux runs ont touché le même nombre de lignes — et la méthode était fausse.

## Pourquoi la preuve exacte est irrécupérable pour cette source

Les événements durables de H1 portent des **comptes**, pas les identifiants écrits :

```
source_sync_completed → durationMs, stats, updated, fetched, http, health, sourceKey, errors, created, held
```

`canonicalObservedIds` est bien archivé par `source.enumeration_observed` (côté observation). Mais l'ensemble
des identifiants **écrits** ne l'est pas : il n'existait que dans l'état de `JobSource`, que T2 a depuis
écrasé. Aucune reconstruction ne peut le retrouver — et en fabriquer une depuis l'état courant reviendrait
exactement à refaire l'erreur qu'on vient de corriger.

## Ce que H1 prouve, et ce qu'il ne prouve pas

| Élément | Statut |
|---|---|
| Mutualisation par hostname (4 sources → 1 hôte, 7,39 req/s) | **PROUVÉ** |
| Absence de famine (légères terminées pendant la lourde) | **PROUVÉ** |
| Seuil du portail dépassé (3 × 429) | **PROUVÉ** |
| Volumes cohérents (`fetched = accepted = declaredTotal = observed`) | **PROUVÉ** |
| Écritures cohérentes en COMPTES (créés + mis à jour = observés) | **PROUVÉ** |
| Contrat de persistance par **ENSEMBLES**, `uniqlo-us-retail` | **NON PROUVABLE** — lignes écrasées par T2 |
| Contrat par ensembles, 3 autres sources | plausible, mais non ré-affirmé ici |

Comptes durables de H1 : `uniqlo-us-retail` 4 créés + 341 mis à jour = **345**, soit exactement les 345
observés. C'est une **réconciliation de nombres**, pas une preuve d'ensembles — la distinction est précisément
celle que l'objection reprochait à la version précédente.

## Conséquence, assumée

**Le premier H1 vaut comme preuve de volumes et de comportement réseau. Il ne vaut pas comme preuve exacte du
contrat de persistance par identifiants.** Le H1 rejoué après correction fournira cette preuve, sur un run que
rien n'aura écrasé.

## Les 19 représentations historiques

`ACTIVE_HISTORICAL_NOT_REATTESTED` : actives en base, absentes du board actuel — **état courant**, observé
après T2, et non état au moment de H1. Elles ne sont pas des pertes de collecte ; elles attendent un refresh.
Le mélange des deux instants est nommé ici plutôt que masqué.
