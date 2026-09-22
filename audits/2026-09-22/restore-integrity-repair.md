# Restore integrity repair — 22 septembre 2026

**NO-GO REPAIR PRODUCTION.** Une seule restauration `pre-data` + `data` du dump réel, puis inventaire complet avant toute décision. Aucune recherche historique. Aucun repair partiel, aucun objet métier supprimé, aucune revue créée. L’outil s’arrête avec le code **2**, avant les UPDATE et la restauration post-data.

## Procédure versionnée et résultat

[`restore-integrity-repair.py`](../../apps/aggregator/scripts/ops/restore-integrity-repair.py) restaure exclusivement vers une **nouvelle base Docker locale** nommée `restore_integrity_*`. Une base existante est refusée. Le dump doit correspondre au SHA-256 fourni. Le script extrait toutes les FK du post-data, y compris les composites ; une syntaxe inconnue n’est jamais omise silencieusement. Il mesure chaque population, la nullabilité de chaque colonne et le hash SHA-256 des clés primaires et références ciblées. `MATCH SIMPLE` et `MATCH FULL` gardent leurs règles SQL distinctes.

Le plan contient aussi les FK sans violation. Si tout est explicitement réparable, une transaction verrouille enfants et parents, revérifie **tous** les comptes et hashes avant le premier UPDATE, puis refait la recherche globale d’orphelins avant commit. Un changement d’ID à compte identique ou une nouvelle violation dans une population auparavant vide fait échouer la transaction. Il n’existe ni option force, ni mode production, ni création de parent, ni désactivation d’intégrité. Le post-data complet et les FK/checks/triggers sont vérifiés avant un exit 0. Un PASS structurel ne prétend pas valider l’API ou l’interface : ces validations sont explicitement séparées dans le résultat.

Dump réel : `2ae51acede4a72ca932db747599e311993136f81ca8ef01ebc803e50a81fdebb`, **2 772 922 115 octets**. Plan : `6476c847a3a952303e2da17a279f229fb8f67a18ef6eb4200aa4b005202f45f3`.

| Contrôle | Résultat |
|---|---|
| FK analysées exhaustivement | **PASS — 45** |
| FK en violation | **8**, soit **754 violations sur 613 lignes distinctes** |
| FK réparables par NULL fail-closed | **1**, `CompanyAlias.reviewId`, 239 lignes |
| FK non réparables automatiquement | **7** |
| Identity NULL sémantiquement sûr | **FAIL pour Company** ; PASS pour l’éligibilité des alias |
| Repair déterministe/hashé | **PASS**, gardes exercées sur PostgreSQL |
| Clone réparé | **NON — arrêt avant mutation** |
| Restore complet | **FAIL / bloqué**, post-data non exécuté |
| 0 FK orpheline | **FAIL** |
| API / `/emplois` / Golden Path / fresh install produit | **NON EXÉCUTÉS**, prérequis de restauration bloqué ; validations antérieures non recyclées en PASS |
| Impact publication appliqué | **0 job modifié** ; impact futur non validable sous ces règles |
| Chemin actuel pouvant désactiver l’intégrité | **OUI**, ancien script de purge |

### Les sept contraintes bloquantes

| Contrainte / population | Lignes | Blocage |
|---|---:|---|
| `Company.identityReviewId` | 103 | CHECK exigeant une preuve pour les relations ; le runtime suit les fusions sans vérifier la revue |
| `JobEvent.jobId` | 65 | NOT NULL, Job parent absent |
| `OccupationObservation.jobId` | 65 | NOT NULL, Job parent absent |
| `SourceIngestionCompletion.batchId` | 14 | NOT NULL, capture parent absente |
| `SourceIngestionCompletion.reportHash` | 14 | NOT NULL, RAW du rapport absent |
| `SourceObservation.captureBatchId` | 127 | Nullable, mais aucune règle de nullification validée pour cette provenance |
| `SourceObservation.(captureOutputId,captureBatchId)` | 127 | Même population, FK composite ; sémantique de réparation non approuvée |

