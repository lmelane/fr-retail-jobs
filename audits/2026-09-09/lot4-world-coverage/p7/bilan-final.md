> **Archive de preuve datée.** Les chemins de cycle de vie cités ici ont été remplacés au lot 1 du 15 septembre 2026. Ce document conserve les constats de son audit ; utiliser la [documentation d’exploitation maintenue](../../../../apps/aggregator/scripts/ops/README.md) pour les commandes actuelles.

# P7 — bilan final des deux cycles bornés

> Exécuté le 2026-09-12. Chaque chiffre est une mesure, jamais une estimation. Crons gelés d'un bout à l'autre.

## Avant

| | |
|---|---|
| Offres actives au départ | **79 049** |
| Sources actives / en pause | 433 / 7 |
| Offres actives portant `closedAt` | 0 |
| Crons | gelés sur `0 0 29 2 *`, `PIPELINE_PAUSED=1`, les trois services |

## Périmètre

Neuf sources candidates, **aucune admise par défaut**. La condition décisive est mesurée dans le code déployé :
seuls trois adaptateurs émettent `canonicalIds`, donc seuls trois peuvent **prouver** une absence.

| Catégorie | Sources | Motif |
|---|---|---|
| **A — les deux cycles** | `mecca` (Workday) · `ganni-talentrecruiter` (TalentRecruiter) · `american-vintage-dr` (DigitalRecruiters) | contrat canonique déclaré |
| **B — collecte OK, refresh exclu** | `dr-pierre-ricaud` · `lagardere-travel-retail` · `urbn-hub` · `beiersdorf` · `lindex-easycruit` · `saltrock-harri` | adaptateur sans `canonicalIds` : aucune absence démontrable |

Les trois familles exigées sont couvertes, une source chacune, trois ATS sans code commun.

## Code final

`d3e5a966` pour les deux cycles ; `6a945094` après l'addendum terminal (garde des 5 % exécutoire, instrumentation des ressources, réconciliation du sitemap). Tout est sur `main` et déployé. Aucune branche P7 restante, aucune PR P7
ouverte. Service web légitimement sur son propre commit (`SAME_CODE_FOR_THIS_SERVICE` : aucun fichier
`apps/web/` ni `packages/db/` touché).

## Sauvegarde / restauration

Chaque mutation précédée d'un dump frais **restauré dans un clone** et comparé à la production sur six
grandeurs — la restauration *est* la preuve. Cycle 2 : 496 349 680 octets, sha256 `cbe6f544…`, clone identique
à la production sur les six.

## Les deux cycles

| | Cycle 1 | Cycle 2 |
|---|--:|--:|
| Run | `6e7e070b` | `87b2fdf6` |
| Sources OK | 3/3 | 3/3 |
| Offres collectées | 227 | 227 |
| Erreurs · troncatures | 0 · 0 | 0 · 0 |
| **Contrats (adaptateur + persistance)** | **3/3** | **3/3** |
| Retenues · write failures · rejets · anonymes | 0 · 0 · 0 · 0 | 0 · 0 · 0 · 0 |
| Ré-attestées | 227 | 227 |
| **Absences prouvées** | **21** | **8** |
| Candidates à fermeture | 18 (7,26 %) | 5 (**2,13 %, garde respectée**) |
| Manifeste figé | 15 lignes · `bb29dab0…` | 8 lignes · `3c89c52a…` |
| Run refresh | `0f27758f` | `ec119288` |
| Désactivations réelles | 13 | 6 |
| Fermetures | 13 | 3 |
| Conservées par une autre source | 0 | 3 |
| **Audit** | **`problems: []`** | **`problems: []`** |

L'empreinte du manifeste du cycle 1 est **identique** au rejeu : le plan est stable, il ne dépend pas de
l'instant où on le calcule.

## Intersection des absences

```
ABSENT_FROM_PROVEN_ENUMERATION (cycle 1)  ∩  ABSENT_FROM_PROVEN_ENUMERATION (cycle 2)  =  8
```

| | |
|---|--:|
| Absentes au cycle 1 seulement | 13 *(exactement celles que le cycle 1 a fermées)* |
| Absentes au cycle 2 seulement | **0** |
| **Absentes aux DEUX** | **8** — American Vintage 6, GANNI 2 |

