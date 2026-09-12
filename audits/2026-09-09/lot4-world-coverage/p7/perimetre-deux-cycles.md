# P7 — le périmètre des deux cycles, figé avant le cycle 1

> Figé le 2026-09-12 sur le commit `feffe3ef`. Aucune source n'entre par défaut : chacune des neuf reçoit un
> état motivé, mesuré, avant que le cycle 1 ne commence. Ce document ne bouge plus une fois le cycle 1 lancé.

## La condition qui décide, et pourquoi elle décide

Une source ne peut entrer dans le **refresh** que si elle peut **prouver une absence**. Et une absence ne se
prouve que d'une façon : l'identifiant historique ne figure pas dans l'ensemble **réellement observé**, lu dans
`pageEvidence[].canonicalIds` et corrélé au run par `runId`.

Un adaptateur qui n'émet pas `canonicalIds` n'émet donc pas de preuve d'absence — quelle que soit la qualité de
sa collecte. Ce n'est pas une panne : c'est une capacité absente. Le distinguer d'un échec est tout l'objet de
la colonne « motif ».

> **Ce que l'on ne fait jamais** : déduire l'absence d'un `lastSeenAt` ancien. C'est une preuve de
> **non-ré-attestation**, pas de disparition — une offre peut n'avoir pas été ré-écrite tout en étant
> parfaitement présente dans le balayage.

## Mesure du 2026-09-12 — quel adaptateur émet le contrat canonique

Lu dans le code déployé, pas supposé :

| Famille ATS | `canonicalIds` émis | Sources candidates |
|---|:--:|---|
| **Workday** | ✅ | `mecca` |
| **TalentRecruiter** | ✅ | `ganni-talentrecruiter` |
| **DigitalRecruiters** | ✅ | `american-vintage-dr` |
| SuccessFactors | ❌ | `dr-pierre-ricaud` |
| Talentsoft | ❌ | `lagardere-travel-retail` |
| iCIMS | ❌ | `urbn-hub` |
| generic-listing | ❌ | `beiersdorf` |
| EasyCruit | ❌ | `lindex-easycruit` |
| Harri | ❌ | `saltrock-harri` |

Les six derniers émettent bien `pageEvidence` — mais **zéro** `canonicalIds` : une preuve d'énumération sans
vocabulaire canonique. Vérifié par `cycle-contracts.mts` : `obs=0`, « contrat canonique non déclaré par
l'adaptateur : rien à réconcilier ».

## L'état figé des neuf sources

| # | Source | Famille | État | Motif |
|--:|---|---|---|---|
| 1 | `mecca` | Workday | **A — incluse dans les deux cycles** | contrat canonique déclaré, persistance ✓ |
| 2 | `ganni-talentrecruiter` | TalentRecruiter | **A — incluse dans les deux cycles** | contrat canonique déclaré, persistance ✓ |
| 3 | `american-vintage-dr` | DigitalRecruiters | **A — incluse dans les deux cycles** | contrat canonique déclaré, persistance ✓ |
| 4 | `dr-pierre-ricaud` | SuccessFactors | **B — collecte autorisée, refresh exclu** | adaptateur sans `canonicalIds` : aucune absence démontrable |
| 5 | `lagardere-travel-retail` | Talentsoft | **B — collecte autorisée, refresh exclu** | idem |
| 6 | `urbn-hub` | iCIMS | **B — collecte autorisée, refresh exclu** | idem |
| 7 | `beiersdorf` | generic-listing | **B — collecte autorisée, refresh exclu** | idem |
| 8 | `lindex-easycruit` | EasyCruit | **B — collecte autorisée, refresh exclu** | idem |
| 9 | `saltrock-harri` | Harri | **B — collecte autorisée, refresh exclu** | idem |

**Sous-ensemble P7 des deux cycles : `mecca`, `ganni-talentrecruiter`, `american-vintage-dr`.**

Il satisfait l'exigence de représentativité : les **trois familles réellement prouvées** — Workday,
TalentRecruiter, DigitalRecruiters — chacune par une source distincte, sur trois ATS sans code commun.

## Pourquoi B et non C

Les six sources en B ne sont pas en échec : leur collecte fonctionne et leurs offres restent servies. Ce qui
leur manque est une **capacité d'adaptateur**, nommée et localisée. Les classer en C (« exclues avec motif
technique ») laisserait croire à un défaut de run ; B dit exactement ce qui est vrai — *on collecte, on ne
ferme pas*.

**Condition de reprise, identique pour les six** : émettre `canonicalIds` dans leur adaptateur, puis deux
cycles complets. Hors périmètre P7 : ce serait étendre le lot, ce que le mandat interdit.

## Ce que ce périmètre interdit

- aucune extension aux 50 sources du vivier P6 ;
- aucune source ajoutée après le lancement du cycle 1 ;
- aucun refresh sur une source de la catégorie B, même si sa collecte est parfaite ;
- les deux cycles portent sur **le même** sous-ensemble final — une source qui échouerait au cycle 1 sortirait
  du sous-ensemble validé plutôt que d'être remplacée.
