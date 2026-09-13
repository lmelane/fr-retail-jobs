# P8 — bilan final

> Lot exécuté le 2026-09-13. Crons gelés (`0 0 29 2 *`, `PIPELINE_PAUSED=1`) du début à la fin.
> **Cinq passages bornés** de production, aucun cron réactivé, aucune mutation hors protocole.

## L'objectif, et la réponse

P8 devait *déterminer et augmenter la capacité réellement soutenable du pipeline sur les sources existantes*,
sans dégrader la qualité, perdre d'identifiants, créer de doublons, surcharger les portails, saturer Railway
ou PostgreSQL, ralentir le site public, ni introduire une architecture disproportionnée.

**La réponse tient en une phrase : la capacité en temps, en mémoire et en politesse réseau est soutenable ; la
capacité en stockage ne l'est pas, faute de rétention.**

Et le levier qu'on attendait — augmenter la concurrence — **ne fonctionne pas** : la mesure montre que le
pipeline n'est pas limité par le nombre de sources traitées en parallèle, mais par ce que les tenants
acceptent de servir.

## Les cinq passages

| Passage | Sources | Offres | Mur | 429 | Verdict |
|---|--:|--:|--:|--:|---|
| T0 (validation de la chaîne) | 3 | — | — | 0 | `validForCapacity: true` |
| T1 corrigé, passe 1 | 9 | 1 976 | 580,8 s | 0 | `true` |
| T1 corrigé, passe 2 | 9 | 1 977 | 401,6 s | 0 | `true` |
| T2, passe 1 | 18 | 10 281 | 1 379,8 s | 82 | `false` — 4 refus d'identité |
| T2, passe 2 | 18 | 10 281 | 675,5 s | 39 | `false` — les 4 mêmes |
| A/B concurrence 6 | 18 | **8 625** | 441,6 s | 25 | `false` — arrêt 429 volontaire |

## Ce qui est PROUVÉ

| Fait | Preuve |
|---|---|
| Aucun portail maltraité | 121 × 429 sur quatre passages, **tous absorbés** ; 0 erreur finale, 0 timeout |
| Le seuil 429 est **par tenant** et reproductible | `deckers`, `fastretailing`, `mecca` à **0** sur toutes les passes ; `mango` à 35 |
| Aucune perte de données | 18/18 sources `complete`, 0 tronquée, 0 rejet, `fetched = accepted = declaredTotal` |
| Reproductibilité du corpus | **16/18** volumes identiques entre deux passes T2 |
| Idempotence | 1 seule création d'identité à la seconde passe T2 |
| Protection par tenant effective | 28 hôtes → 21 clés ; les 8 sous-domaines URBN sous une clé |
| Tenants Workday séparés à raison | `mango` 35 refus / `mecca` 0, même plateforme |
| Robustesse aux arrêts brutaux | 3 scénarios exercés, reprise **17/17 identifiants**, 0 orphelin, 0 doublon |
| File distribuée **écartée** | orchestration à 0,2 % du mur **et** reprise saine sur les 3 scénarios |
| Site public non dégradé | **6/6 conforme** sous charge, médiane 728 ms, 410 correct |
| Concurrence 4 est le bon palier | à 6, 1 656 offres non collectées |

## Ce qui est NON ÉTABLI, et assumé comme tel

| Question | Statut |
|---|---|
| Coût en temps de la protection par tenant | **non établi** — étendue de 44,6 % entre deux passes, hors de portée de deux mesures |
| Requête la plus longue (0,047 → 4,56 s) | **trop dispersée** pour conclure ; jamais associée à un échec |
| Débit des 415 sources non mesurées | extrapolé, jamais prétendu mesuré |

## Les erreurs commises pendant P8, et ce qu'elles ont produit

Elles sont listées parce qu'elles ont chacune produit un correctif durable.

| Erreur | Conséquence | Correctif |
|---|---|---|
| **La garde d'arrêt 429 n'était pas armée** sur trois passages (`export` local, run en conteneur) | T2 a encaissé 82 refus en étant annoncé protégé | le drapeau voyage dans la commande déployée ; `record.json` porte la posture |
| **« +28 % de coût » conclu après une seule passe** | conclusion fausse, réfutée par la passe 2 (401,6 s < 452,7 s) | la variance est mesurée avant de conclure |
| **« Signature de budget partagé »** tirée de `requestsPerSecond` | artefact : la grandeur dérive du mur | une grandeur dérivée du mur ne peut pas expliquer le mur |
| **Scénario B « impossible »** pendant deux tentatives | la cause était la SOURCE (Teamtailor n'a aucun pool de détails), pas l'injection | injection câblée dans le pool iCIMS réel, testée comme telle |
| **Faux négatif du crash** (code 0) | l'injection était sur la branche, le run sur `main` | une injection absente du tree exécuté est indiscernable d'une injection inerte |

## L'état de la production à la clôture

| | |
|---|---|
| Crons | **gelés** — `0 0 29 2 *` sur les trois services |
| `INGEST_ONLY_KEYS` · `REFRESH_ONLY_KEYS` | **null** |
| Variables `CRASH` / `STOP` | **aucune** |
| Commande de l'aggregator | `sh apps/aggregator/start.sh` (normale) |
| Dernier déploiement | SUCCESS |

## Ce que P8 remonte au propriétaire

**Une décision, une seule** : la politique de rétention de `SourceObservation`. Combien de jours d'observation
faut-il conserver pour que la preuve d'absence (P7) garde sa valeur ? En dessous de cette réponse, aucune
reprise de cron quotidien n'est soutenable au-delà de quelques semaines.

Ce n'est pas un réglage technique : c'est un arbitrage entre la force de la preuve et le coût du stockage.
P8 ne le prend pas.

**Ce que P8 ne demande pas** : la reprise des crons reste la décision du propriétaire (D57), et rien ici ne la
présume.