## Vérification chez le publieur — 21/21, avec témoins

Aucune fermeture sans preuve **externe**. Chaque sonde est validée par un témoin observé : une sonde qui
répondrait pareil pour tout ne prouverait rien.

| Source | Absences | Sonde | Résultat |
|---|--:|---|---|
| MECCA | 12/12 | API Workday | `jobPostingInfo` absent · témoins R015646 / R015650 rendus |
| GANNI | 3/3 | flux `positionlist` | le flux rend **exactement les 15 observés** · témoins présents |
| American Vintage | 6/6 | URL stockée | redirection `notify_job_ad_close` · témoins encore publiés |

**Les trois publieurs répondent HTTP 200 sur une offre morte.** Un contrôle par code de statut aurait déclaré
les 21 vivantes. Le cas le plus instructif est GANNI `144681`, dont la page de candidature rend encore 309 ko
comme une offre vivante : conclure sur la page aurait contredit l'absence. *La présence dans le FLUX est la
preuve, pas la page* (D23).

## L'exception American Vintage — appliquée à la lettre

Conditions du propriétaire, toutes vérifiées : mêmes identifiants canoniques, absents aux **deux** cycles,
fermeture **re-confirmée chez le publieur après le cycle 2** (6/6), contrats satisfaits aux deux cycles,
0 retenue, 0 write failure, 0 ligne anonyme, aucune contradiction entre cycles.

| Identifiant | Autre attestation | Conséquence appliquée |
|---|---|---|
| 4516931 · 4522689 · 4555473 | aucune | **Job fermé** — `closedAt` posé, `withdrawnAt` **non utilisé** |
| 4553457 · 4573163 · 4587897 | `wttj-sector` active | **seule la représentation AV désactivée**, Job **actif** |

Aucun septième identifiant. Aucune autre source. Le seuil global de 5 % est **inchangé**.

> **Constat de méthode, et sa correction.** Pendant les deux cycles, le ratio de 5 % était *calculé et affiché*
> par la prévisualisation mais **lu par aucun code** — un indicateur, pas une barrière. La vraie barrière était
> le **manifeste figé** (source non recevable, état autre que `ABSENT_FROM_PROVEN_ENUMERATION`, ligne déjà
> inactive). L'exception n'a donc contourné aucune garde : elle a emprunté le chemin normal.
>
> **La garde est désormais réelle** (addendum terminal, ci-dessous). Conséquence à énoncer clairement : le plan
> du cycle 1 valait **7,26 %** — avec la garde en place, il aurait été **refusé** sans dérogation. Ses
> 21 absences ont néanmoins été vérifiées une par une chez les publieurs, et l'audit conclut `problems: []`.

## Addendum terminal — la garde des 5 % rendue exécutoire

La politique vit maintenant dans `freeze-manifest.mts`, la dernière chose produite avant la mutation et ce que
la mutation consomme.

**Deux précisions qui changent le résultat :**

1. On compte des **fermetures d'offre**, jamais des désactivations de représentation. Désactiver la
   représentation d'une source pendant qu'une autre atteste encore l'offre ne ferme rien pour le candidat —
   cas réel : American Vintage, 6 représentations, **3** fermetures. Les compter aurait gonflé le ratio et fait
   refuser une opération inoffensive.
2. Le **dénominateur** (`perimeterLiveJobs`) est écrit dans le verdict pour être relu. C'est par lui qu'on
   truque un ratio sans mentir sur le numérateur.

Les sept scénarios, exercés contre le **programme réel sur clone restauré** :

| # | Cas | Verdict | Motif rendu |
|--:|---|---|---|
| 1 | 2 % sans dérogation | **autorisé** | — |
| 2 | 10 % sans dérogation | **REFUS** | « ratio 10 % > 5 % et aucune dérogation » |
| 3 | dérogation exacte | **autorisé** | dérogation appliquée |
| 4 | identifiant non approuvé au plan | **REFUS** | l'identifiant est nommé |
| 5a | plan réduit après approbation | **REFUS** | « fractionner est interdit » |
| 5b | conséquence modifiée | **REFUS** | approuvé vs présenté |
| 5c | `planHash` différent | **REFUS** | « plan régénéré ou modifié » |
| 6 | 10 représentations, Jobs conservés | **autorisé** | **0 fermeture** comptée |
| 7 | ancien comportement rétabli | **les tests échouent** | contre-exemple vérifié |

