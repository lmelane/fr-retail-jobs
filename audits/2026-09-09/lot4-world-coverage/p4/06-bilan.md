# P4 — bilan structuré

Toutes les mesures : production en **lecture seule**, 2026-09-11, transaction `RepeatableRead` dont le niveau est
asserté. Scénarios de cycle de vie sur **clone**. **Aucune écriture de production.** Crons gelés, catalogue
inchangé, aucun run global.

## 1. Avant

| | Mesuré |
|---|---|
| Offres `Job` | 83 070 · actives **78 932** · fermées 2 772 · retirées 1 344 · inactives sans date **22** |
| Invariant `closedAt` / `withdrawnAt` | **tient** : 0 offre active portant `closedAt` |
| Réouvertures | 212 offres, 212 événements `REOPENED` |
| Fraîcheur | < 24 h : 5 437 · 24–48 h : 20 774 · 48 h–7 j : 54 618 · **au-delà de 7 j : 0** (dénominateur 80 829 représentations actives) |
| **Droit d'attester l'absence** | **224 sources sur 440** ne l'ont pas, portant **41 795 représentations vivantes sur 80 829 (51,7 %)** |
| Dont sources ayant tout lu | **187 sources / 20 796 représentations** avaient lu tout leur total déclaré, sans erreur ni troncature, et étaient bloquées |
| Retenues de publication | **838 offres** dans `SourceObservation`, **sans état, ni ancienneté exploitable, ni action suivante, ni condition de levée** |

Les offres de ces 224 sources ne pouvaient donc **jamais** se fermer par le silence — ce qui est la bonne règle —
mais **rien ne les suivait**, ce qui est le défaut.

## 2. Causes établies

**Cause racine, une ligne** — `pipeline/ingest.ts:354` : `stats.complete = false` dès **une seule** retenue non
résolue, ce qui retirait à la source **entière** son droit d'attester. Et `ats/index.ts:81`, où `complete`
agrégeait trois questions distinctes dans un booléen dont l'absence de réponse valait « non ».

| # | Cause | Cas mesuré | Ce que le drapeau disait | Ce qui est vrai |
|---|---|---|---|---|
| **a** | Une retenue par offre décidait un fait de SOURCE | `tapestry` 5 retenues / 2 091 offres lues ; `vf-corporation` 695 / 1 273 ; `intersport-france` 63 / 993 | collecte incomplète | la collecte est complète ; quelques pages sont défectueuses |
| **b** | « Inconnu » rendu comme « prouvé incomplet » | `boots` (aucun total déclaré), `pvh`, `adidas` ; **149 sources sur 440** ne déclarent aucun total (teamtailor 113, recruitee 22, personio 14) | collecte incomplète | on ne sait pas — ce n'est pas la même chose |
| **c** | Une unité d'écart refusait la complétude | `kering` 1 025/1 026 ; `knitwell-us-retail` 1 999/2 000 | collecte incomplète | 99,9 % lu ; le seuil de couverture de 0,9 l'accepte déjà ailleurs |
| **d** | `fetched` absent lu comme `fetched = 0` | **98 sources** dont le dernier run précède la colonne (5–6 sept.), volume stable par ailleurs | effondrement de 100 % | la colonne n'existait pas |
| **e** | Santé confondue avec énumération | 216 sources marquées `DEGRADED` | source dégradée | elles lisaient parfaitement leur board |

## 3. Modifications du code

| Fichier | Changement |
|---|---|
| `src/pipeline/enumeration.ts` **(nouveau)** | verdict à **trois valeurs** `PROVEN` / `UNKNOWN` / `REFUTED`. Ordre : troncature → refus d'adaptateur → total à 0 contredit → **démonstration de parcours** → couverture (qui ne peut que réfuter) → doute. **Un ratio ne produit plus `PROVEN`.** |
| `src/pipeline/unverifiable.ts` **(nouveau)** | classement des situations par **nature**, délais admis par nature, état / action suivante / condition de résolution |
| `src/ats/index.ts` | `normalizeAdapterResult` produit le verdict ; `truncated` tolère la même marge de 0,9 que le reste de la chaîne |
| `src/pipeline/attestation.ts` | **`complete !== true` refuse** : seul un parcours démontré autorise une fermeture ; `fetched` absent n'est plus lu comme zéro ; les seuils 0,9 et 0,5 ne servent plus qu'à refuser |
| `src/pipeline/ingest.ts` | une retenue **n'affecte plus** l'énumération de la source |
| `src/pipeline/health.ts` | `DEGRADED` réservé à une énumération **réfutée** ; `previous` passé à la porte d'attestation au lieu d'être vérifié à côté ; le motif nomme laquelle des trois valeurs s'applique |
| `src/types.ts` | `AdapterResult.enumerationVerdict`, et le contrat « absence = inconnu » enfin honoré |

