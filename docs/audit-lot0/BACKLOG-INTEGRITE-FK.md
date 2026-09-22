# Backlog intégrité — 8 clés étrangères violées par l'historique de production

**Priorité : P1 restaurabilité / intégrité historique.**
**Hors du chantier Catalogue consolidé.** Aucune correction n'est appliquée en production.

| | |
|---|---|
| découvert le | 2026-09-22, lors de la restauration du snapshot de répétition |
| snapshot | `pg_dump` 2026-09-22 06:45:02 → 06:49:20 UTC, 2 772 922 115 octets |
| commit | `be586ec` |
| PostgreSQL source / clone | 18.6 / 18.6 |
| mesuré depuis | production, lecture seule, rôle `catwalks_audit` |

## Ce que la restauration a révélé

`pg_restore` a rendu **16 erreurs** et la base restaurée portait **37 clés étrangères contre 45
en production**. Les données, elles, sont intégralement restaurées — toutes les tables comparées
au chiffre près. Ce sont les **contraintes** qui n'ont pas pu être recréées : PostgreSQL les
rejoue à la fin du restore et les valide alors contre les données, ce que la production ne fait
jamais sur l'existant.

**Ces 8 contraintes sont déclarées `VALID` en production alors que 754 lignes les violent.** Une
clé étrangère créée sur une table déjà peuplée n'est validée que si on le lui demande ; celles-ci
ne l'ont pas été, et PostgreSQL ne revérifie jamais après coup. L'incohérence est donc restée
invisible jusqu'à la première opération qui l'exerce — une restauration, une copie
d'environnement, une bascule.

## Les 8 contraintes, mesurées une par une

| Clé étrangère | Table enfant | Cible | Violations |
|---|---|---|---:|
| `CompanyAlias_reviewId_fkey` | `CompanyAlias` | `EmployerIdentityReview` | **239** |
| `SourceObservation_captureBatchId_fkey` | `SourceObservation` | `CaptureBatch` | **127** |
| `SourceObservation_captureOutputId_captureBatchId_fkey` | `SourceObservation` | `SourceExtraction` | **127** |
| `Company_identityReviewId_fkey` | `Company` | `EmployerIdentityReview` | **103** |
| `JobEvent_jobId_fkey` | `JobEvent` | `Job` | **65** |
| `OccupationObservation_jobId_fkey` | `OccupationObservation` | `Job` | **65** |
| `SourceIngestionCompletion_batchId_fkey` | `SourceIngestionCompletion` | `CaptureBatch` | **14** |
| `SourceIngestionCompletion_reportHash_fkey` | `SourceIngestionCompletion` | `RawBlob` | **14** |
| | | **TOTAL** | **754** |

Chaque compte applique la sémantique réelle de la contrainte (`MATCH SIMPLE` : une ligne dont une
colonne de la clé est nulle n'est pas contrainte), y compris pour la clé composite
`(captureOutputId, captureBatchId)`.

## Définitions en production

```sql
ALTER TABLE "CompanyAlias" ADD CONSTRAINT "CompanyAlias_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "EmployerIdentityReview"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "Company" ADD CONSTRAINT "Company_identityReviewId_fkey"
  FOREIGN KEY ("identityReviewId") REFERENCES "EmployerIdentityReview"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "OccupationObservation" ADD CONSTRAINT "OccupationObservation_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "SourceIngestionCompletion" ADD CONSTRAINT "SourceIngestionCompletion_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "CaptureBatch"(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "SourceIngestionCompletion" ADD CONSTRAINT "SourceIngestionCompletion_reportHash_fkey"
  FOREIGN KEY ("reportHash") REFERENCES "RawBlob"(hash) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "SourceObservation" ADD CONSTRAINT "SourceObservation_captureBatchId_fkey"
  FOREIGN KEY ("captureBatchId") REFERENCES "CaptureBatch"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "SourceObservation" ADD CONSTRAINT "SourceObservation_captureOutputId_captureBatchId_fkey"
  FOREIGN KEY ("captureOutputId", "captureBatchId") REFERENCES "SourceExtraction"(id, "batchId")
  ON UPDATE CASCADE ON DELETE RESTRICT;
```

## Impact connu

**Restaurabilité — le vrai risque.** Une restauration de production ne reconstitue pas ces 8
contraintes. Une reprise après incident produirait donc une base aux garde-fous incomplets, sans
que rien ne le signale : `pg_restore` termine sur un code d'erreur que l'outillage peut ignorer.

**Exploitation courante : aucun impact observé.** Les 754 lignes sont lisibles et modifiables ;
les contraintes n'empêchent rien puisqu'elles ne sont pas revalidées.

**Nature des violations.** Ce sont des références vers des preuves qui n'existent plus :
`EmployerIdentityReview` et `DataCorrection` sont **vides** en production, alors que 31 lots de
revue distincts sont référencés. Les revues ont vraisemblablement disparu lors du reset du
catalogue. Les `JobEvent` et `OccupationObservation` orphelins pointent des `Job` supprimés.

## Ce que ce backlog n'est PAS

Il **ne reconstitue aucune preuve disparue**. Recréer 31 `EmployerIdentityReview` avec des
`statement`, `evidence`, `reviewedBy` et `reviewedAt` inventés fabriquerait une attestation de
révision qui n'a pas eu lieu. La vérité actuelle est : *la preuve historique n'existe plus dans la
base* — et une clé étrangère vers une preuve inexistante est mensongère.

## Voies possibles, à arbitrer hors de cette phase

1. **Neutraliser les références orphelines** là où le modèle l'autorise. Appliqué le 2026-09-22 aux
   33 `Company` qui n'étaient ni fusionnées ni rattachées à un groupe (voir
   [identityReviewId-orphelins-before.json](identityReviewId-orphelins-before.json)). Les 103
   restantes en sont empêchées par `Company_identity_relationship_review`, qui exige qu'une Maison
   fusionnée porte une référence de revue — un invariant qu'il ne faut pas affaiblir.
2. **Passer les 8 contraintes en `NOT VALID` en production**, ce qui dirait la vérité sur
   l'existant tout en contraignant les écritures nouvelles. Nécessite une intervention sur le
   schéma de production.
3. **Supprimer les lignes orphelines.** Elles portent un historique d'événements et
   d'observations ; leur suppression est irréversible et demande un arbitrage propriétaire.

## Ce qui a été fait sur la base de répétition

Les 8 contraintes y sont recréées **à l'identique, suffixées `NOT VALID`** — mêmes colonnes, même
cible, mêmes `ON UPDATE` / `ON DELETE`. Le clone porte donc **45 clés étrangères comme la
production**, dont 8 explicitement marquées non validées. C'est plus honnête que la production,
qui les présente `VALID`.

Comportement prouvé sur le clone, transactions annulées :

| test | résultat |
|---|---|
| `JobEvent` avec un `jobId` inexistant | **refusé** — `violates foreign key constraint "JobEvent_jobId_fkey"` |
| `OccupationObservation` avec un `jobId` inexistant | **refusé** — `violates foreign key constraint "OccupationObservation_jobId_fkey"` |
| `Company.identityReviewId` vers une revue inexistante | **refusé** — `violates foreign key constraint "Company_identityReviewId_fkey"` |
| `UPDATE` des 103 lignes historiques en violation | **accepté** — `UPDATE 103` |

**Historique toléré, nouvelle violation refusée** : exactement le comportement attendu pour une
répétition qui doit mesurer un delta sans hériter de la dette.