> **Défaut évité en vérifiant plutôt qu'en supposant** : le champ est `perimeterLiveJobs`, pas `perimeter`. Le
> nom plausible aurait rendu `undefined`, donc un dénominateur nul, donc un refus permanent — une garde qui
> refuse tout est aussi inutilisable qu'une garde absente.

## Le manifeste est un PLAFOND, pas un plancher

`runRefresh` cumule **trois** conditions : allowlist **ET** manifeste **ET** `lastSeenAt < 48 h`.

Deux lignes GANNI (`144681`, `144688`) sont prouvées absentes aux deux cycles mais **re-vues il y a 10,9 h** :
elles ne sont pas fermées, et c'est le comportement voulu — une ré-attestation récente prime. Elles restent
`ABSENCE_PROUVÉE_FERMETURE_RETENUE_PAR_LA_GARDE`, sans blocage pour le reste.

Séparation mesurée, sans une seule exception : **13 lignes de 59,9 h à 118,1 h → fermées ; 2 lignes à 10,5 h →
intactes.**

## Ressources

| | Cycle 1 | Cycle 2 |
|---|--:|--:|
| Ingestion (mur) | 30,9 s | 35,9 s |
| Débit | 7,35 offres/s | 6,32 offres/s |
| `mecca` · `american-vintage-dr` · `ganni` | 30,7 s · 4,1 s · 3,2 s | 35,8 s · 4,1 s · 3,1 s |
| Tentatives HTTP / réponses | 239 / 239 (**0 retry**) | 239 / 239 (**0 retry**) |
| Erreurs · write failures · retenues | 0 · 0 · 0 | 0 · 0 · 0 |
| Échecs de persistance | 0 | 0 |
| Mutation refresh | 1,0 s | 0,3 s |
| Préflight (dump + restauration + comparaison) | ~4 min | ~3,5 min |

### Mémoire, CPU et connexions — mesurées DANS le conteneur (passe du 2026-09-13)

Une instrumentation a été ajoutée puis **déployée** (`6a945094`), et une ingestion bornée de mesure exécutée
sur les mêmes trois sources, sans refresh. Les chiffres viennent du processus qui travaille — les lire depuis
un poste local aurait décrit cet hôte, pas le service (leçon D32).

Run `fcb326e3`, 6 échantillons, 3/3 sources OK, 227 offres, **0 changement** (idempotence vérifiée).

| Grandeur | Avant | Pic | Après |
|---|--:|--:|--:|
| Mémoire RSS | 175,6 Mo | **344,1 Mo** | 240,9 Mo |
| Heap utilisé | 42,4 Mo | — | 63,5 Mo |
| Connexions Postgres (total) | 12 | **14** | 14 |
| dont actives | 1 | — | 2 |
| dont `idle` | 11 | — | 12 |
| dont `idle in transaction` | 0 | — | 0 |
| **En attente réelle (verrou / E-S)** | **0** | **0** | **0** |
| Requête active la plus longue | 0 s | 0 s | 0 s |

**Limite mémoire du conteneur : 24,0 Go** (lue dans le cgroup). Le pic de 344 Mo en représente **1,4 %** —
c'est cette échelle qui rend le chiffre interprétable, et c'est pourquoi la limite est lue plutôt que supposée.

CPU du run : **4,36 s utilisateur + 0,55 s système** pour 28,1 s de processus.
**Redémarrage : aucun** — `processCoveredWindow: true`, le processus qui écrit le rapport est celui qui a
commencé. **OOM : `null`, pas `false`** — un processus tué par l'OOM killer ne peut pas rapporter sa propre
mort ; l'absence d'OOM se lit sur un run qui se termine, pas sur une case cochée par le mourant.

