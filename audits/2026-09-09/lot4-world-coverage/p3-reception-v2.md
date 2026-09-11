# P3 — réception sur le VRAI processus d'intégration (2026-09-11)

La première tentative testait `replay-integration.mts`, un outil parallèle : il sélectionnait des offres déjà présentes, reconstruisait des champs depuis sa propre table `PATHS` et écrivait par `p.job.update`. Il ne démontrait qu'une **réparation de champs**. Cette réception-ci exerce le **processus d'intégration lui-même**.

## Le point d'entrée exécuté

`ingestAllBySource` — **la fonction de production**, importée depuis `src/pipeline/ingestOrchestrator.ts`, appelée telle quelle.

**Une seule chose est remplacée : le transport HTTP.** `apps/aggregator/scripts/ops/offline-transport.ts` intercepte `globalThis.fetch` et rejoue des réponses enregistrées. La couture est placée **sous les adaptateurs**, donc tout ce qui est au-dessus s'exécute réellement :

| Couche | Exercée ? |
|---|---|
| Adaptateur ATS de la famille (`ADAPTERS[KIND_TO_ATS[kind]]`, table de dispatch de production) | **oui** |
| Normaliseurs (`cleanTitle`, `cleanPlace`, `plausiblePostedAt`, `htmlToPlainText`) | **oui** |
| Porte d'identité, règles de périmètre, déduplication, écriture | **oui**, via `ingestAllBySource` |
| Transport réseau | **remplacé** par des cassettes |

Une requête non enregistrée **échoue bruyamment** (`UnrecordedRequest`) : renvoyer un corps vide fabriquerait une source sans offres.

**Aucune règle de transformation n'est réimplémentée.** Il n'y a plus de table `PATHS`.

## Les cinq scénarios

| Critère | Point d'entrée exécuté | Fonctions du pipeline exercées | Preuve obtenue | Conforme |
|---|---|---|---|---|
| **Parcours nominal** | `ingestAllBySource`, clés `nikin,damart` | adaptateurs Recruitee + Teamtailor, normaliseurs, identité, dédup, écriture | `run: {total 2, ok 2, failed 0}` ; **7 offres** datées et décrites ; **1 offre Damart créée** (3 → 4) | **oui** |
| **Interruption et reprise** | même point d'entrée, `--crash-after=3` | idem, interrompu en plein vol | « SIMULATED CRASH after 3 committed transactions » ; état partiel mesuré (**Damart 2/3 lues**, runs `DEGRADED`) ; reprise → **4 + 3 offres, 0 échec** | **oui** |
| **Changement de configuration** | `Source.config` de `lexington` modifiée (`maxPages`), puis `assertIdentityReview` | le contrôle d'identité du pipeline, lié à la config par `sourceIdentityHash` | verdict **`CERTIFIED` → `INVALID`**, empreinte changée | **oui** |
| **Correction d'un validateur** | `assertIdentityReview` réévalué sur les 433 sources ACTIVE et leurs revues archivées | le validateur **partagé** avec certify/promote | **89 certifiées, 1 périmée (`lexington`)** — exactement celle dont la config a changé ; aucune certification périmée acceptée | **oui** |
| **Absence de double écriture** | 2ᵉ passage de `ingestAllBySource` | idem | identifiants **7 = 7, identiques** ; **0 champ modifié** ; **0 offre créée en double** | **oui** |

Comparaisons faites par **identifiants, champs et valeurs**, jamais par compteur.

## Ce que la correction de trajectoire a montré

Deux tentatives d'interruption ont été nécessaires. La première accrochait `job.update` et **n'a jamais déclenché** : l'ingestion persiste par `$transaction`. Le harnais tue donc le processus après N transactions **commises** — ce qui produit un état réellement partiel, visible dans `SourceRun` (`fetched: 2` pour 3 offres).

C'est la différence avec le scénario précédent, où un autre script préparait un état partiel sans jamais interrompre le programme à réceptionner.

## Dossiers utilisés

| Source | Famille ATS | Offres | Cassette |
|---|---|---:|---|
| `nikin` | recruitee | 3 | 1 réponse enregistrée |
| `damart` | teamtailor | 3 → 4 | 1 réponse enregistrée |
| `lexington` | teamtailor (certifiée) | 2 | changement de configuration |

Enregistrement en ligne **une fois**, hors de toute écriture en base. Tous les rejeux sont hors ligne, sur clone.

## Limites, déclarées

- **Aucune écriture de production**, par choix : la production n'est pas le terrain de validation d'un processus.
- Les cassettes couvrent **les requêtes que ces sources émettent** ; une source dont le flux change devra être ré-enregistrée. Une requête inconnue échoue plutôt que de renvoyer du vide.
- La certification `lexington` a été invalidée **sur le clone** ; la production n'est pas touchée.

## Statut

Les cinq critères sont exercés sur le processus d'intégration réel, avec de vraies écritures sur clone.
