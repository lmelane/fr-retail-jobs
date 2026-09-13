# P8 · addendum — la rétention des observations, implémentée et validée

> Décision propriétaire du 2026-09-13. Politique appliquée dans le dépôt maintenu, validée sur le clone
> `catwalks_lot4_replay_20260909d`. Aucune mutation de production.

## La politique arbitrée

| | |
|---|---|
| Conservation chaude en PostgreSQL | **14 jours**, complète |
| Archivage au-delà | stockage objet durable, **compressé** (gzip niveau 9) |
| Conservation des archives | **12 mois** |
| Partitionnement | **date × runId × sourceKey** |
| Manifeste | **immuable** : lignes, période, taille, sha256, version de format |

Métadonnées conservées **durablement en base**, jamais purgées (`ObservationArchiveRef`) : `runId`,
`sourceKey`, `externalId`, `observedAt`, `contentHash`, `disposition`, référence d'ensemble canonique, URI
d'archive, sha256 d'archive.

**Pourquoi elles ne sont pas un journal d'exploitation** : une observation est la preuve qu'une offre a été
vue à un instant donné — c'est elle qui permet de conclure à une absence par ensemble d'identifiants (P7).
Sans ces pointeurs, une purge rendrait une preuve de P1 à P7 irrécupérable **en silence** : rien en base ne
dirait qu'elle a manqué.

## La déduplication du RAW existait déjà — et elle ne sert presque à rien

La contrainte unique `(sourceKey, externalId, contentHash)` garantit **par construction** qu'un payload
identique n'est stocké qu'une fois : une observation ultérieure au contenu inchangé ne crée pas de ligne.

**Mesuré en production : 130 809 lignes pour 130 654 contenus distincts, soit 0,12 % de déduplication.**

*Le contenu des offres change réellement d'un passage à l'autre* (dates, compteurs, formulations). La
déduplication n'est donc **pas** le levier d'économie — il fallait le mesurer pour ne pas construire dessus.
Le levier est la rétention.

## La purge FAIL-CLOSED, et sa preuve

Sept étapes, chacune un verrou :

```
1. créer l'archive · 2. compter · 3. sha256 · 4. vérifier le manifeste
5. RESTAURER un échantillon · 6. enregistrer les pointeurs · 7. supprimer, alors seulement
```

La **politique** (`src/retention/observationArchive.ts`) décide et n'écrit rien ; le **programme**
(`scripts/ops/retention-observations.mts`) exécute et ne supprime que si la politique l'autorise. Séparer les
deux permet de tester la décision sans risquer une donnée, et empêche qu'un chemin d'appel réimplémente une
étape en l'oubliant.

### Six contre-exemples, tous fermés

| Défaut injecté | Étape qui refuse |
|---|---|
| archive absente | `CREATE_ARCHIVE` |
| sha256 divergent | `VERIFY_MANIFEST` |
| manifeste annonçant moins de lignes | `VERIFY_MANIFEST` |
| restauration vide | `RESTORE_SAMPLE` |
| restauration rendant d'autres identifiants | `RESTORE_SAMPLE` |
| pointeurs non enregistrés | `RECORD_POINTERS` |

**Aucune suppression autorisée dans les six cas.** Un « fail-closed » ne se déclare pas : on montre qu'il
ferme, un verrou à la fois.

## La validation sur périmètre borné

| Étape | Résultat |
|---|---|
| État avant | 107 735 observations · 0 ref · 0 manifeste |
| **Dry-run** | 3 éligibles, 1 partition, autorisée, **0 supprimée** |
| Dry-run **inerte** | 107 735 inchangé, 0 ref, 0 manifeste, **aucun fichier écrit** |
| Archive | `source-observations/2026-09-06/unknown-run/sandro.jsonl.gz`, 1 488 o |
| sha256 | `482952ca517b…` — **recalculé depuis le disque, concorde** |
| Taille du manifeste | **concorde** avec les octets réels |
| **Restauration complète** | 3/3 lignes, **identifiants identiques** aux pointeurs |
| RAW restauré | **intact** · `contentHash` intact |
| Purge | 107 735 → **107 732** |
| Lignes chaudes restantes du lot | **0** |
| **2e passage (idempotence)** | 0 éligible, **0 supprimée**, 107 732 inchangé |
| Aucune ligne récente supprimée | plus ancienne restante = 2026-09-07, **après la coupure** |
| Aucune observation sans archive vérifiée | `verifiedAt` renseigné, disposition `ARCHIVED_AND_PURGED` |

*La coupure a été forcée (`--now=2026-09-21`) parce qu'aucune ligne n'a encore 14 jours : la table n'existe
que depuis le 2026-09-06. Valider en attendant sept jours n'aurait rien prouvé de plus.*

## Les mesures demandées

| Grandeur | Valeur mesurée |
|---|--:|
| Octets par observation | **4 635 o** |
| **Octets par 1 000 observations** | **4,63 Mo** |
| **Taux de déduplication des RAW** | **0,12 %** |
| Ratio de compression de l'archive | **9,3 ×** |
| Observations par jour (régime actuel, crons gelés) | 18 518 |

### Projection en régime cible (une passe quotidienne complète)

| | |
|---|--:|
| Observations chaudes à 14 jours | 86 429 × 14 = **1 210 006** |
| **Taille chaude maximale projetée** | **~5,61 Go** |
| **Taille mensuelle des archives** | **~1,29 Go** |
| 12 mois d'archives | ~15,4 Go |

**Avant / après la politique :**

| | Croissance |
|---|---|
| Sans rétention | **illimitée** — ~12 Go/mois en base, sans plafond |
| Avec rétention | base **plafonnée à ~5,6 Go** + ~1,3 Go/mois d'archives froides |

*Coût en unités monétaires : non disponible — aucun tarif de stockage objet n'est configuré sur ce projet. Le
volume est donné, la conversion appartient au contrat d'hébergement.*

## Ce qui reste à faire avant la reprise des crons

Le stockage objet **n'est pas provisionné** : la validation a écrit sur système de fichiers local, ce qui
exerce la totalité de la chaîne (compression, sha256, manifeste, restauration, purge) mais pas la durabilité
distante. Brancher un bucket est un changement de destination d'écriture, pas de logique — le chemin d'archive
est déjà hiérarchique et listable par date.

**La politique est implémentée, testée et prouvée fail-closed. Son exécution périodique en production reste
subordonnée à la reprise des crons, qui est une décision du propriétaire (D57).**
