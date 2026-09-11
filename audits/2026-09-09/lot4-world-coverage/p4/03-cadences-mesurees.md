# Les cadences et délais, DÉDUITS des mesures (2026-09-11, production, lecture seule)

> Mesures : `apps/aggregator/scripts/coverage/freshness-cadence.mts` → `freshness-cadence.json`.
> Chaque chiffre porte son dénominateur. Un délai unique pour 440 sources serait un choix arbitraire ; ceux
> ci-dessous sortent des rythmes réellement observés.

## 1. Ce que les portails font réellement

### Renouvellement de volume entre deux runs consécutifs

*Dénominateur : paires de runs consécutifs d'une même source, `jobs > 0` et `previousJobs > 0`, familles ≥ 20 paires.*
*Limite déclarée : une entrée et une sortie simultanées s'annulent — c'est un plancher du renouvellement réel, pas sa mesure exacte.*

| Famille | Paires | Sources | Δ volume moyen | Intervalle médian réel |
|---|---:|---:|---:|---:|
| `generic-listing` | 198 | 18 | **114,6 %** | 4 h |
| `digitalrecruiters` | 87 | 4 | **56,7 %** | 4 h |
| `eightfold` | 74 | 3 | 9,4 % | 4 h |
| `talentsoft` | 228 | 6 | 5,1 % | 3 h |
| `talentview` | 136 | 4 | 3,2 % | 3 h |
| `workday` | 566 | 34 | 1,8 % | 4 h |
| `teamtailor` | 2 574 | 123 | 1,0 % | 4 h |
| `successfactors` | 730 | 31 | 0,8 % | 4 h |
| `smartrecruiters-whitelabel` | 929 | 46 | 0,8 % | 4 h |
| `greenhouse` | 1 427 | 84 | 0,5 % | 4 h |
| `wttj` | 1 216 | 40 | 0,4 % | 4 h |

**Deux familles se détachent d'un facteur 100** : `generic-listing` (114,6 %) et `digitalrecruiters` (56,7 %)
bougent à chaque run ; les ATS structurés bougent de moins de 2 %. C'est le fait qui justifie des cadences
différenciées — et non une préférence.

### Durée de vie observée des offres FERMÉES

*Dénominateur : 2 604 offres avec `closedAt` et `firstSeenAt < closedAt`, lues via `JobSource` (familles ≥ 30).*

| Famille | Fermées | Médiane | p90 |
|---|---:|---:|---:|
| `workday` | 437 | 3 j | 5 j |
| `smartrecruiters-whitelabel` | 402 | 3 j | 5 j |
| `lvmh_algolia` | 287 | 6 j | 7 j |
| `fashionjobs` | 234 | 2 j | 4 j |
| `successfactors` | 166 | 3 j | 4 j |
| `teamtailor` | 160 | 1 j | 4 j |
| `eightfold` | 127 | 4 j | 4 j |
| `avature` | 86 | 2 j | 3 j |
| `greenhouse` | 66 | 4 j | 5 j |
| `wttj-sector` | 59 | 5 j | 7 j |

> **Défaut de mesure trouvé et corrigé en route.** La première version joignait sur `Job.canonicalSourceKey` et
> rendait un tableau **vide** : **2 600 des 2 604 offres fermées portent un `canonicalSourceKey` nul**, parce que
> le rang canonique n'a d'autorité que porté par une source attachée. La représentation `JobSource`, elle,
> survit à la fermeture (2 770 sur 2 772) et porte l'information. *Joindre sur la mauvaise colonne aurait fait
> conclure « aucune donnée de durée de vie » alors qu'il y en a 2 604.*
>
> **Défaut distinct, remonté et non corrigé dans ce lot : 4 604 offres ACTIVES portent aussi un
> `canonicalSourceKey` nul** (sur 78 932, soit 5,8 %). Il fausse toute mesure par famille qui passerait par cette
> colonne. Hors périmètre P4 (il touche la dédup et le rang canonique, pas le cycle de vie) — inscrit au suivi.

**Toutes les durées de vie observées sont ≤ 7 jours au p90.** Elles sont cependant **tronquées par l'historique
disponible** : la base a été reconstruite début septembre et les crons sont gelés depuis le 2026-09-09, donc
aucune offre ne peut afficher une durée de vie de 30 jours. C'est une limite de la mesure, pas un fait du marché,
et les seuils retenus ci-dessous n'en dépendent pas.

### Capacité à prouver l'énumération, par famille

*Dénominateur : les 440 sources ACTIVE+PAUSED et leur dernier run archivé.*

| Famille | Sources | Déclarent un total | Tronquées | Attestaient (état archivé) |
|---|---:|---:|---:|---:|
| `teamtailor` | 113 | **0** | 0 | 14 |
| `greenhouse` | 63 | **0** | 0 | 63 |
| `workday` | 53 | 53 | 1 | 31 |
| `smartrecruiters-whitelabel` | 45 | 45 | 0 | 45 |
| `successfactors` | 30 | 11 | 0 | 9 |
| `recruitee` | 22 | **0** | 0 | **0** |
| `lever` | 18 | **0** | 0 | 18 |
| `generic-listing` | 17 | 6 | 4 | 5 |
| `personio` | 14 | **0** | 0 | **0** |

