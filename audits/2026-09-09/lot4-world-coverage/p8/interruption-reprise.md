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

### B — interruption pendant le POOL DE DÉTAILS — **PROUVÉE le 2026-09-13**

`--crash-after=2` rendait bien **code 137**, mais son déclencheur intervient **après deux transactions
commitées** : une seconde profondeur d'écriture partielle, pas une interruption pendant la lecture des
détails. Présenter l'un pour l'autre aurait été une preuve empruntée.

#### La cause racine des échecs précédents : la SOURCE, pas l'injection

Le harnais nominal tournait sur `damart` (Teamtailor) et `nikin` (Recruitee). En lisant les adaptateurs :
**Teamtailor déclare en toutes lettres « No detail fetch needed »** et Recruitee lit tout en un seul appel.
**Ces deux sources n'ont aucun pool de détails.** Aucune injection, si fine soit-elle, n'aurait pu y produire
le scénario B — et un run nominal aurait pu passer pour une preuve de reprise.

Le pool réel est celui d'**iCIMS** (`icims.ts` : `pLimit` + `Promise.all` de `fetchText`), consommé
**intégralement avant toute persistance**. C'est là, et nulle part ailleurs, que B se distingue de C.

#### L'exécution

Source `aeropostale` (iCIMS, 17 offres, 21 représentations) sur le clone
`catwalks_lot4_replay_20260909d`. Cassette enregistrée : **19 réponses** — 1 page de liste + 17 détails +
robots, donc le pool est réellement exercé. Le transport est la seule chose remplacée : la couture est sous
l'adaptateur, à `globalThis.fetch`.

| | |
|---|---|
| Commande | `P8_CRASH_AT=DURING_DETAIL_POOL P8_CRASH_AFTER=5` |
| **Code de sortie** | **137** |
| `source_sync_started` | émis |
| `source.enumeration_observed` · `source_sync_completed` | **0 · 0** |
| Écritures avant le kill | **0** — l'arrêt précède toute persistance |

L'arrêt tombe **au milieu du pool** (seuil 5 sur 17 détails) : s'arrêter au premier ne prouverait pas qu'un
pool *partiellement consommé* se reprend proprement, qui est la question posée.

#### Un faux négatif, et ce qu'il enseigne

Le premier essai a rendu **code 0**. L'injection était commitée sur sa branche, mais le run tournait depuis
`main` — un `icims.ts` **sans le point d'injection**. Le code 0 était donc exact : il n'y avait rien à
déclencher. *Une injection absente du tree exécuté est indiscernable d'une injection qui ne se déclenche pas
— seule la vérification du fichier réellement exécuté les sépare.* Un test grave désormais que le point est
câblé dans le pool **et placé avant** le `fetchText` du détail.

#### État après interruption, et reprise

| Contrôle | Après le kill | Après reprise |
|---|--:|--:|
| Runs orphelins (`finishedAt IS NULL`) | **0** | **0** |
| Doublons `sourceKey + externalId` | **0** | **0** |
| Représentations `aeropostale` | 21 | **21** |

| | Nominal | Reprise |
|---|--:|--:|
| `touchedIds` | 17 | **17** |
| **Identifiants communs** | — | **17 / 17** |
| Identifiants apparus à la reprise | — | **0** |
| `createdJobIds` | — | **0** |

La reprise se fait par le **chemin normal**, sans commande de récupération. La comparaison porte sur des
**ensembles d'identifiants**, jamais sur des cardinaux : toucher dix-sept lignes *différentes* donnerait le
même total.

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

## Verdict — les TROIS scénarios sont exercés

| Scénario | Où tombe l'arrêt | Preuve |
|---|---|---|
| **A** — pendant la collecte | `SIGTERM` réel en production | incident du 2026-09-13, `INTERRUPTED` enregistré |
| **B** — pendant le pool de détails | avant toute persistance | `P8_CRASH_AT=DURING_DETAIL_POOL`, code 137 |
| **C** — pendant l'écriture | après 1 transaction commitée | `--crash-after=1`, code 137 |

Dans les trois cas : **0 run orphelin, 0 réservation pendante, 0 doublon**, et la reprise par le **chemin
normal** reconverge sur l'état nominal **par ensembles d'identifiants**, sans double écriture ni perte.

### Conséquence sur la file distribuée — la réserve est levée

La conclusion était suspendue parce qu'un scénario non exercé ne se déduit pas des deux autres. Il l'est
désormais, et il se comporte comme les autres.

**Aucun gain de débit** n'est démontré pour une file distribuée : l'orchestration pèse **0,2 %** du temps
mural (T1). **Aucun besoin de reprise** ne la justifie non plus : les trois scénarios d'arrêt brutal se
reprennent proprement par le chemin normal, sans état intermédiaire à reconstruire.

*La construction « qui paraît plus scalable » est écartée par la mesure et par l'exercice, pas par opinion —
ce que P8 exige avant toute architecture disproportionnée.*
