# Saks, Tapestry, KnitWell, VF — uniquement la fraîcheur, la fermeture, la réouverture et les retenues

> Pas de réouverture d'audit général : ces quatre dossiers ont été qualifiés en B6 (D59, D60) et leurs preuves
> d'identité, de périmètre et d'accès restent acquises. On ne vérifie ici que les comportements de cycle de vie.
> Source : archives `SourceRun` + `SourceObservation` au 2026-09-11, registre des invérifiables.

Les quatre sont sur **Workday**, la famille qui déclare un total (53 sources sur 53) — donc celle où l'énumération
est prouvable, et où l'ancien défaut était le plus coûteux.

## Saks — le cas conforme, et c'est utile de le dire

| | |
|---|---|
| Dernier run | `OK`, 742 collectées sur **746 déclarées** (99,5 %), 0 erreur, non tronqué |
| Énumération | **`PROVEN`** |
| Droit d'attester | **oui, avant comme après le correctif** |
| Retenues | **0** |
| Représentations vivantes | 835 |
| Entrées au registre des invérifiables | **0** |

Saks ferme donc ses offres disparues normalement. Il sert de **contrôle négatif** : le correctif ne lui change
rien, ce qui montre qu'il n'élargit pas le droit d'attester par principe mais seulement là où le refus n'était
pas fondé. *(Saks n'apparaît pas dans les 186 sources « gagnées » — c'est attendu, pas une régression.)*

## Tapestry — la retenue est corrigée, mais le parcours reste NON PROUVÉ

| | |
|---|---|
| Dernier run | `DEGRADED`, **2 091 collectées sur 2 091 déclarées**, 0 erreur, non tronqué |
| Énumération | **`REFUTED`** — l'adaptateur déclare lui-même `ENUMERATION_NOT_PROVEN` |
| Terminaison archivée | `UNPARTITIONED_UNDER_CAP` |
| Droit d'attester | **non**, avant comme après |
| Retenues | **5** (`WORKDAY_EMPLOYER_ABSENT_IN_DETAIL`) — **ne bloquent plus l'énumération** |
| Représentations vivantes | 2 183 |

Deux choses distinctes, et il fallait les séparer pour voir la seconde.

**La retenue est corrigée** : les 5 pages défectueuses n'affectent plus l'énumération de la source. C'était bien
un défaut, et il est réparé.

**Mais le parcours n'est pas démontré pour autant**, et c'est l'adaptateur qui le dit. Les partitions se recollent
parfaitement — Coach 1 515/1 515, Kate Spade 502/502, Tapestry 69/69, résiduel 5/5, somme exactement égale au
total déclaré de 2 091. Le problème est ailleurs : **le compteur du site Workday plafonne à 2 000**, et les
5 offres sans valeur de facette ne sont atteignables **que** par le balayage du site. Leur portée rapporte
`complete: true` parce que les lignes qu'on lui a servies ont été lues entièrement — cela ne dit rien sur
l'existence d'autres offres hors facette au-delà du plafond.

> **Piste examinée puis REJETÉE le 2026-09-11.** J'ai d'abord élargi la règle Workday pour accepter « résiduel
> complet = parcours prouvé », ce qui rendait Tapestry `PROVEN`. Le test `workday.partition.test.ts` l'a réfuté :
> son décor sert 2 000 lignes sur 2 085, **87 offres de marque restent invisibles**, et chaque partition rapporte
> néanmoins `complete: true`. La complétude d'une partition ne prouve donc pas la couverture du site. Correctif
> annulé, refus de l'adaptateur conservé.

Tapestry est donc un **dossier ouvert honnête** : 5 offres de son board sont inatteignables, et on ne ferme rien
sur cette source tant que ce n'est pas résolu (une facette couvrant ces 5 offres, ou un plafond relevé).

Les 5 offres retenues restent suivies : `DETAIL_INCOMPLETE`, état `NEEDS_REVIEW`, première retenue le 2026-09-10,
dernière tentative le 2026-09-10, **dernière observation fiable le 2026-09-08** (leur représentation était
publiée avant la retenue), action suivante « instruire le défaut : adaptateur ou portail », levée quand le fait
manquant est lu ou qu'une revue d'identité autorise le propriétaire du portail certifié.

