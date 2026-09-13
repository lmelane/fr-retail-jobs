# P8 · T0 — sanité de l'instrument, et ce qu'il montre déjà

> Deux passes identiques, 2026-09-13, commit `57d1654d`, crons gelés.
> Runs `7d6c8997` (passe 1) et `10e70256` (passe 2).

## Ce que T0 devait prouver

T0 ne mesure pas la capacité : il mesure **l'instrument**. Trois questions, trois réponses.

| Question | Réponse |
|---|---|
| Les métriques sont-elles réellement collectées ? | **Oui** — HTTP par hôte, ressources, durées par source, écritures |
| La mesure est-elle reproductible ? | **Oui sur les volumes, ±13 % sur le temps** (voir ci-dessous) |
| Le second passage modifie-t-il des données ? | **Non** — 0 création, 227 ré-attestations, aux deux passes |

## Les deux passes

| | Passe 1 | Passe 2 | Écart |
|---|--:|--:|--:|
| Mur | 29,4 s | 33,3 s | **+13,2 %** |
| Offres collectées | 227 | 227 | 0 |
| **Requêtes HTTP** | **239** | **239** | **0** |
| Créées / ré-attestées | 0 / 227 | 0 / 227 | 0 |
| Débit | 7,71 /s | 6,81 /s | −11,7 % |
| CPU total | 4,86 s | 7,78 s | **+60 %** |
| RSS pic | 347 Mo | 339 Mo | −2 % |
| Connexions DB pic | 14 | 14 | 0 |
| **Attente DB réelle** | **0** | **0** | 0 |
| Requête la plus longue | 0 s | 0 s | 0 |

### La variance est réelle, et elle borne ce qu'on a le droit d'annoncer

Le travail est **rigoureusement identique** (239 requêtes, 227 offres, 0 écriture) mais le mur bouge de 13 % et
le CPU de 60 %. Les trois sources ralentissent **proportionnellement** — ce n'est donc pas une source, c'est
l'environnement : Railway est mutualisé, et le conteneur ne dispose pas d'un CPU dédié.

**Conséquence méthodologique, pas anecdote** : toute capacité mesurée ici s'annonce avec une incertitude d'au
moins **±13 %**. Annoncer « 7,71 offres/s » comme une constante serait une précision fausse.

## Ce que l'instrument révèle déjà

### Cinq hôtes, pas trois

| Hôte | Requêtes | p50 | p95 | max | Retries | Timeouts | Statuts |
|---|--:|--:|--:|--:|--:|--:|---|
| `mecca.wd3.myworkdayjobs.com` | 191 | 336 ms | 563 ms | 1 085 ms | 0 | 0 | 200 × 191 |
| `careers.am-vintage.com` | 31 | 183 ms | 253 ms | 332 ms | 0 | 0 | 200 × 31 |
| `candidate.hr-manager.net` | 15 | 456 ms | 575 ms | 575 ms | 0 | 0 | 200 × 15 |
| `api.digitalrecruiters.com` | 1 | 246 ms | — | 246 ms | 0 | 0 | 200 × 1 |
| `recruiter-api.hr-manager.net` | 1 | 232 ms | — | 232 ms | 0 | 0 | 200 × 1 |

**Trois sources, cinq hôtes.** DigitalRecruiters et TalentRecruiter interrogent un hôte d'API pour le listing
et un autre pour les détails. Une vue par SOURCE l'aurait manqué — et la porte de politesse agit par HÔTE.
C'est exactement ce qu'une mesure agrégée cache.

### Ce qui n'est PAS le goulot — écarté par la mesure, pas par intuition

| Candidat | Mesure | Verdict |
|---|---|---|
| Mémoire | pic 347 Mo / **24 Go** de limite cgroup = **1,4 %** | écarté |
| Connexions DB | 14 au pic, **0 en attente réelle** | écarté |
| Requêtes lentes | **0 s** de requête active la plus longue | écarté |
| Retries / timeouts | **0** et **0**, uniquement des 200 | écarté |
| CPU | 4,86 s pour 29,4 s = **16,5 %** d'utilisation | écarté |

Le pipeline **attend** 83 % du temps. Le goulot est du côté réseau — reste à savoir lequel.

### Une erreur d'analyse, et ce qu'elle a appris

Premier modèle : « temps HTTP = p50 × requêtes ». Sur MECCA il donnait **64,2 s pour une source qui dure
29,3 s**, soit **219 %** — impossible.

Ce chiffre absurde EST le résultat : les détails Workday tournent **déjà en parallèle** (~2,2×). Le modèle
séquentiel était faux. Sans cette vérification arithmétique, j'aurais « diagnostiqué Workday comme
séquentiel » — l'intuition exacte que P8 interdit de graver sans mesure.

### L'hypothèse de l'écart par hôte, testée et NON concluante

La porte par hôte autorise 4 requêtes simultanées **avec un écart minimum de 80 ms entre départs** — ce qui
sérialise les départs à 12,5/s quelle que soit la concurrence.

| Hôte | Requêtes | Durée | Plancher (req × 80 ms) | Durée / plancher |
|---|--:|--:|--:|--:|
| `mecca.wd3` | 191 | 29,28 s | 15,28 s | **1,92** |
| `careers.am-vintage.com` | 31 | 4,30 s | 2,48 s | **1,73** |
| `candidate.hr-manager.net` | 15 | 3,28 s | 1,20 s | **2,74** |

Si l'écart était la seule borne, ce rapport vaudrait 1. Il vaut 1,7 à 2,7 : **l'écart contribue mais ne suffit
pas à expliquer**. Aucun goulot n'est donc nommé à ce stade — il faut un chronométrage PAR PHASE pour séparer
l'attente réseau du travail de pipeline.

## Verdict T0

L'instrument est **sain, reproductible et non destructif**. Il a déjà écarté quatre candidats au titre de
goulot (mémoire, connexions, requêtes lentes, CPU) et corrigé une erreur d'analyse. La cause exacte côté
réseau reste **ouverte**, et le sera jusqu'à T1.
