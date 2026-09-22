# Restaurabilité et canari Oh My Cream — résultat final

Contrôles du **22 septembre 2026 UTC** (23 septembre sur le poste en Europe/Paris). **RESTAURABILITÉ VALIDÉE**. L’ingestion fonctionne ; la conformité stricte du canari est **NON VALIDÉE** à cause d’une sonde HTTP hors périmètre. Les workers sont revenus en pause. Aucun GO global ni seconde ingestion.

## Restauration : PASS

Décision appliquée : conserver les 613 lignes portant 754 violations historiques. Aucune réparation, nullification ou suppression. Le dump production a été copié une fois dans `restore_operational_20260922`, sur `catwalks-consolide-rehearsal`.

- Dump : 2 772 922 115 octets, SHA-256 `a41a9b1f86b7f9ecfbe6448140e0511d51b757784ce852c23d8458ccdeb90b3c`.
- Pre-data et data : terminés sans erreur. Post-data normal sauf les huit FK nommées dans la politique versionnée ; toutes les autres erreurs restent bloquantes.
- 45 FK présentes : 37 VALID et 8 NOT VALID. Tous les triggers FK actifs, aucun trigger désactivé, rôle de réplication `origin`.
- 8 comptes/hashes historiques strictement identiques. Les 37 autres populations orphelines restent vides.
- Empreintes complètes des 43 tables et des séquences identiques avant/après reconstruction et témoins : 0 perte, 0 donnée inventée.
- Huit insertions nouvelles refusées sur les tables applicatives : quatre directement par FK (23503), quatre par leur trigger métier préalable. Chaque définition exacte des huit FK est également exercée dans un schéma transactionnel témoin référençant les vrais parents : huit refus 23503. Tous les témoins sont annulés ; aucun parent créé et aucun trigger désactivé.
- Le lanceur legacy `nettoyer-collecte.mts` et l'ancien outil de repair sont supprimés. Le test de non-régression refuse le retour du lanceur ou d'un mécanisme de désactivation d'intégrité.

La copie unique a été poursuivie après deux corrections du contrôleur, sans recopier ou réparer les données : lecture explicite des champs de séquence, puis copie SQL typée des témoins pour préserver la distinction JSON `null` / SQL `NULL`. Les erreurs initiales restent dans les preuves privées ; le résultat final est PASS.

## Validation applicative locale : PASS

Après la preuve de restauration exacte à 85 migrations, répétition séparée de la seule migration de release Douglas `20260922100000_douglas_brand_property` : 86 migrations, populations historiques inchangées.

- API de la candidate : santé 200, accès sans clé 401, recherche Oh My Cream FR 21/21 identifiants identiques à la production sauvegardée.
- Navigateur réel sur `http://localhost:3022/emplois?marche=FR&q=Oh%20My%20Cream` : 21 offres FR, fiche et candidature externe ; filtre CDI : 10 confirmées puis 10 inconnues explicitement signalées, conformément à V1.
- Golden Path réel en base neuve : 23 créations puis 0 création/23 mises à jour ; 21 FR et 2 pays inconnus, rejeu natif et fins d'ingestion cohérents.
- Fresh install et build API réussis. CI des branches `development` et `main` verte pour la révision finale `72300c9`. Le runtime, le schéma et le lock sont identiques à la candidate de rollback déjà répétée (`9445599`) ; seules les suppressions/outils/documentation de restauration ont changé.
- `/offres` et matching : empreintes des fichiers gelés identiques. Aucun déploiement du site public, backend, back-office ou média.

Preuves privées : `~/.catwalks/restorability-20260922/` (`restore/result.json`, empreintes avant/après, témoins, `local-api-proof.json`, `local-ui-proof.json`, `golden/proof.json`, état Railway et empreintes complètes des 613 lignes).

## Tableau de sortie — restauration

| Contrôle | Résultat |
|---|---|
| Données restaurées intégralement | PASS — 43 tables et séquences identiques |
| 45 FK présentes | PASS |
| 37 FK VALID | PASS |
| 8 FK dette historique NOT VALID | PASS |
| Populations historiques et hashes identiques | PASS — 754 violations, 613 lignes |
| Nouvelle violation refusée sur les 8 | PASS — voir les deux témoins complémentaires ci-dessus |
| Triggers FK actifs | PASS — aucun trigger désactivé |
| `session_replication_role` normal | PASS — `origin` |
| Ancien chemin corrupteur supprimé | PASS — retrait et témoin de non-régression |
| API | PASS |
| `/emplois` | PASS — navigateur réel sur le clone |
| Golden Path | PASS — deux ingestions locales, rejeu et lecture API |
| Perte de données | 0 |
| Donnée inventée | 0 |

La [politique versionnée](../../apps/aggregator/scripts/ops/restore-operational-policy.json) fixe les définitions, comptes et hashes. Les huit seules exceptions sont :