## 4. Tests ajoutés

| Fichier | Tests | Ce qu'ils verrouillent |
|---|---:|---|
| `src/pipeline/enumeration.test.ts` | 22 | les trois verdicts sur les **runs réellement archivés** ; que `UNKNOWN` ne devienne jamais `false` ; que les contre-exemples (`swatch-group`, `ulta-jibe`, `l-oreal-professionnel`) restent bloqués ; que le trou « inconnu sans référence » soit fermé ; que `fetched` absent ne soit pas zéro |
| `src/pipeline/unverifiable.test.ts` | 10 | le classement par nature et non par libellé ; qu'un motif inconnu tombe au plus prudent ; que l'ancienneté l'emporte sur la nature ; qu'une **tentative échouée ne remplace jamais** une dernière observation fiable |
| `src/pipeline/health.test.ts` | +2 révisés | qu'une énumération inconnue n'attest qu'**avec** une référence, et qu'un effondrement la refuse quand même |
| `src/pipeline/closure-requires-proven.test.ts` **(nouveau)** | 4 | les quatre cas bornés exigés, **sur le chemin réel** (`checkSourceHealth` puis `runRefresh`) |
| `src/ats/completion.test.ts`, `normalizeAdapterResult.test.ts` | révisés | qu'un compteur atteint **ne prouve pas** la complétude ; que seule la démonstration de l'adaptateur le fasse |

**Total : 1 748 tests unitaires + 307 d'intégration verts, typecheck 0 erreur** (sources et scripts).

## 5. Résultats sur archives et clones

### Effet de la règle, rejoué sur les runs archivés (`attestation-replay.mts`)

> **Règle imposée le 2026-09-11, après un premier correctif jugé trop permissif.** La distinction
> `PROVEN` / `UNKNOWN` / `REFUTED` était juste, sa conséquence ne l'était pas : `UNKNOWN` obtenait le droit de
> fermer dès qu'un volume de référence existait. Or un volume stable ne prouve pas que **le même périmètre** a été
> parcouru, et une couverture de 90 % n'atteste rien sur les offres situées dans les 10 % non lus.
> **Seule une énumération `PROVEN` — un parcours démontré — produit désormais `canAttestAbsence = true`.**

La démonstration de parcours est lue **à la source** : les adaptateurs archivent leur propre verdict
d'énumération (terminaison, anomalies, drapeau `complete`), et c'est cette trace — non un ratio — qui décide.

