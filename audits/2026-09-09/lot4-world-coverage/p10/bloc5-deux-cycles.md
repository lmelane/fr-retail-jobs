# BLOC 5 — deux cycles complets, exécutés sur le code final

> 2026-09-14, commit déployé `0aee3875`. Périmètre **dérivé du registre** (`--mode=FULL_AUTOMATION`),
> canari de **12 sources · 8 familles ATS · 1 à 6 078 offres · 1 à 55 pays**.

## Le canari, et pourquoi il est représentatif

| Source | ATS | Offres | Pays |
|---|---|--:|--:|
| lvmh | lvmh_algolia | 6 078 | 55 |
| nordstrom | workday | 1 767 | 1 |
| hm-group | smartrecruiters-whitelabel | 1 706 | 54 |
| estee-lauder-companies | eightfold | 1 457 | 46 |
| deckers | workday | 435 | 14 |
| arcteryx | lever | 299 | 12 |
| beiersdorf | generic-listing | 168 | 36 |
| damiani | successfactors | 28 | 2 |
| dfs | successfactors | 4 | 1 |
| aim-n · lexington · motel | teamtailor | 4 · 2 · 1 | 1 |

*Plusieurs ATS, plusieurs tenants, les deux extrêmes de volume, une vraie couverture multi-pays — c'est la
définition de représentativité du brief, pas un échantillon commode.*

## Cycle 1 — 11 h 07 → 11 h 52 (12 min d'exécution)

| Source | Statut | complete | attest | Servies | Publiées | **Nouvelles** |
|---|---|---|---|--:|--:|--:|
| lvmh | OK | — | false | 5 872 | 6 433 | **355** |
| hm-group | OK | — | false | 1 769 | 2 407 | **701** |
| estee-lauder-companies | DEGRADED | false | false | 1 516 | 1 664 | **207** |
| nordstrom | DEGRADED | true | **true** | 1 341 | 1 767 | 0 |
| deckers | DEGRADED | true | **true** | 401 | 436 | 1 |
| arcteryx | OK | true | **true** | 299 | 303 | 4 |
| beiersdorf | OK | true | **true** | 130 | 169 | 1 |
| damiani | OK | true | **true** | 30 | 30 | 2 |
| dfs · lexington · aim-n | OK | true | **true** | 4 · 2 · 4 | 4 · 2 · 4 | 0 |
| **motel** | **BROKEN** | true | false | **0** | **1** | 0 |

**1 271 offres ajoutées · 0 FERMETURE.**

**Le cas `motel` est la démonstration la plus utile du lot** : la source a rendu **0 offre** là où elle en
avait 1. Son offre est **conservée**, pas fermée — `canAttestAbsence = false` a mordu. *Sans cette garde,
une source qui tombe emporterait son catalogue avec elle.*

## Cycle 2 — 11 h 07 → 11 h 18, mêmes paramètres

| | |
|---|--:|
| **Fermetures** | **0** |
| Nouvelles | **15** (nordstrom 2, hm-group 13) |
| Identifiants communs aux deux cycles | **13 275** |
| Identifiants disparus | **0** |

Les 15 nouvelles sont de **vraies parutions éditeur** entre les deux passages — le brief l'autorise
explicitement (« le second cycle peut comporter de vraies variations éditeur »).

## Les invariants durs — mesurés, pas supposés

| Invariant | Exigé | Mesuré |
|---|---|---|
| Doublons `JobSource` | 0 | **0** |
| Identifiant porté par deux `Job` | 0 | **0** |
| Offres actives sans source vivante | 0 | **0** |
| Offres actives portant un `closedAt` | 0 | **0** |
| Runs orphelins | 0 | **0** |
| Fermetures hors manifeste | 0 | **0** |
| Fermetures d'une source sans droit d'attester | 0 | **0** |
| **429** | absorbés | **0 sur 2 h** |
| Variables résiduelles | 0 | **0** (`INGEST_ONLY_KEYS` nulle ×3) |

Les **90 `job.write_failed`** sont **tous** des `EmployerIdentityReviewRequired` sur
`estee-lauder-companies` : la porte d'identité refuse de publier sous un employeur non vérifié.
**Aucun échec d'écriture réel.** *Les compter comme des pannes ferait chercher un défaut inexistant.*

## Quatre refus de garde pendant ces cycles, tous justes

| Refus | Ce qu'il a évité |
|---|---|
| `HEAD ≠ commit attendu` ×2 | exécuter un code différent de celui vérifié — **je créais moi-même la condition en committant pendant le run** |
| `arbre Git non propre` | un dossier d'**une autre session** dans le tree partagé |
| `déploiement BUILDING, attendu SUCCESS` | courir contre un déploiement en cours |

Le troisième a imposé la bonne réponse structurelle : un **worktree isolé**
(`/Users/lmelane/Downloads/catwalks-p10`, HEAD détaché sur le commit déployé). Deux sessions partagent ce
dépôt ; la règle du projet prescrit `git worktree add` précisément pour ça.

*Piège rencontré en le préparant : `node_modules/` et `backups/` dans `.gitignore` portent un **slash
final**, qui ne matche que des répertoires — un lien symbolique de ce nom ressort « non suivi » et rebloque
le préflight.*