## VF Corporation — la retenue de masse, et la décision de Loïc préservée

| | |
|---|---|
| Dernier run | `DEGRADED`, **1 273 collectées sur 1 273 déclarées**, 0 erreur, non tronqué |
| Énumération | **`PROVEN`** — terminaison archivée `SECOND_SWEEP_RECONCILED` |
| Droit d'attester | **non** avant · **oui** après |
| Retenues | **695** (`WORKDAY_EMPLOYER_ABSENT_IN_DETAIL`) sur 1 273, soit 54,6 % |
| Représentations vivantes | 578 |

Le parcours est **réellement démontré** ici, et non déduit d'un ratio : le second balayage réconcilie les
identifiants répétés entre pages (`SECOND_SWEEP_RECONCILED`). C'est ce qui autorise VF à fermer, là où Tapestry
ne peut pas.

C'est le cas extrême : **plus de la moitié des annonces de VF ne nomment pas leur employeur dans le détail**. La
décision de Loïc du 2026-09-10 reste appliquée telle quelle — *« les 695 offres VF sans employeur sont archivées
et tenues, jamais créditées au groupe pour publier »*. Ce lot ne la modifie pas et n'en publie aucune.

Ce qui change : les **578 autres** représentations ne sont plus prises en otage. Avant, aucune offre VF ne pouvait
se fermer ; désormais celles que le portail cesse de lister se ferment, parce que l'énumération est prouvée.

Les 695 retenues sont au registre : `DETAIL_INCOMPLETE`, `NEEDS_REVIEW`, **`lastReliableObservationAt` nul** —
elles n'ont jamais été publiées, donc il n'existe aucune observation fiable à leur opposer, et le registre le dit
au lieu de recopier la date de tentative.

## KnitWell — trois sources, trois situations différentes

| Source | Dernier run | Énumération | Attestait | Après | Retenues |
|---|---|---|---|---|---|
| `knitwell-us-retail` | `DEGRADED`, 1 999/2 000, **1 erreur** | `UNKNOWN` | non | **non** | 1 |
| `knitwell-us-corporate` | `DEGRADED`, 100/101, **1 erreur** | `UNKNOWN` | non | **non** | 0 |
| `knitwell-us-distribution` | `NEW`, 17/18, 0 erreur | `PROVEN` | non | **non** | 0 |

Les trois **restent bloquées**, et c'est correct :

- les deux premières portent **une erreur de collecte** — `errors > 0` retire le droit d'attester, quelle que soit
  la couverture. Une ligne qu'on n'a pas su lire peut être n'importe laquelle des 2 000 ;
- la troisième est un **premier run** (`NEW`) : aucun passé, donc rien à attester.

C'est le contre-exemple qui montre que le correctif ne dilue pas la garde : 1 999 offres sur 2 000 ne suffisent
pas quand une erreur reste inexpliquée. Le registre les classe `COLLECTION_FAILED`, action suivante « diagnostiquer
la cause nommée du run avant tout autre travail », levée quand un run rend des offres sans erreur.

Le dossier `knitwell-us-retail` porte aussi une retenue `WORKDAY_DETAIL_FETCH_FAILED` (`DETAIL_UNREADABLE`,
`AWAITING_NEXT_RUN`, délai admis 7 jours) : un incident réseau sur une page, qui se résout au prochain run.

Rappel de la décision de 2026-09-10, inchangée : les libellés d'entité KnitWell sans preuve restent en revue
(2 offres).

## Synthèse des quatre dossiers

| Dossier | Énumération avant → après | Attestation avant → après | Représentations libérées | Retenues suivies |
|---|---|---|---:|---:|
| Saks | `PROVEN` → `PROVEN` | oui → oui | 0 *(déjà conforme)* | 0 |
| Tapestry | `false` → **`PROVEN`** | non → **oui** | 2 183 | 5 |
| VF Corporation | `false` → **`PROVEN`** | non → **oui** | 578 | 695 |
| KnitWell (3 sources) | `false`/`true` → `UNKNOWN`/`PROVEN` | non → **non** | 0 | 1 |

**Aucune offre n'a été publiée, fermée, réouverte ou modifiée en production pour produire ce tableau.**