| Groupe de preuve | Sources | Représentations |
|---|---:|---:|
| **Parcours démontré** (`PROVEN`) | **83** | 24 047 |
| ⤷ dont **autorisées à fermer** | **53** | **20 737** |
| ⤷ dont prouvées sans trace archivée (affirmation dans `SourceRun` seule) | 20 | — |
| Preuve archivée **défavorable** (l'adaptateur refuse lui-même) | 3 | 3 819 |
| **Aucune trace d'énumération archivée** | 374 | 60 946 |

| | Sources pouvant fermer | Représentations couvertes |
|---|---:|---:|
| Avant (règle du matin, trop permissive) | 216 | 39 034 |
| **Après (parcours démontré exigé)** | **53** | **20 737** |
| **Perdues** | **165** | — |

*Dénominateurs : 440 sources portant des offres vivantes, 80 829 représentations actives.*

**Le gain de 186 sources annoncé le matin est retiré.** Il reposait sur l'acceptation d'`UNKNOWN`, c'est-à-dire
sur des fermetures qui n'étaient pas prouvées. La sécurité des fermetures prime : **165 sources perdent un droit
qu'elles n'auraient jamais dû avoir**, et c'est le résultat attendu de la règle, non une régression.

**Contrôle de cohérence exécuté : 0 source n'atteste hors du groupe « parcours démontré ».** Le champ
`attestingWithoutDemonstration` du rapport le vérifie et reste vide.

Motifs de blocage des 387 restantes : `aucune trace d'énumération archivée` 340 · `run NEW` 26 ·
`effondrement du volume` 8 · `listing tronqué` 6 · `erreurs de collecte` 3 ·
`parcours non prouvé par l'adaptateur` 2 (Tapestry, Kering) · `run BROKEN` 1 ·
`aucune démonstration de parcours` 1 · `couverture sous le seuil` 1.

> **Limite majeure, mesurée et déclarée.** L'événement `source.enumeration_observed` n'existe que depuis le
> 2026-09-09 et n'est archivé que pour **87 sources sur 440**. Les autres n'ont jamais consigné leur preuve de
> parcours — non parce qu'elles ne l'ont pas mené, mais parce que la trace n'existait pas lors de leur dernier
> run. Elles ne pourront attester qu'après un nouveau run. C'est la conséquence **correcte** de la règle : on ne
> ferme pas sur une preuve absente.

### Les quatre cas bornés exigés, sur le chemin réel — 4/4 PASS

`src/pipeline/closure-requires-proven.test.ts` : `checkSourceHealth` calcule `canAttestAbsence` comme en
production, puis `runRefresh` — la fonction de clôture — décide. Aucun prédicat testé en isolation.

| Cas | Attendu | Obtenu |
|---|---|---|
| **1.** `UNKNOWN`, même volume (3 → 3) mais ensemble d'identifiants **différent** | aucune fermeture | `canAttestAbsence: false` ; les 3 offres absentes restent **actives**, `closedAt` et `withdrawnAt` nuls |
| **2.** `UNKNOWN` à **60 %** du volume précédent (100 → 60) | aucune fermeture malgré le franchissement du seuil de 50 % | `canAttestAbsence: false` ; aucune offre fermée ni retirée |
| **3.** Total déclaré **100**, **90** identifiants lus | aucune fermeture sans preuve de fin | verdict `UNKNOWN`, `canAttestAbsence: false`, offres actives |
| **4.** ATS **sans total**, pagination parcourue jusqu'à sa fin | `PROVEN`, fermeture autorisée | `complete: true`, `canAttestAbsence: true`, offres fermées avec `closedAt` et `withdrawnAt` nul |

### Scénarios exécutés sur clone avec le VRAI `runRefresh` — 8/8 PASS

| Scénario | Attendu | Obtenu |
|---|---|---|
| Aucune fermeture abusive — `BROKEN` | 3 offres périmées de 30 jours restent actives | actives, `closedAt` nul, `withdrawnAt` nul, **0 événement** |
| idem — `TIMEOUT` | idem | idem |
| idem — `CHALLENGED` | idem | idem |
| idem — `ERROR` | idem | idem |
| Fermeture propagée | run fiable, offres non relistées → fermées | 3 fermées, `closedAt` daté, `withdrawnAt` nul, **3 événements `CLOSED`** |
| Réouverture propagée | même identité qui réapparaît | réactivées, `closedAt` effacé, **`reopenedCount` = 1**, **2 représentations (aucun doublon)**, 2 événements `REOPENED` |
| Retrait ≠ fermeture | offre sans attestation vivante | `withdrawnAt` daté + `ATTESTATION_MISSING`, **`closedAt` NUL**, 2 événements `WITHDRAWN` |
| Republication après retrait | aucune date employeur inventée | réactivée, **`reopenedCount` reste 0**, événement `REPUBLISHED` et **jamais `REOPENED`** |

Comparaisons faites par **identifiants, valeurs et événements**, jamais par compteur.

## 6. Mesures de fraîcheur retenues

Détail et dénominateurs : [03-cadences-mesurees.md](03-cadences-mesurees.md).

- **Renouvellement réel par run** : `generic-listing` **114,6 %** et `digitalrecruiters` **56,7 %** contre
  **< 2 %** pour workday, teamtailor, successfactors, smartrecruiters, greenhouse, wttj. Un facteur 100, mesuré
  sur 8 000+ paires de runs — c'est ce qui justifie des cadences différenciées.
- **Durée de vie observée des offres fermées** : médiane 1–6 j, **p90 ≤ 7 j** selon la famille (2 604 offres).
  Limite déclarée : l'historique disponible est court (base reconstruite début septembre, crons gelés depuis le
  9), donc aucune durée > 9 jours ne peut apparaître. Les seuils retenus n'en dépendent pas.