> **Deux pièges corrigés dans la MESURE, pas dans le système.** La première lecture annonçait **13 connexions
> « en attente » sur 14** et une requête d'âge **négatif**. Les deux venaient de la requête : `Client/ClientRead`
> est un pool au repos qui attend que le *client* parle — pas une contention — et la sonde était elle-même la
> session active la plus récente, son `query_start` tombant après le `now()` de la même instruction. Filtrées
> (`state = 'active'`, hors `Client`/`Timeout`/`Activity`, `pid <> pg_backend_pid()`), les valeurs justes sont
> **0 en attente** et **0 s**. Publier « 13 en attente » aurait déclenché une chasse à un problème inexistant.

## Rollback — démontré, pas affirmé

Le dump d'avant la mutation du cycle 2, restauré dans un clone neuf : **79 036 offres actives** (production
après mutation : 79 033). Les trois offres fermées y figurent `isActive=t, closedAt=null`, contre `false` /
`2026-09-12T20:32:49` en production. L'état antérieur est récupérable, par identifiant.

## Chaîne publique

| Contrôle | Résultat |
|---|---|
| Offres fermées | **410** + `x-robots-tag: noindex` + **aucun JobPosting** + bandeau « Expirée » |
| Offres conservées par une autre source | **200**, vivantes, URL canonique re-pointée vers l'attestation active (`welcometothejungle.com`) |
| Offres vivantes | 200 + JobPosting, redirection vers le slug canonique |
| API publique | **0 offre fermée** ; les 3 conservées présentes (41 offres sur 2 pages) |
| Facette source | `american-vintage-dr` **31** = exactement les 31 observées (37 avant) |
| Compteurs | 79 033 actives, cohérents base ↔ API |
| Invariants | 0 offre active avec `closedAt` · 0 offre orpheline · 0 retenue perdue · 0 `closedAt`+`withdrawnAt` |
| Sources de catégorie B | **0 fermeture**, 2 014 représentations intactes |

### Réconciliation du sitemap — par identifiant, toutes tranches lues

`public-chain-reconcile.mts`, lecture seule, sur les **19 identifiants de P7** (16 fermés + 3 conservés).
**17 tranches de sitemap, 80 700 URL, aucune illisible** — lire une seule tranche aurait rendu « absent du
sitemap » indistinguable de « absent de la tranche regardée ». L'API est paginée jusqu'au bout, pour la même
raison : s'arrêter à la première page inventerait des absences (41 offres American Vintage sur 2 pages de 25).

| Catégorie | n | Base | API | Sitemap | Fiche | JobPosting | Statut |
|---|--:|---|---|---|--:|---|---|
| Fermées pendant P7 | 16 | FERMÉE | absente | **absente** | **410** | absent | **CONFORME** |
| Conservées par une autre source | 3 | ACTIVE | présente | **présente** | **200** | présent (2/3) | **CONFORME** |

**19/19 conformes · 0 écart.** Aucune URL d'offre fermée ne reste publiée comme offre active ; aucune offre
active attendue n'est absente. Le seul actif sans `JobPosting` est le cas H-GEO-01 ci-dessous — un pays sans
preuve indépendante, correctement non compté comme défaut de fermeture.

## État final des neuf sources

> **Correction de terminologie.** Une version antérieure de ce tableau portait « C1 = exclu » pour American
> Vintage. C'était faux, et de la pire façon : cela laissait croire qu'elle n'avait pas participé au cycle 1.
> Elle y a **ingéré, satisfait ses deux contrats et produit sa preuve** ; seul son **refresh** a été retenu,
> par décision du propriétaire, en attendant l'intersection du cycle 2. Ingestion, preuve et refresh sont donc
> désormais trois colonnes distinctes par cycle — les confondre revenait à confondre *collecter* et *muter*.