Les populations de `SourceIngestionCompletion` et `SourceObservation` sont comptées deux fois dans les violations FK, une fois dans les 613 objets distincts. Les relations non réparables ne sont ni rendues nullable ni supprimées pour fabriquer un PASS.

## Identity : preuves dans le code et sur le clone

- `resolveEmployer`, `companyIdentityWhere`, la recherche et les suggestions ignorent les alias dont `reviewId` est NULL. Cela retire leur autorité de résolution et de recherche ; aucun champ Job n’est modifié. Les anciennes graphies peuvent cesser d’être des termes de recherche reconnus : ce n’est pas une validation complète d’absence d’impact UX.
- `Company_identity_relationship_review` exige `identityReviewId IS NOT NULL` dès que `mergedIntoId` ou `parentGroupId` existe. **79 fusions + 24 relations de groupe = les 103 entreprises orphelines.**
- `canonicalEmployer()` suit `mergedIntoId` sans exiger de revue ; `resolveEmployer()` peut encore nommer le résultat `REVIEWED_MERGE` lorsque la revue est absente. NULL ne signifie donc pas automatiquement UNKNOWN pour cette relation.
- Le vrai UPDATE de nullification des entreprises a été tenté dans une **transaction locale annulée** : PostgreSQL le refuse sur le CHECK existant. Aucun UPDATE n’a été conservé, aucun parent inventé, aucune contrainte contournée.

## Impact mesuré, sans extrapoler un repair bloqué

Mesure à l’instant figé `2026-09-22 20:48:14+00`, selon le prédicat publiable du code `packages/db/availability.ts` : Job actif, non absorbé, avec au moins une publication active non expirée.

| Périmètre | Nombre |
|---|---:|
| Companies avec référence de revue orpheline | 103 |
| Alias avec référence de revue orpheline | 239 |
| Companies visées par ces alias | 99 |
| Companies distinctes des deux ensembles | 182 |
| Sources ACTIVE liées aux alias | 70 |
| Sources ACTIVE liées aux alias ou publications des Companies concernées | 72 |
| Jobs publiables liés aux Companies à revue orpheline | 156 |
| Jobs publiables liés aux Companies visées par les alias | 15 489 |
| Jobs publiables du périmètre combiné | **15 489**, sur 34 762 publiables |
| Jobs modifiés, supprimés ou retirés par l’opération | **0** |

15 489 désigne un **périmètre exposé**, pas un nombre de retraits provoqués. Une réparation globale n’étant pas sémantiquement autorisée, l’absence d’impact applicatif après repair n’est pas certifiée.

## Cause encore possible, sans enquête historique

Production relue uniquement en lecture seule : **45 FK validées, 235 triggers actifs**, aucun trigger désactivé ou limité au mode replica, `session_replication_role=origin`. Le CHECK des relations d’identité est validé. Les trois workers restent en pause.

Cependant, `apps/aggregator/scripts/ops/nettoyer-collecte.mts` contient encore `SET LOCAL session_replication_role = replica` (chemin `--ecrire`), puis des DELETE susceptibles de laisser des dépendants orphelins. Ce script est présent dans la candidate. Son contrôle du **nombre** de triggers ne vérifie pas les données référencées. Il n’a pas été exécuté ni modifié pendant ce lot. Ce constat suffit à refuser l’étiquette « HISTORICAL DEBT sans cause encore active ». Il ne démontre pas à lui seul l’origine de chaque anomalie existante.

## Tests et preuves

**11 tests PASS**, dont 6 témoins PostgreSQL : réparation nullable conservant les objets, rejet effectif d’un orphelin après reconstruction de la FK, dérive de compte, dérive d’IDs à compte constant, FK composite, refus du CHECK Company et procédure complète sur dump de fixture valide avec exit 0. Ce dernier prouve le mécanisme de l’outil, **pas la restauration du dump de production**.

Dossier privé : `/Users/lmelane/.catwalks/restore-integrity-20260922/`. `run/inventory.json` et `run/plan.json` contiennent l’inventaire et les empreintes ; `run/result.json`, `production-integrity.json`, `impact.json`, `null-company-witness.log`, `tests.log` portent les résultats. La base locale intermédiaire `restore_integrity_20260922` est identifiée comme **incomplète et non validée pour E2E**. Les bases de tests synthétiques sont supprimées après les témoins. Le dump initial reste conservé, sans duplication.