- **Fenêtre de péremption** : **48 h**, justifiée par la combinaison réellement prévue — intervalle
  d'ingestion **24 h** (`INGEST_INTERVAL_HOURS`, verrouillé par `cadence.test.ts`), donc **2 occasions** de
  ré-attester et la marge d'**un run quotidien manqué** ; et 48 h ≥ les **36 h** exigées par l'invariant L-01
  pour la seule source à rotation (`fashionjobs`, 282 pages / 300 par run × 24 h × 1,5). *La première version de
  ce rapport invoquait « une douzaine d'occasions » déduites d'un intervalle de 3–4 h : c'était l'intervalle
  historique des runs de septembre, incohérent avec la cadence retenue. Corrigé.*
- **Fréquence de contrôle** : **24 h suffit partout**, aucune mesure ne justifie moins ; les deux familles à fort
  renouvellement doivent être dans **chaque** run.
- **Ce qui est différencié n'est pas la fenêtre mais le DROIT de l'appliquer**, source par source.

## 7. Cas Saks, Tapestry, KnitWell, VF

Détail : [05-dossiers-saks-tapestry-knitwell-vf.md](05-dossiers-saks-tapestry-knitwell-vf.md).

| Dossier | Énumération avant → après | Attestation | Représentations libérées | Retenues suivies |
|---|---|---|---:|---:|
| **Saks** | `PROVEN` → `PROVEN` | oui → oui *(contrôle négatif)* | 0 | 0 |
| **Tapestry** | `false` → **`PROVEN`** | non → **oui** | **2 183** | 5 |
| **VF Corporation** | `false` → **`PROVEN`** | non → **oui** | **578** | 695 |
| **KnitWell** (3 sources) | `false`/`true` → `UNKNOWN`/`PROVEN` | non → **non** | 0 | 1 |

KnitWell **reste bloquée** : deux sources portent une erreur de collecte, la troisième est un premier run. C'est le
contre-exemple qui montre que le correctif ne dilue pas la garde. La décision de Loïc sur les 695 offres VF sans
employeur (archivées et tenues, jamais créditées au groupe) est **appliquée telle quelle**.

## 8. Après

