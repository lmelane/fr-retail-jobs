# P8 · A/B de concurrence — 4 contre 6

> Même corpus T2 (18 sources), même commit déployé pour la branche B (`325add9`), crons gelés.
> Branche A : runs `687c482a` et `4d8ba33f` (concurrence **4**, défaut du code).
> Branche B : run `3566aaf9`, 14:44:10 → 14:51:31 UTC (concurrence **6**, garde d'arrêt 429 armée).

## Le résultat : la concurrence 6 franchit une limite de tenant

| | A — concurrence 4 (p1) | A — concurrence 4 (p2) | **B — concurrence 6** |
|---|--:|--:|--:|
| Mur | 1 379,8 s | 675,5 s | 441,6 s |
| **Offres collectées** | 10 281 | 10 281 | **8 625** ⚠ |
| Sources `BROKEN` | 0 | 0 | **1 — `mango`** |
| 429 | 82 | 39 | 25 |
| Retries | 82 | 40 | **0** |
| Retenues | 38 | 38 | 62 |
| Débit apparent | 7,45 off/s | 15,22 off/s | *19,53 off/s* |

**Le débit de 19,53 offres/s est un leurre** : il se calcule sur 8 625 offres, parce que **1 656 offres de
`mango` n'ont jamais été collectées**. Un passage plus rapide qui ramène moins n'est pas un gain de capacité.

## Ce qui s'est passé, lu dans les événements

`mango` s'arrête après **32 requêtes, 0 offre**, sur ce message enregistré par le pipeline :

```
source.ingest_failed — "passage de mesure arrêté : 429 de tenant:mango.workday"
```

`retries: 0` sur tout le run le confirme : il n'y a eu **aucune absorption**. À concurrence 4, les 429 étaient
encaissés puis repris (82 retries pour 82 refus) ; ici la garde a coupé au **premier** refus, comme demandé.

**C'est la garde qui fonctionne, pas le pipeline qui casse.** Et c'est la première fois de P8 qu'elle est
réellement armée — les trois passages précédents la croyaient active alors que la variable n'atteignait pas le
conteneur.

## Ce que l'A/B établit vraiment

Monter à 6 **n'accélère pas le corpus** : il le tronque. Sur les tenants qui restent complets, les temps sont
comparables à la passe 2 de la branche A (`knitwellgroup` 2 100 requêtes contre 2 108 ; `richemont` 1 433
contre 1 461) — le gain de mur vient presque entièrement des 1 656 offres non collectées.

Et le comportement réseau se dégrade là où ça compte : `richemont` prend **17 refus sur 1 433 requêtes**
(1,19 %) contre 11 sur 1 461 (0,75 %) à concurrence 4. Plus de sources en parallèle, c'est plus de pression
simultanée sur les gros tenants Workday.

| Question | Réponse |
|---|---|
| La concurrence 6 augmente-t-elle la capacité ? | **NON** — corpus incomplet, 1 656 offres perdues |
| Faut-il tester la concurrence 8 ? | **NON** — 6 franchit déjà une limite de tenant ; monter serait chercher le point de rupture, ce que P8 interdit |
| Quelle valeur retenir ? | **4**, le défaut — quatre passages sains, corpus complet, 429 tous absorbés |

## La décision, et son motif

**La concurrence reste à 4.** Ce n'est pas un statu quo par prudence : c'est le seul palier mesuré qui ramène
le corpus **entier** sans qu'un tenant nous coupe.

*P8 demandait d'augmenter la capacité sur des mesures réelles. La mesure répond que la concurrence n'est pas
le levier : le pipeline n'est pas limité par le nombre de sources qu'il traite en parallèle, mais par ce que
les tenants acceptent de servir. Augmenter le premier ne fait que déclencher le second plus tôt.*

## Note de méthode

Un run **volontairement arrêté** par une garde reste `validForCapacity: false`, et c'est correct : ses volumes
ne mesurent pas une capacité. Il est ici **exploité comme résultat d'A/B**, pas comme mesure de débit — la
distinction est ce qui permet de conclure sans faire entrer un corpus tronqué dans une moyenne.
