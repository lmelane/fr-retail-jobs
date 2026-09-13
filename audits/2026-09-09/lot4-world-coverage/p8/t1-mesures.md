# P8 · T1 — les neuf familles ATS, deux passes

> 2026-09-13, commit `5339b73`, crons gelés. Runs `6068eb94` (passe 1) et `78b7cb78` (passe 2).

## Le résultat central : où passe le temps

| Phase | Passe 1 | Passe 2 |
|---|--:|--:|
| **Collecte (réseau)** | 482,4 s — **90,1 %** | 439,6 s — **86,9 %** |
| Écriture (normalisation, identité, dédup, upsert) | 52,1 s — 9,7 % | 65,1 s — 12,9 % |
| **Orchestration** | 1,18 s — **0,2 %** | 1,28 s — **0,2 %** |

**Orchestration à 0,2 % : une file distribuée est écartée par la mesure**, pas par opinion. Il n'y a
rien à y reprendre. C'est exactement la construction « qui paraît plus scalable » que P8 interdit de faire
sans preuve.

### Par famille, passe 1

| Famille | Source | Offres | Durée | Fetch | Upsert | Fetch % |
|---|---|--:|--:|--:|--:|--:|
| iCIMS | `urbn-hub` | 1 558 | **440,0 s** | 405,3 s | 34,7 s | 92,1 % |
| Workday | `mecca` | 181 | 25,0 s | 20,8 s | 4,0 s | 83,4 % |
| EasyCruit | `lindex-easycruit` | 50 | 19,5 s | 18,2 s | 1,2 s | **93,3 %** |
| generic-listing | `beiersdorf` | 168 | 18,0 s | 13,9 s | 4,1 s | 77,0 % |
| Talentsoft | `lagardere-travel-retail` | 130 | 12,5 s | 9,0 s | 3,3 s | 72,0 % |
| SuccessFactors | `dr-pierre-ricaud` | 72 | 8,5 s | 6,3 s | 2,0 s | 74,7 % |
| Harri | `saltrock-harri` | 36 | 5,0 s | 3,9 s | 1,0 s | 76,5 % |
| DigitalRecruiters | `american-vintage-dr` | 31 | 4,1 s | 2,8 s | 1,2 s | 68,7 % |
| TalentRecruiter | `ganni-talentrecruiter` | 17 | 3,1 s | 2,3 s | 0,7 s | 73,2 % |

**`urbn-hub` pèse 82 % du mur à lui seul.** Aucune famille ne descend sous 63 % de collecte : le constat est
une propriété du pipeline, pas un défaut d'un adaptateur.

## Hôtes CONFIGURÉS ≠ hôtes OBSERVÉS

**9 configurés → 19 observés.** L'écart n'est pas un détail de comptage : la porte de politesse agit sur
l'hôte SORTANT, pas sur celui du catalogue.

`urbn-hub`, une seule source configurée, éclate en **8 sous-domaines iCIMS** :

| Sous-domaine observé | Requêtes | p50 | Débit sur la fenêtre |
|---|--:|--:|--:|
| `stores-na-urbn.icims.com` | 924 | 544 ms | 2,10 req/s |
| `homeoffice-na-urbn.icims.com` | 178 | 541 ms | 0,40 req/s |
| `stores-eu-urbn.icims.com` | 138 | 556 ms | 0,31 req/s |
| `supplychain-na-urbn.icims.com` | 60 | 576 ms | 0,14 req/s |
| `menusandvenues-na-urbn.icims.com` | 39 | 553 ms | 0,09 req/s |
| `homeoffice-eu-urbn.icims.com` | 30 | 528 ms | 0,07 req/s |
| `hub-urbn.icims.com` | 28 | 613 ms | 0,06 req/s |
| `supplychain-eu-urbn.icims.com` | 1 | 572 ms | — |

**1 398 requêtes = 67 % du trafic total.** Ces 8 sous-domaines sont **un seul tenant iCIMS** mais **huit hôtes
distincts pour la porte** : elle leur accorde huit budgets de politesse séparés. À ce jour aucun 429 ne le
sanctionne, mais c'est un risque de sur-sollicitation d'un tenant unique, et il est nommé comme tel.

## Le goulot : trois hypothèses testées, deux écartées

| Hypothèse | Test | Verdict |
|---|---|---|
| L'écart de 80 ms par hôte | `stores-na` fait 2,10 req/s là où le plancher en permettrait 12,5 | **écartée** |
| Concurrence 4 × latence | tous les hôtes tournent à **21–56 %** de ce plafond | **écartée** |
| La latence elle-même | `careers.groupe-rocher.com` (98 ms) et `mecca` (295 ms) font le **même** 7–8 req/s | **écartée** |

La signature — un débit qui plafonne à 7–8 req/s **indépendamment de la latence** — situe la borne **en amont
du réseau**. Avec `INGEST_SOURCE_CONCURRENCY = 4`, seules quatre sources tournent à la fois : les neuf sources
attendent leur tour derrière `urbn-hub`, et la plupart des hôtes restent inactifs.

**Goulot retenu : la concurrence de SOURCES, pas la politesse par hôte ni la latence.**

## Ce qui n'est pas limitant à ce palier

| Grandeur | Passe 1 | Passe 2 | Marge |
|---|--:|--:|---|
| RSS pic | 577 Mo | 593 Mo | **2,5 %** de 24 Go |
| CPU | 37,5 s / 453 s = **8,3 %** | 43,9 s | large |
| Connexions DB | 16 (1 attente) | 15 (1 attente) | large |
| Requête la plus longue | 0,72 s | — | aucune requête lente |
| 429 · retries · timeouts | **0 · 0 · 0** | **0 · 0 · 0** | aucun portail sur-sollicité |

À revalider à chaque palier : ces verdicts valent **pour T1**, pas au-delà.

## Reproductibilité et idempotence

| | Passe 1 | Passe 2 |
|---|--:|--:|
| Mur | 452,7 s | 424,6 s (**−6,2 %**) |
| Offres · requêtes · hôtes | 1 978 · 2 077 · 19 | 1 978 · 2 077 · 19 |
| **Créations d'identité** | **12** *(offres réellement nouvelles)* | **0** |
| **Ré-attestations écrites** | 1 966 | **1 978** |
| Erreurs · write failures · retenues | 0 · 0 · 0 | 0 · 0 · 0 |

Le verdict d'idempotence est **quantifié, pas « zéro changement »** : la seconde passe ne crée aucune identité
et ré-atteste l'intégralité du corpus. Les 12 créations de la passe 1 sont de vraies offres nouvelles, pas un
artefact.

## Stockage et front

**Stockage** : base 3,198 → 3,218 Go, soit **+20,0 Mo pour 1 978 offres**.
`Job` +6,8 Mo · `SourceObservation` +6,1 Mo · `JobSource` +6,1 Mo · `PipelineEvent` **+0,09 Mo**.
Comptes : jobs +12, jobSources +12, observations **+1 478**, événements +50.
*Un delta de taille inclut autovacuum et statistiques : il majore ce que le run a écrit.*

**Front** : **6/6 conformes** avant (637 ms de médiane) comme après (658 ms). Aucune régression sous charge.
La sonde « pendant » n'a pas déclenché à temps sur cette passe — sa condition d'amorçage lisait un journal
tamponné ; elle est reprise sur T2.