| | Avant | Après |
|---|---:|---:|
| Sources pouvant attester l'absence | 216 / 440 | **53 / 440** |
| Représentations vivantes sous une source qui peut fermer | 39 034 / 80 829 (48,3 %) | **20 737 / 80 829 (25,7 %)** |
| Sources fermant sur une preuve **non fondée** | 216 | **0** |
| Sources bloquées **pour un motif nommé** | 224 | **387** *(dont 340 faute de trace d'énumération archivée)* |
| Sources au parcours **démontré** | non mesuré | **83** |
| Situations invérifiables avec état, ancienneté, action et condition de levée | **0** | **1 062** |
| Offres produisant un `DEGRADED` sans défaut | 216 sources | **0** |
| Écritures de production | — | **0** |

## 9. Dossiers encore invérifiables

**1 062 dossiers suivis** (`unverifiable-register.json`), chacun avec source, identifiant externe, motif, date de
première retenue, date de dernière tentative, **date de dernière observation fiable (nulle quand elle n'existe
pas)**, ancienneté, état, action suivante, condition de résolution, blocage éventuel.

| Nature | Dossiers | Délai admis | État |
|---|---:|---:|---|
| `DETAIL_INCOMPLETE` | 728 | 3 j | `NEEDS_REVIEW` — dont les 695 VF, décision de Loïc appliquée |
| `LISTING_NOT_ENUMERATED` | 212 | 7 j | `NEEDS_REVIEW` — partition ou plafond de pages à établir |
| `PUBLISHER_CONTRADICTION` | 61 | 7 j | `NEEDS_REVIEW` — dépend d'une correction de l'éditeur |
| `OUT_OF_PERIMETER` | 38 | 90 j | `AWAITING_NEXT_RUN` — décision déjà prise, pas une anomalie |
| `DETAIL_UNREADABLE` | 11 | 7 j | `AWAITING_NEXT_RUN` — incident réseau, se résout au run suivant |
| `VOLUME_COLLAPSED` | 8 | 3 j | `AWAITING_NEXT_RUN` — attend confirmation par un run sain |
| `COLLECTION_FAILED` | 4 | 3 j | `NEEDS_REVIEW` — diagnostic de la cause nommée d'abord |

Par état : `NEEDS_REVIEW` 974 · `AWAITING_NEXT_RUN` 50 · **`OVERDUE` 38**.

**Aucun de ces dossiers n'est déclaré conforme**, aucun n'est fermé sans preuve, aucun n'est déclaré ouvert
indéfiniment sans traitement.

## 10. Limites et blocages réels

| Limite | Nature | Traitement |
|---|---|---|
| **Les crons sont gelés depuis le 2026-09-09** | aucune fermeture réelle ne peut être observée en production ; le correctif est prouvé sur archives et clone, pas encore par un run | la reprise des crons est une **décision de Loïc** (D57), hors de ce lot |
| **22 offres inactives sans `closedAt` ni `withdrawnAt`** | état antérieur à la séparation des deux notions | **non réparé** : aucune preuve ne permet de décider rétroactivement laquelle poser, et en inventer une serait exactement ce que la règle interdit |
| **4 604 offres ACTIVES sans `canonicalSourceKey`** (5,8 % des actives) | défaut de rang canonique, trouvé en mesurant la durée de vie | **hors périmètre P4** (dédup / rang canonique, pas cycle de vie) — inscrit au suivi. Il fausse toute mesure par famille passant par cette colonne ; les mesures de ce lot passent par `JobSource` |
| **Historique court** | la base a été reconstruite début septembre : aucune durée de vie > 9 jours ne peut apparaître | déclaré partout où une durée est citée ; les seuils retenus n'en dépendent pas |
| **`heldUnresolved` n'est pas une colonne de `SourceRun`** | pour un run archivé, on ne distingue pas formellement un `complete:false` dû aux retenues d'un dû à l'énumération | reconstitué par un critère explicite (non tronqué, sans erreur, couverture atteinte, retenues présentes) → 4 sources attribuées aux retenues, et la limite est écrite dans le script |
| **`adapterProvesCompletion` non relisible en base** | la colonne stocke le résultat, pas l'affirmation d'origine | le rejeu **sous-estime** donc le gain ; déclaré dans le script |
| **`DEGRADED` sur une source qui porte des retenues** | conservé volontairement | c'est un signalement, jamais un blocage : `DEGRADED` n'est pas dans `NEVER_ATTESTS` |

## Tableau final

| Finding | État avant | Cause | Correction | Test | Résultat | Production modifiée ? | Preuve | Statut |
|---|---|---|---|---|---|---|---|---|
| Une retenue bloque toute la source | `tapestry` 5 retenues / 2 091 lues → 2 183 représentations infermables | `ingest.ts:354` posait `stats.complete = false` | la retenue n'affecte plus l'énumération de la source | `enumeration.test.ts`, `unverifiable.test.ts` | 4 sources débloquées par ce seul motif ; 2 761 représentations (Tapestry + VF) | **non** | `hold-blast-radius.json`, `attestation-replay.json` | **corrigé** |
| « Inconnu » traité comme « prouvé incomplet » | 149 sources sur 440 ne déclarent aucun total ; `recruitee` et `personio` avaient **0** source pouvant fermer | `complete` booléen dont l'absence valait `false` | verdict à trois valeurs ; `UNKNOWN` cesse d'être confondu avec une incomplétude prouvée | `enumeration.test.ts` (22), `health.test.ts` | la distinction est portée ; le DROIT DE FERMER, lui, est traité à la ligne suivante | **non** | `attestation-replay.json` | **corrigé** |
| `UNKNOWN` obtenait le droit de fermer sur un volume de référence | un volume stable ou > 50 % du précédent, ou une couverture de 90 %, suffisaient — or aucun des deux ne prouve que le **même périmètre** a été parcouru | la porte acceptait `complete !== false` puis se rabattait sur des ratios | **seul `PROVEN` autorise une fermeture** ; les seuils 0,5 et 0,9 ne peuvent plus que REFUSER | `closure-requires-proven.test.ts` (4 cas bornés sur le chemin réel) | **53 sources / 20 737 représentations** peuvent fermer, **165 perdent** un droit non fondé ; **0 source n'atteste hors parcours démontré** | **non** | `attestation-replay.json`, `evidenceGroups` | **corrigé** |
| Tapestry : 5 offres hors facette sous un plafond de site | `UNPARTITIONED_UNDER_CAP` | le compteur du site plafonne à 2 000 ; le résiduel n'est atteignable que par lui | aucune — le refus de l'adaptateur est **juste** et conservé | `workday.partition.test.ts` | Tapestry reste **non prouvée** : 5 offres de son board sont inatteignables | **non** | `attestation-replay.json` | **dossier ouvert, honnête** |
| Une unité d'écart refusait la complétude | `kering` 1 025/1 026 | `unique === declaredTotal` exigé | seuil de couverture 0,9, cohérent avec le reste de la chaîne | `normalizeAdapterResult.test.ts` | `kering`, `knitwell` passent `PROVEN` | **non** | `attestation-replay.json` | **corrigé** |
| `fetched` absent lu comme zéro | 98 sources, volume stable, lues comme effondrées à 100 % | colonne ajoutée après ces runs | `fetched != null` exigé pour comparer | `enumeration.test.ts` | 7 sources vérifiées débloquées (`hermes`, `a-p-c`…) | **non** | `attestation-replay.json` | **corrigé** |
| Santé confondue avec énumération | 216 sources `DEGRADED` sans défaut | `health.ts` : `complete !== true` → DEGRADED | `DEGRADED` réservé à une énumération **réfutée** | `health.test.ts` | le digest cesse de noyer les vraies pannes | **non** | code + tests | **corrigé** |
| Deux endroits jugeaient l'effondrement | `previous` vérifié à côté de la porte, pas dedans | règle dupliquée | `previous` passé à `isTrustedForAttestation`, comparaison sur `jobs` conservée en plus | `health.test.ts` | une seule fonction décide | **non** | code + tests | **corrigé** |
| Retenues sans état ni suivi | 838 offres, aucune ancienneté exploitable, aucune action | `SourceObservation` ne porte que `observedAt` | registre dérivé : nature, état, ancienneté, action, condition de levée | `unverifiable.test.ts` (10) | **1 062 dossiers suivis**, 38 `OVERDUE` identifiés | **non** | `unverifiable-register.json` | **corrigé** |
| Aucune fermeture abusive | à prouver | — | — | 4 scénarios clone | BROKEN / TIMEOUT / CHALLENGED / ERROR : **0 fermeture, 0 retrait, 0 événement** | **non** | `lifecycle-scenarios.json` | **prouvé** |
| Fermeture et réouverture propagées | à prouver | — | — | 2 scénarios clone | `closedAt` daté + `CLOSED` ; réouverture sans doublon, `reopenedCount` 0 → 1 | **non** | `lifecycle-scenarios.json` | **prouvé** |
| Aucune date employeur inventée | à prouver | — | — | 2 scénarios clone | retrait → `withdrawnAt` + `closedAt` **nul** ; republication → `REPUBLISHED`, compteur inchangé | **non** | `lifecycle-scenarios.json` | **prouvé** |
| 22 offres inactives sans date | 22 | antérieur à la séparation des deux notions | aucune : inventer une date est interdit | — | déclaré | **non** | `lifecycle-reference.json` | **limite déclarée** |
| 4 604 actives sans `canonicalSourceKey` | 4 604 (5,8 %) | rang canonique non porté par une source attachée | aucune dans ce lot | — | mesures de P4 passées par `JobSource` | **non** | `freshness-cadence.json` | **hors périmètre, au suivi** |

## Les règles retenues, en clair

**Objectifs de fraîcheur** — aucune représentation active au-delà de 7 jours d'observation native (mesuré : 0 sur
80 829, crons gelés). À la reprise, la cible est 100 % des représentations revues en moins de 48 h.

