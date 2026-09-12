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

`d3e5a966` — tout le code des deux cycles est sur `main` et déployé. Aucune branche P7 restante, aucune PR P7
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

> **Constat de méthode** : le ratio de 5 % est *calculé et affiché* par la prévisualisation mais **lu par
> aucun code** — c'est un indicateur, pas une barrière. La vraie barrière est le **manifeste figé**, qui refuse
> une source non recevable, tout état autre que `ABSENT_FROM_PROVEN_ENUMERATION`, et toute ligne déjà inactive.
> L'exception n'a donc contourné aucune garde : elle a emprunté le chemin normal.

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

Mémoire et connexions Postgres : **non mesurées**, et déclarées telles. Le pipeline ne les enregistre pas, et
les lire depuis ce poste décrirait cet hôte, pas le conteneur du run (leçon D32). Rien n'a été comblé par du
plausible.

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

## État final des neuf sources

| Source | C1 | C2 | Contrat adapt. | Contrat persist. | Complete | CanAttest | Refresh C1 | Refresh C2 | Ajouts | Absences | Fermetures | Conservées | Décision | Motif | Condition future |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|--:|--:|--:|--:|---|---|---|
| `mecca` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12 | 0 | 0 | 12 | 12 | 0 | **VALIDÉE P7** | deux cycles complets, 12/12 vérifiées à l'API Workday | — |
| `ganni-talentrecruiter` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 1 | 0 | 0 | 3 | 1 | 0 | **VALIDÉE P7** | deux cycles complets, 3/3 absentes du flux officiel | 2 fermetures retenues par la garde de fraîcheur (48 h) — se feront au prochain cycle |
| `american-vintage-dr` | exclu | ✓ | ✓ | ✓ | ✓ | ✓ | 0 | 6 | 0 | 6 | 3 | 3 | **VALIDÉE P7** | exception propriétaire appliquée après confirmation sur deux cycles | — |
| `dr-pierre-ricaud` | — | — | ✗ | n/a | ✓ | ✗ | — | — | 0 | n/d | 0 | 0 | **COLLECTE VALIDÉE, REFRESH EXCLU** | SuccessFactors n'émet pas `canonicalIds` | émettre `canonicalIds`, puis deux cycles |
| `lagardere-travel-retail` | — | — | ✗ | n/a | ✓ | ✗ | — | — | 0 | n/d | 0 | 0 | **COLLECTE VALIDÉE, REFRESH EXCLU** | Talentsoft idem | idem |
| `urbn-hub` | — | — | ✗ | n/a | ✓ | ✗ | — | — | 0 | n/d | 0 | 0 | **COLLECTE VALIDÉE, REFRESH EXCLU** | iCIMS idem | idem |
| `beiersdorf` | — | — | ✗ | n/a | ✓ | ✗ | — | — | 0 | n/d | 0 | 0 | **COLLECTE VALIDÉE, REFRESH EXCLU** | generic-listing idem | idem |
| `lindex-easycruit` | — | — | ✗ | n/a | ✓ | ✗ | — | — | 0 | n/d | 0 | 0 | **COLLECTE VALIDÉE, REFRESH EXCLU** | EasyCruit idem | idem |
| `saltrock-harri` | — | — | ✗ | n/a | ✓ | ✗ | — | — | 0 | n/d | 0 | 0 | **COLLECTE VALIDÉE, REFRESH EXCLU** | Harri idem | idem |

Aucune source « à voir ».

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