| FK | Orphelins |
|---|---:|
| `Company_identityReviewId_fkey` | 103 |
| `CompanyAlias_reviewId_fkey` | 239 |
| `JobEvent_jobId_fkey` | 65 |
| `OccupationObservation_jobId_fkey` | 65 |
| `SourceIngestionCompletion_batchId_fkey` | 14 |
| `SourceIngestionCompletion_reportHash_fkey` | 14 |
| `SourceObservation_captureBatchId_fkey` | 127 |
| `SourceObservation_captureOutputId_captureBatchId_fkey` | 127 |

## Livraison et contrôles sous pause

Le GO explicite autorisait cette livraison et **une seule ingestion** Oh My Cream. `main` et les quatre services Railway portent désormais **`72300c97586955536ee1f89b0a9b7b0273fbf8a9`**. La seule migration appliquée par la release API est `20260922100000_douglas_brand_property` : 85 → 86. Aucun changement des huit FK historiques n’est appliqué à la production. Aucun repair des données n’est exécuté.

L’ancien override de campagne a été remplacé sous pause. Santé API, lecture authentifiée, schéma, manifeste livré, statut des runs et heartbeat ont été contrôlés avant dégel. Les 11 anciens RUNNING sans signal récent restent UNVERIFIED : aucune reclassification artificielle. Deux diagnostics sous pause ont confirmé le vrai worker sans démarrage métier et le heartbeat acquitté ; ils n’ont produit aucune ingestion.

Le premier diagnostic avait initialement été mal lu : les événements JSON sont dans `attributes`, tandis que `message` est vide. La relecture complète prouve son succès. Il ne s’agissait pas d’une défaillance du heartbeat ou d’une commande non exécutée. Le preflight est maintenant une commande versionnée et testée (`worker-status.mts --preflight --expected-revision=…`).

Validation du tooling : 11 tests de restauration avec les témoins PostgreSQL réels, suites Python d’exploitation, 24 tests pause/preflight dont les refus avant réseau et les runs actifs hors de la fenêtre des dix résultats, typecheck et CI. La répétition de rollback antérieure reste applicable : le runtime API/ingestion, le schéma et le lock sont identiques ; les différences concernent l’exploitation et la documentation.

## Une ingestion réelle Oh My Cream

Exécution du worker du **22 septembre, 21:57:18 à 21:57:25 UTC**, code final 0. La commande est le `start.sh source-add` documenté, avec clé `oh-my-cream`, origine `https://careers.ohmycream.com`, type Teamtailor et réviseur explicite `canary-railway-20260922`. La source existante est réutilisée ; aucune configuration concurrente n’est créée.

| Contrôle | Résultat |
|---|---|
| Qualification actuelle | QUALIFIEE, identité VERIFIED, accès ALLOWED |
| Lecteur | `git:72300c97586955536ee1f89b0a9b7b0273fbf8a9` |
| Rejeu natif | Exact, 23 sorties qualifiées |
| Collecte / ingestion | 23 lues, 23 acceptées, 23 mises à jour |
| Créations / fusions / erreurs | 0 / 0 / 0 |
| Publications et identités | Mêmes 23 Job et 23 JobSource |
| Pays | 21 FR, 2 inconnus conservés ; aucun pays inventé |
| Captures | 4 : identité, qualification JOBS, accès, ingestion JOBS |
| RAW | 4 réponses complètes, aucune capture échouée ; 34 blobs référencés, gzip et SHA-256 vérifiés |
| Extraction | 23 sorties pour chacune des deux captures JOBS |
| Fin attestée | 23 publiées, 0 retenue, 0 échec, 0 ignorée |
| Liens de publication | Les 23 JobSource pointent la nouvelle capture d’ingestion et une sortie |
| Absence | 23 PRESENT_AND_REATTESTED ; aucune fermeture ni refresh |
| Heartbeat | Acquitté pour campagne et ingestion |
| API après ingestion | Santé 200 ; FR = 21, identifiants attendus |
| `/emplois` réel après ingestion | Preview existante : 21 FR, fiche et candidature externe ; CDI = 10 confirmées + 10 inconnues signalées |
| Autre source ingérée ou capturée | Aucune |
| Périmètre HTTP strict | **ÉCHEC — sonde historique indépendante, voir ci-dessous** |

La source était déjà ACTIVE. Le champ `promotionGatesPass:false` ne signifie pas un refus de la qualification : le statut exclut une nouvelle promotion d’une source déjà ACTIVE (`src/onboarding/status.ts`). Les contrôles d’identité, d’accès et de rejeu ont effectivement été renouvelés. Ce cas vérifie l’idempotence de l’ajout en production ; la création depuis DRAFT a été vérifiée dans le Golden Path local.

### Identifiants de preuve

- Déploiement du canari : `d097a2b8-8c81-42f2-83de-ff6924256f58`.
- Run campagne : `8b998e81-c44d-423a-a5f1-813c0a438d4f` ; run ingestion : `6268f211-95c4-4d18-9a56-875d5f74168a`, tous deux COMPLETED.
- Capture d’ingestion : `4ca6b865-1397-4b5d-8417-feb918c50084`.
- Fin attestée : `b52bd73450e01113fd5c51e8d453ef44a6212886ddc4480b73d8a96cecbe3076`.
- Révision de source conservée : `2b9ebb72-6e51-4337-8b53-57412c54ec81`.