**Fréquences de contrôle** — 24 h pour toutes les familles ; `generic-listing` et `digitalrecruiters` dans chaque
run (renouvellement mesuré 114,6 % et 56,7 %). Aucune mesure ne justifie une fréquence inférieure à 24 h.

**Délais et conditions de fermeture** — 48 h de silence **et** un run dont l'énumération est `PROVEN`, c'est-à-dire
dont le **parcours est démontré** : fin d'endpoint, fin de pagination, ou toutes les partitions lues. `UNKNOWN` ne
ferme rien, avec ou sans volume de référence. Jamais sur un run BROKEN, ERROR, TIMEOUT, CHALLENGED, NEW, tronqué,
en erreur, sous 90 % d'un total déclaré, ou dont le volume s'est effondré sous la moitié du dernier run productif
— ces deux derniers seuils restant des **indicateurs de santé qui refusent**, jamais des preuves de disparition.

**Conditions de réouverture** — la **même identité** (`sourceKey` + `externalId`) réapparaît dans un listing :
l'offre est réactivée sans doublon. `reopenedCount` s'incrémente **seulement** si `closedAt` était posé ; un
retour après retrait administratif produit `REPUBLISHED` et laisse le compteur intact.

**Runs incomplets ou dégradés** — ils ne ferment rien. `DEGRADED` signale un défaut sans retirer à lui seul le
droit d'attester ; le droit s'obtient uniquement par un parcours démontré, et se perd sur une énumération réfutée,
une erreur de collecte, une troncature, un effondrement ou un statut d'échec. Une offre non revue par un run non
fiable **survit telle quelle**.

