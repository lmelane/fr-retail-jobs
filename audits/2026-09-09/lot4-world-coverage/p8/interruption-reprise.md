# P8 · interruption et reprise — le vrai pipeline, sur clone

> 2026-09-13, clone `catwalks_p8_interrupt_clone` restauré d'un dump de production (79 045 offres actives).
> Le transport est la SEULE chose remplacée : l'adaptateur, les normaliseurs, la porte d'identité, la dédup et
> l'upsert tournent tels qu'en production.

## Pourquoi ce bloc décide, et pas l'orchestration à 0,2 %

T1 a mesuré une orchestration active à 0,2 % du temps mural. Cela dit qu'une file distribuée n'apporterait
**aucun gain de débit** — cela ne dit rien de la **reprise**. Ce sont deux questions distinctes : une file peut
être inutile pour la vitesse et nécessaire pour retrouver un état après un arrêt brutal. C'est donc ce bloc,
et non le chronométrage, qui tranche.

## Référence nominale

| | |
|---|--:|
| Sources | `damart` (Teamtailor), `nikin` (Recruitee) |
| Run | 2/2 OK, 0 échec, 0 timeout |
| `touchedJobSourceIds` | **6** |
| `createdJobIds` | 1 |
| Représentations finales | damart 4 · nikin 3 |

## Les scénarios

### C — interruption pendant l'ÉCRITURE

Le kill est placé sur la transaction de persistance, pas sur un appel de mise à jour : le pipeline écrit par
`$transaction`, et une tentative antérieure qui accrochait `job.update` **ne se déclenchait jamais** — le run
se terminait normalement et ne prouvait rien.

| | |
|---|---|
| Commande | `--crash-after=1` |
| **Code de sortie** | **137** (tué après 1 transaction commitée) |
| Écriture partielle | réelle |

### B — interruption pendant le POOL DE DÉTAILS — **PAS ENCORE PROUVÉE**

`--crash-after=2` rend bien **code 137**, mais son déclencheur intervient **après deux transactions
commitées** : c'est une **seconde profondeur d'écriture partielle**, pas une interruption pendant la lecture
des détails. Présenter l'un pour l'autre serait une preuve empruntée.

Il manque une injection déterministe qui se déclenche **après le début d'une lecture de détail et avant la
persistance correspondante**. Elle est ajoutée plus bas (`P8_CRASH_AT=DURING_DETAIL_POOL`).

### A — interruption pendant la COLLECTE — **PROUVÉE par un incident réel de production**

Le 2026-09-13, une fusion a déclenché un déploiement pendant que le corpus T2 collectait. Le conteneur a reçu
`SIGTERM` à **88,8 s** d'une collecte prévue à ~15 min. L'incident n'était pas voulu — il est néanmoins la
preuve la plus solide possible de ce scénario, parce qu'il s'est produit sur la **vraie** production, pendant
une **vraie** collecte.

| | |
|---|---|
| Signal | `SIGTERM`, déploiement `915ff568` (commit `a86e162`) |
| Statut enregistré | **`INTERRUPTED`** — pas laissé `RUNNING` |
| `finishedAt` | renseigné |
| Runs orphelins | **0** |
| Métriques préservées | 18 hôtes, bloc ressources intact |

`runtime.ts` a fait exactement son office. Le passage de mesure, lui, est perdu et classé
`T2-INVALIDATED-BY-CONCURRENT-DEPLOYMENT`.

<details><summary>Tentatives antérieures sur le harnais hors ligne (conservées comme trace)</summary> Deux tentatives :
· `--crash-after=0` signifie « désactivé », pas « arrêt immédiat » — le run s'est terminé normalement ;
· un `SIGTERM` réel est arrivé **après** la fin du run : la relecture hors ligne dure moins d'une seconde, la
  fenêtre pour interrompre la collecte n'existe pas.

Le harnais hors ligne s'exécute en moins d'une seconde : la fenêtre pour interrompre sa collecte n'existe pas.
C'est l'incident de production ci-dessus qui apporte la preuve.

</details>

## État après interruption

| Contrôle | Résultat |
|---|---|
| Runs orphelins (`finishedAt IS NULL`) | **0** |
| Réservations pendantes | **0** |
| Doublons `sourceKey + externalId` | **0** |
| Représentations | damart 4 · nikin 3 — inchangées |

## Reprise, par le chemin NORMAL

Aucun traitement spécial, aucune commande de récupération : on relance l'ingestion telle quelle.

| | Nominal | Reprise |
|---|--:|--:|
| `touchedJobSourceIds` | 6 | **6** — *les mêmes* |
| Identifiants communs | — | **6 / 6** |
| Identifiants apparus à la reprise | — | **0** |
| `createdJobIds` | 1 | **0** *(l'offre existe déjà)* |
| Représentations | 4 · 3 | 4 · 3 |
| Run | 2/2 OK | **2/2 OK** |

**Aucune double écriture, aucune perte, aucun identifiant divergent.** La comparaison est faite par
**ensembles d'identifiants**, jamais par cardinaux : toucher six lignes différentes donnerait le même total.

## Verdict — PARTIEL tant que B n'est pas prouvé

Le mécanisme actuel **suffit sur A et C** : un arrêt brutal ne laisse ni run orphelin, ni réservation pendante, ni
doublon, et la reprise par le chemin normal reconverge exactement sur l'état nominal.

**Réserve nommée** : le scénario **B** (interruption pendant le pool de détails) n'est pas encore prouvé. La
conclusion définitive sur la nécessité d'une file distribuée est donc **suspendue** jusqu'à cette preuve — le
débit ne la justifie pas (orchestration 0,2 %), et la reprise ne la justifie pas non plus **sur A et C**, mais
un scénario non exercé ne se déduit pas des deux autres.