**C'est le cœur du défaut corrigé.** `teamtailor` (113 sources), `recruitee` (22), `personio` (14) ne déclarent
**jamais** de total : sous l'ancienne règle, « pas de total » valait « incomplet », donc `recruitee` et `personio`
avaient **0 source** autorisée à fermer quoi que ce soit. `greenhouse` et `lever` s'en sortaient uniquement parce
que leur adaptateur affirme explicitement sa complétude.

### Capacité à vérifier le détail

*Dénominateur : familles ≥ 3 sources dont le dernier run porte un taux de description.*

Taux de description de 0,82 (`generic-listing`) à 0,997 (`teamtailor`) ; **taux de date = 1,000 partout sauf
`workday` 0,993 et `successfactors` 0,999**. La date de publication est donc lisible sur la quasi-totalité du
catalogue : elle n'est pas le facteur limitant de la fraîcheur.

## 2. Les règles retenues

### Fenêtre de péremption (au bout de combien de silence une offre peut être fermée)

La règle générique reste **48 h** (`REFRESH_STALE_HOURS`), et elle est justifiée : avec un intervalle réel de
3–4 h entre runs, 48 h laisse passer une douzaine d'occasions de ré-attester avant toute fermeture. L'invariant
de cadence déjà testé (`cadence.test.ts`) l'exige : `staleHours ≥ ceil(pages/fenêtre) × intervalle × 1,5`.

**Ce qui est différencié n'est pas la fenêtre, c'est le DROIT de l'appliquer.** Une fenêtre courte sur une source
qui ne prouve pas son énumération fermerait des offres qu'elle n'a pas lues ; c'est pourquoi la fenêtre est
uniforme et le **droit d'attester** est, lui, conditionné source par source :

| Condition sur le dernier run | Peut fermer par le silence ? | Justification mesurée |
|---|---|---|
| Énumération `PROVEN` (total déclaré couvert à ≥ 90 %, ou adaptateur qui l'affirme) | **oui** | 2 091/2 091 sur `tapestry` : on a vu la fin du listing |
| Énumération `UNKNOWN` **avec** une référence (run précédent ou total déclaré) | **oui**, sous garde d'effondrement | 149 sources sur 440 ne déclarent aucun total ; les refuser toutes gelait 20 503 représentations |
| Énumération `UNKNOWN` **sans** aucune référence | **non** | rien à comparer : fermer reviendrait à supprimer sur la foi de rien |
| Énumération `REFUTED` (tronquée, couverture < 90 %, total à 0 contredit) | **non** | `ulta-jibe` s'arrête sur un plafond de pages : l'absence n'y prouve rien |
| Run BROKEN / ERROR / TIMEOUT / CHALLENGED / NEW | **non** | `l-oreal-professionnel` : 0 offre rendue **sans erreur levée** |
| Erreurs de collecte > 0 | **non** | `knitwell-us-retail` : 1 999/2 000 lues mais une erreur |
| Volume < 50 % du dernier run productif | **non** | `swatch-group` 275 → 61 : une chute de 78 % n'est pas une journée d'expirations |

### Fréquence de contrôle par famille

Déduite du renouvellement mesuré, à appliquer **à la reprise des crons** (décision de Loïc, hors de ce lot) :

| Famille | Renouvellement mesuré | Fréquence retenue | Motif |
|---|---:|---|---|
| `generic-listing`, `digitalrecruiters` | 114,6 % / 56,7 % | **à chaque run** (24 h) | changent totalement entre deux passages |
| `eightfold`, `talentsoft`, `talentview` | 3–9 % | **24 h** | mouvement réel mais modéré |
| `workday`, `teamtailor`, `successfactors`, `smartrecruiters`, `greenhouse`, `recruitee`, `wttj` | < 2 % | **24 h suffit ; 48 h acceptable** | le rythme ne justifie pas davantage |

**Aucune fréquence inférieure à 24 h n'est justifiée par les mesures** : à moins de 2 % de renouvellement par run,
lire un board toutes les 4 h dépense 6 fois plus de requêtes pour la même information. C'est le fondement de la
cadence quotidienne déjà décidée (D36).

### Délais de traitement des situations invérifiables

*Source : `src/pipeline/unverifiable.ts`, `OVERDUE_DAYS`, testé unitairement.*

| Nature | Délai admis | Pourquoi ce délai |
|---|---:|---|
| `DETAIL_UNREADABLE` (403, timeout, réseau, parsing) | 7 j | un incident réseau se résout au run suivant ; une semaine signifie un défaut installé |
| `DETAIL_INCOMPLETE` (fait manquant dans le détail) | 3 j | ne se répare pas tout seul : c'est l'adaptateur ou le portail |
| `PUBLISHER_CONTRADICTION` | 7 j | dépend d'une correction de l'éditeur, qu'on ne contrôle pas |
| `OUT_OF_PERIMETER` | 90 j | décision déjà prise ; seule la relecture périodique s'applique |
| `LISTING_NOT_ENUMERATED` | 7 j | au-delà, la configuration est en cause (partition, plafond de pages) |
| `COLLECTION_FAILED` | 3 j | l'incident le plus visible ; 3 jours sans reprise est une panne |
| `VOLUME_COLLAPSED` | 3 j | attend une confirmation par un run sain |

Au-delà du délai, l'état passe à `OVERDUE` : le dossier n'est plus « en attente », il est à instruire.