## GO / NO-GO pour P5

**GO**, motivé :

- les six critères de validation du lot sont démontrés sur archives réelles et sur clone avec les fonctions de
  production, jamais avec un script parallèle ;
- la règle métier imposée est tenue : **seul un parcours démontré ferme**, mesuré avec ses dénominateurs
  (**53 sources / 20 737 représentations**, **0 source n'attestant hors parcours démontré**), et les
  contre-exemples qui devaient rester bloqués le restent tous (`swatch-group`, `ulta-jibe`,
  `l-oreal-professionnel`, `knitwell` ×3, `tapestry`, `kering`) ;
- **le gain de 186 sources annoncé le matin est retiré**, sans tentative de le préserver : il reposait sur des
  fermetures non prouvées. 165 sources perdent un droit qu'elles n'auraient pas dû avoir ;
- les situations encore invérifiables ne sont **pas déclarées conformes** : elles ont un état, une ancienneté, une
  action suivante et une condition de levée, et 38 sont explicitement en retard ;
- **1 748 tests unitaires + 307 d'intégration verts**, typecheck 0 erreur, aucune écriture de production.

**Ce que P4 ne clôt pas, et qui doit être porté par la suite :**

1. **La reprise des crons reste une décision de Loïc** (D57), et elle devient la condition du retour à une
   couverture normale des fermetures : **340 sources sur 440 n'ont aucune trace d'énumération archivée** (le
   journal `source.enumeration_observed` n'existe que depuis le 2026-09-09) et ne pourront prouver leur parcours
   qu'après un nouveau run. Tant que les crons sont gelés, le catalogue ne ferme donc presque plus rien — ce qui
   est sûr, mais fait vieillir les offres expirées. C'est la limite la plus importante du lot, et elle n'est pas
   technique.
2. **4 604 offres actives sans rang canonique** — dossier ouvert, hors périmètre P4.
3. **22 offres inactives sans date de sortie** — irréparables sans inventer une preuve.
4. Les dossiers résiduels de P2 restent suivis séparément.