| Source | Ingestion C1 | Preuve C1 | Refresh C1 | Ingestion C2 | Preuve C2 | Refresh C2 | Contrat adapt. | Contrat persist. | Complete | CanAttest | Ajouts | Absences | Fermetures | Conservées | Décision | Motif | Condition future |
|---|:-:|:-:|---|:-:|:-:|---|:-:|:-:|:-:|:-:|--:|--:|--:|--:|---|---|---|
| `mecca` | ✓ | ✓ | 12 désactivations, 12 fermetures | ✓ | ✓ | 0 (rien à fermer) | ✓ | ✓ | ✓ | ✓ | 0 | 12 | 12 | 0 | **VALIDÉE P7** | deux cycles complets ; 12/12 absentes de l'API Workday, 2 témoins rendus | — |
| `ganni-talentrecruiter` | ✓ | ✓ | 1 désactivation, 1 fermeture | ✓ | ✓ | 0 — 2 retenues par la garde de fraîcheur | ✓ | ✓ | ✓ | ✓ | 0 | 3 | 1 | 0 | **VALIDÉE P7** | deux cycles complets ; 3/3 absentes du flux `positionlist`, 2 témoins présents | 2 fermetures `ABSENCE_PROUVÉE_FERMETURE_RETENUE_PAR_LA_GARDE` (revues à 10,9 h, seuil 48 h) — au prochain cycle |
| `american-vintage-dr` | ✓ | ✓ | **retenu par décision propriétaire** (attente de l'intersection C2) | ✓ | ✓ | 6 représentations : 3 fermetures, 3 Jobs conservés | ✓ | ✓ | ✓ | ✓ | 0 | 6 | 3 | 3 | **VALIDÉE P7** | exception propriétaire appliquée après confirmation sur deux cycles et re-confirmation chez le publieur | — |
| `dr-pierre-ricaud` | — | — | exclu | — | — | exclu | ✗ | n/a | ✓ | ✗ | 0 | n/d | 0 | 0 | **COLLECTE VALIDÉE, REFRESH EXCLU** | SuccessFactors n'émet pas `canonicalIds` | émettre `canonicalIds`, puis deux cycles |
| `lagardere-travel-retail` | — | — | exclu | — | — | exclu | ✗ | n/a | ✓ | ✗ | 0 | n/d | 0 | 0 | **COLLECTE VALIDÉE, REFRESH EXCLU** | Talentsoft idem | idem |
| `urbn-hub` | — | — | exclu | — | — | exclu | ✗ | n/a | ✓ | ✗ | 0 | n/d | 0 | 0 | **COLLECTE VALIDÉE, REFRESH EXCLU** | iCIMS idem | idem |
| `beiersdorf` | — | — | exclu | — | — | exclu | ✗ | n/a | ✓ | ✗ | 0 | n/d | 0 | 0 | **COLLECTE VALIDÉE, REFRESH EXCLU** | generic-listing idem | idem |
| `lindex-easycruit` | — | — | exclu | — | — | exclu | ✗ | n/a | ✓ | ✗ | 0 | n/d | 0 | 0 | **COLLECTE VALIDÉE, REFRESH EXCLU** | EasyCruit idem | idem |
| `saltrock-harri` | — | — | exclu | — | — | exclu | ✗ | n/a | ✓ | ✗ | 0 | n/d | 0 | 0 | **COLLECTE VALIDÉE, REFRESH EXCLU** | Harri idem | idem |

Aucune source « à voir ».

### Concordance des totaux avec les paragraphes et les fichiers de preuve

Vérifiée ligne à ligne, parce qu'un tableau qui ne recoupe pas son propre texte fait douter des deux :

| Grandeur | Tableau | Paragraphes | Fichier de preuve |
|---|--:|--:|---|
| Offres collectées, chaque cycle | 181 + 15 + 31 = **227** | 227 | `record.json` des deux runs |
| Absences de l'intersection | 6 + 2 = **8** | 8 | `p7-cycle2/intersection.json` |
| Fermetures totales P7 | 12 + 1 + 3 = **16** | 13 (C1) + 3 (C2) = 16 | `refresh-audit` des deux cycles |
| Offres conservées par une autre source | **3** | 3 | manifeste C2 (`kept: 3`) |
| Manifeste C2 : fermetures *planifiées* | **5** | 3 *réalisées* | `manifest.json` C2 |
| Offres actives | 79 049 − 16 = **79 033** | 79 033 | `production-counts.mts` |
| Identifiants réconciliés | 16 + 3 = **19** | 19/19 conformes | `public-chain-reconcile` |

**L'écart 5 planifiées / 3 réalisées au cycle 2 n'est pas une incohérence, c'est la garde de fraîcheur.** Le
manifeste est un plafond : il autorise 5 fermetures, `runRefresh` en réalise 3 et laisse les 2 lignes GANNI
revues il y a 10,9 h. Un tableau qui n'afficherait que « 3 » masquerait le fait qu'un plan plus large a été
revu et volontairement non exécuté en totalité.

Les 21 absences du cycle 1 se répartissent en 18 candidates à fermeture et 3 conservées ; 15 seulement sont
entrées au manifeste (les sources recevables du refresh C1), et 13 ont été mutées — les 2 autres retenues par
la même garde. Aucun de ces nombres ne se déduit d'un autre : ils sont mesurés séparément, et les rapprocher
est précisément ce qui permet de voir qu'ils se tiennent.

## Défauts trouvés et corrigés pendant P7

Chacun aurait produit une affirmation fausse d'apparence crédible.

| # | Défaut | Ce qu'il aurait coûté | Preuve du correctif |
|--:|---|---|---|
| 1 | Préflight sans contrôle d'espace disque, clones jamais rendus | dump **tronqué**, `pg_restore` cassé ; 146 Mo restants | refus à 0,15 et 7,9 Gio, accepté à 8 et 40 ; contre-exemple vérifié |
| 2 | Garde d'`execute` exigeant `INGEST_ONLY_KEYS` | **refusait tout refresh conforme** — inatteignable par construction | 6 contre-exemples ; garde remise dans son état d'origine → 2 échecs |
| 3 | `refresh-audit` filtrant sur `updatedAt` (colonne inexistante) | l'audit mourait **après** la mutation : mutation non vérifiée | audit rejoué en production, `problems: []` |
| 4 | Audit traitant le manifeste comme un **plancher** | aurait exigé du refresh d'ignorer sa garde de fraîcheur | 13 périmées fermées / 2 fraîches intactes, séparation nette |
| 5 | `absent-ids` lisant `pageEvidence` sur `SourceRun` | plantage ; le champ vit sur `PipelineEvent` | 21 absences nommées et vérifiées |
| 6 | `cycle-resources` interrogeant `source.started` (inexistant) | durées et débits `null` **en silence** | durées par source mesurées + `measurementWarning` |
| 7 | Deux tests sous `src/pipeline/`, exclu de `test:unit` | tests sans base gardés derrière la suite Docker | unitaires 1 839 → **1 852** |
| 8 | Garde des 5 % **affichée mais lue par personne** | on croyait protégé ce qui ne l'était pas | 7 scénarios sur clone, dont le contre-exemple |
| 9 | `wait_event_type IS NOT NULL` comptait le pool au repos | **« 13 connexions en attente sur 14 »** — une chasse à un problème inexistant | filtré : **0 en attente** |
| 10 | La sonde se mesurait elle-même | âge de requête **négatif** (−0,0008 s) | `pid <> pg_backend_pid()` → **0 s** |

## Reste ouvert — hors périmètre P7, signalé

- **72 395 offres actives sur 79 033** portent un pays **sans preuve indépendante** (`countryIntegrity` nul) et
  n'émettent donc pas de balisage `JobPosting` (`AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF`). C'est H-GEO-01
  qui fonctionne — il refuse de publier une affirmation qu'il ne peut pas prouver — et non un défaut introduit
  ici : l'offre témoin date du 2026-09-02. `countryIntegrity` se remplit à la ré-attestation.
- Les **six sources de catégorie B** attendent que leur adaptateur émette `canonicalIds`.
- Les **2 fermetures GANNI** retenues par la garde de fraîcheur, à reprendre au prochain cycle.

## Variables et crons à la clôture

`INGEST_ONLY_KEYS` **null** · `REFRESH_ONLY_KEYS` **null** · `PIPELINE_PAUSED=1` · commande normale restaurée ·
les **trois** crons gelés sur `0 0 29 2 *`. Aucun cron réactivé.

Trois gardes ont refusé pendant l'addendum, et chacune avait raison : arbre Git non propre (un outil non
encore versionné), HEAD ≠ commit déployé, déploiement encore `BUILDING`. Aucune n'a été contournée ; la cause
a été corrigée à chaque fois, puis l'étape rejouée.