La production, `main`, `/offres` et le matching restent inchangés. Aucun canari, CRON ou autre source relancé. Aucun diagnostic historique supplémentaire n’est nécessaire pour cette décision : les cas NOT NULL et la sémantique Company bloquent le repair demandé.

## Inventaire exhaustif du dump

`STOP` sur une FK à zéro orphelin indique sa politique en cas de violation, sans ajouter de blocage au stock constaté.

| FK | Enfant (colonnes) | Parent (colonnes) | Nullable par colonne | Orphelins | Politique |
|---|---|---|---|---:|---|
| `CaptureBatch_accessDecisionId_fkey` | `CaptureBatch.(accessDecisionId)` | `SourceAccessDecision.(id)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `CaptureBatch_sourceRevisionId_fkey` | `CaptureBatch.(sourceRevisionId)` | `SourceRevision.(id)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `CaptureOutcome_batchId_fkey` | `CaptureOutcome.(batchId)` | `CaptureBatch.(id)` | non | 0 | STOP_NON_NULLABLE |
| `CaptureOutcome_manifestHash_fkey` | `CaptureOutcome.(manifestHash)` | `RawBlob.(hash)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `Company_identityReviewId_fkey` | `Company.(identityReviewId)` | `EmployerIdentityReview.(id)` | oui | 103 | STOP_UNSAFE_SEMANTICS |
| `Company_mergedIntoId_fkey` | `Company.(mergedIntoId)` | `Company.(id)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `Company_parentGroupId_fkey` | `Company.(parentGroupId)` | `Company.(id)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `Company_sectorReviewId_fkey` | `Company.(sectorReviewId)` | `SectorReview.(id)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `CompanyAlias_companyId_fkey` | `CompanyAlias.(companyId)` | `Company.(id)` | non | 0 | STOP_NON_NULLABLE |
| `CompanyAlias_reviewId_fkey` | `CompanyAlias.(reviewId)` | `EmployerIdentityReview.(id)` | oui | 239 | SET_NULL |
| `Job_companyId_fkey` | `Job.(companyId)` | `Company.(id)` | non | 0 | STOP_NON_NULLABLE |
| `Job_mergedIntoId_fkey` | `Job.(mergedIntoId)` | `Job.(id)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `Job_occupationReleaseId_fkey` | `Job.(occupationReleaseId)` | `OccupationRelease.(id)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `JobEvent_jobId_fkey` | `JobEvent.(jobId)` | `Job.(id)` | non | 65 | STOP_NON_NULLABLE |
| `JobSource_captureBatchId_fkey` | `JobSource.(captureBatchId)` | `CaptureBatch.(id)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `JobSource_captureOutputId_captureBatchId_fkey` | `JobSource.(captureOutputId,captureBatchId)` | `SourceExtraction.(id,batchId)` | oui,oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `JobSource_jobId_fkey` | `JobSource.(jobId)` | `Job.(id)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `OccupationObservation_jobId_fkey` | `OccupationObservation.(jobId)` | `Job.(id)` | non | 65 | STOP_NON_NULLABLE |
| `OccupationObservation_releaseId_fkey` | `OccupationObservation.(releaseId)` | `OccupationRelease.(id)` | non | 0 | STOP_NON_NULLABLE |
| `OccupationState_releaseId_fkey` | `OccupationState.(releaseId)` | `OccupationRelease.(id)` | non | 0 | STOP_NON_NULLABLE |
| `PipelineEvent_runId_fkey` | `PipelineEvent.(runId)` | `PipelineRun.(id)` | non | 0 | STOP_NON_NULLABLE |
| `RawBlobArchive_hash_fkey` | `RawBlobArchive.(hash)` | `RawBlob.(hash)` | non | 0 | STOP_NON_NULLABLE |
| `RawBlobBody_hash_fkey` | `RawBlobBody.(hash)` | `RawBlob.(hash)` | non | 0 | STOP_NON_NULLABLE |
| `RawCapture_batchId_fkey` | `RawCapture.(batchId)` | `CaptureBatch.(id)` | non | 0 | STOP_NON_NULLABLE |
| `RawCapture_blobHash_fkey` | `RawCapture.(blobHash)` | `RawBlob.(hash)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `RawCapture_requestDataHash_fkey` | `RawCapture.(requestDataHash)` | `RawBlob.(hash)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `Source_currentRevisionId_fkey` | `Source.(currentRevisionId)` | `SourceRevision.(id)` | non | 0 | STOP_NON_NULLABLE |
| `SourceAccessDecision_captureBatchId_fkey` | `SourceAccessDecision.(captureBatchId)` | `CaptureBatch.(id)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `SourceAccessDecision_sourceRevisionId_fkey` | `SourceAccessDecision.(sourceRevisionId)` | `SourceRevision.(id)` | non | 0 | STOP_NON_NULLABLE |
| `SourceExtraction_batchId_fkey` | `SourceExtraction.(batchId)` | `CaptureBatch.(id)` | non | 0 | STOP_NON_NULLABLE |
| `SourceExtraction_outputHash_fkey` | `SourceExtraction.(outputHash)` | `RawBlob.(hash)` | non | 0 | STOP_NON_NULLABLE |
| `SourceFieldTrustObservation_trustId_fkey` | `SourceFieldTrustObservation.(trustId)` | `SourceFieldTrust.(id)` | non | 0 | STOP_NON_NULLABLE |
| `SourceIdentityReview_evidenceCaptureBatchId_fkey` | `SourceIdentityReview.(evidenceCaptureBatchId)` | `CaptureBatch.(id)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `SourceIdentityReview_sourceKey_fkey` | `SourceIdentityReview.(sourceKey)` | `Source.(key)` | non | 0 | STOP_NON_NULLABLE |
| `SourceIdentityReview_sourceRevisionId_fkey` | `SourceIdentityReview.(sourceRevisionId)` | `SourceRevision.(id)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `SourceIngestionAdmission_batchId_fkey` | `SourceIngestionAdmission.(batchId)` | `CaptureBatch.(id)` | non | 0 | STOP_NON_NULLABLE |
| `SourceIngestionAdmission_identityReviewId_fkey` | `SourceIngestionAdmission.(identityReviewId)` | `SourceIdentityReview.(id)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `SourceIngestionAdmission_sourceValidationId_fkey` | `SourceIngestionAdmission.(sourceValidationId)` | `SourceValidation.(id)` | non | 0 | STOP_NON_NULLABLE |
| `SourceIngestionCompletion_batchId_fkey` | `SourceIngestionCompletion.(batchId)` | `CaptureBatch.(id)` | non | 14 | STOP_NON_NULLABLE |
| `SourceIngestionCompletion_reportHash_fkey` | `SourceIngestionCompletion.(reportHash)` | `RawBlob.(hash)` | non | 14 | STOP_NON_NULLABLE |
| `SourceObservation_captureBatchId_fkey` | `SourceObservation.(captureBatchId)` | `CaptureBatch.(id)` | oui | 127 | STOP_UNKNOWN_SEMANTICS |
| `SourceObservation_captureOutputId_captureBatchId_fkey` | `SourceObservation.(captureOutputId,captureBatchId)` | `SourceExtraction.(id,batchId)` | oui,oui | 127 | STOP_UNKNOWN_SEMANTICS |
| `SourceObservation_rawBlobHash_fkey` | `SourceObservation.(rawBlobHash)` | `RawBlob.(hash)` | oui | 0 | STOP_UNKNOWN_SEMANTICS |
| `SourceValidation_captureBatchId_fkey` | `SourceValidation.(captureBatchId)` | `CaptureBatch.(id)` | non | 0 | STOP_NON_NULLABLE |
| `SourceValidation_sourceRevisionId_fkey` | `SourceValidation.(sourceRevisionId)` | `SourceRevision.(id)` | non | 0 | STOP_NON_NULLABLE |