Les comptes après ingestion sont 34 883 Job, 35 349 JobSource et 0 DirectOffer, identiques au départ. Les captures passent de 9 164 à 9 168, les extractions de 252 840 à 252 886 et les fins attestées de 918 à 919. Les empreintes des **613 lignes historiques complètes**, et pas seulement leurs IDs, restent strictement identiques avant/après.

## Écart de périmètre et retour en pause

La variable de service résiduelle **`EGRESS_PROBE=1`** a activé `src/pipeline/egressProbe.ts`. L’ancien override la neutralisait par un préfixe inline ; son remplacement a révélé la valeur du service. Cette sonde a consulté le service public d’adresse IP puis envoyé des diagnostics HTTP vers **`jobs.dolcegabbana.com`**, indépendamment de la clé Oh My Cream.

Ce sont des requêtes hors périmètre autorisé. Aucun adaptateur d’ingestion Dolce & Gabbana, aucun SourceRun ni CaptureBatch de cette source n’a été produit. Cette absence d’écriture ne rend pas le périmètre HTTP conforme. L’écart a été identifié dans les journaux structurés après la terminaison de l’unique run de sept secondes. **Le canari strict n’est donc pas déclaré PASS.**

La pause et la commande normale ont été restaurées. `EGRESS_PROBE=0` est maintenant explicite au niveau du service. Le déploiement final a été vérifié, puis le vrai worker normal a été exécuté sous pause :

- déploiement `e5dac0e1-5500-498d-89bd-1857275e1d8a`, SHA `72300c9`, statut SUCCESS ;
- événement `pipeline.paused`, `state:PAUSED`, `command:ingest-all`, **`workStarted:false`**, à **22:05:16.726 UTC** ;
- `deploymentStopped:true` après cette exécution ;
- aucun nouveau run métier ni capture ajouté par ce témoin ;
- trois workers `PIPELINE_PAUSED=1`, cron inchangé `0 0 29 2 *`, aucune activation périodique ;
- les quatre services restent au SHA livré ; les 45 FK de production sont présentes, aucun trigger désactivé, rôle `origin`, aucune migration échouée.

Aucun rollback applicatif n’a été nécessaire ; la configuration d’exploitation est revenue à la pause et à la commande normale, avec la sonde désactivée. Aucun second canari n’est lancé : l’autorisation bornée a été consommée. Une nouvelle exécution exige un nouveau GO et la vérification préalable de `EGRESS_PROBE=0` dans le manifeste effectif. Le runbook inclut désormais cette condition. La restaurabilité ne dépend pas de ce nouvel essai et reste **VALIDÉE**.

## Périmètres conservés et accès local

`/offres`, matching et offres directes n’ont pas été modifiés. Les empreintes des fichiers gelés sont identiques. Aucun push `main` ni déploiement du website, backend, back-office ou média. La vérification web distante utilise la preview déjà existante du website `76ddcb0`, branchée sur l’API Railway ; elle ne constitue pas une livraison du site public.

En fin d’intervention, l’environnement de contrôle local reste disponible : [Oh My Cream sur le clone restauré](http://localhost:3022/emplois?marche=FR&q=Oh%20My%20Cream), API locale `127.0.0.1:3012`, base `restore_operational_20260922` du conteneur `catwalks-consolide-rehearsal`. La migration de release a été appliquée après la preuve de restauration exacte ; les populations historiques sont inchangées. Aucun serveur ou checkout actif de l’autre développeur n’a été arrêté.

## Preuves conservées

Les fichiers privés sous `~/.catwalks/restorability-20260922/` conservent le dump, les erreurs initiales du contrôleur et les preuves finales. Ne pas versionner ce dossier ni ses fichiers d’environnement.

- Restauration : `production.dump.proof.json`, `restore/result.json`, `restore/data-before.json`, `restore/data-after.json`, `restore/new-write-witnesses.json`, `restorability-verdict.json`.
- Application locale : `local-api-proof.json`, `local-ui-proof.json`, `golden/proof.json`, comparaisons du runtime de release et de rollback.
- Production : `production-before.json`, `production-after.json`, `production-historical-before.json`, `production-historical-after.json`, `production-final-integrity.json`.
- Canari : `canary-execution.json`, `canary-final-run.json`, `canary-platform-live.json`, `canary-capture-chain.json`, `canary-raw-integrity.json`, `canary-heartbeats.json`, `production-api-after.json`, `production-ui-after.json`.
- Pause finale : `final-safe-deployment.json`, `final-services.json`, `final-pause-proof.json`, `final-pause-platform.json`, `after-final-pause.json`.

Le [manifeste de preuves](restorability-canary-evidence.json) versionne leurs empreintes et le verdict synthétique, sans dumps, secrets ni corps RAW. Les audits antérieurs restent des constats datés, pas l’état courant.
