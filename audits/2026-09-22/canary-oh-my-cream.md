# Canari Oh My Cream — STOP avant livraison, 22 septembre 2026

## Décision

Le GO explicite de Loïc autorisait une seule exécution Railway, après sauvegarde **et restauration prouvée**. Ce prérequis échoue : le dump de production contient des références d’identité orphelines. Le canari est arrêté à l’étape 1. **Aucune mutation Railway, aucun push `main`, aucune migration, aucune collecte et aucun ping externe n’ont été exécutés.** L’ancien override n’a donc pas encore été remplacé.

PR-1, `/emplois` V1 et le Golden Path local restent validés dans leurs périmètres. Cette anomalie concerne les données de la base Railway existante ; elle ne prouve pas une régression de la candidate. Le retour applicatif répété sur base locale ne remplace pas la restauration du véritable stock de production.

## Révisions et état initial

- Candidate figée : `f3bf5b23d261b2bed9b7908825c6b69a6eb0b827` ; son runtime est celui de `9445599739f713fa5af987b24cd2114f5b1fe344`.
- Production et `origin/main` : `0f22b49eb65ea8d6bf98a183e078276fa47c8b9e`.
- Quatre services Railway `SUCCESS` sur cette ancienne révision ; trois workers `PIPELINE_PAUSED=1`, calendrier inchangé `0 0 29 2 *`, redémarrage `NEVER`.
- Agrégateur : déploiement `a2511814-3f55-4012-a388-f809aabf6f07`, `deploymentStopped=true`. Aucun processus accessible par SSH. Les 11 lignes historiques `RUNNING` sont conservées, jamais reclassées artificiellement en succès ; leur dernier événement remonte au 20 septembre à 11:16:06 UTC. Le dernier run terminé et la dernière capture sont également du 20 septembre. Aucune session PostgreSQL active étrangère aux lectures de contrôle.
- 85 migrations finies ; tous les checksums correspondent au dépôt. Seule migration candidate en attente : `20260922100000_douglas_brand_property`. Aucune migration appliquée durant cette opération.
- API existante : `/api/health` et recherche authentifiée FR répondent 200.

## Blocage de restauration, confirmé sur la production

Dump complet privé : **2 772 922 115 octets** ; SHA-256 `2ae51acede4a72ca932db747599e311993136f81ca8ef01ebc803e50a81fdebb`. Extraction en lecture seule avec `pg_dump -Fc --no-owner --no-privileges`.

Restauration dans une base locale dédiée, avec `pg_restore --exit-on-error --no-owner --no-privileges` : **code 1** lors de la création de `CompanyAlias_reviewId_fkey`. Exemple précis : `lot1-promod-aubade-20260909-v1` absent de `EmployerIdentityReview`.

Lectures directes de Railway, sans correction :

| Mesure | Résultat |
|---|---:|
| Lignes `EmployerIdentityReview` | **0** |
| Alias avec `reviewId` non nul mais revue absente | **239** |
| Références distinctes de revue dans ces alias | **32** |
| Sources représentées par ces alias | **75** |
| Entreprises avec `identityReviewId` non nul mais revue absente | **103** |
| Références distinctes de revue dans ces entreprises | **19** |

Les deux contraintes sont pourtant marquées `convalidated=true` dans la base source. Cela ne garantit donc pas ici l’intégrité des lignes existantes. La cause historique de la disparition des revues n’est **pas établie**.

Les données transférées présentent les mêmes décomptes contrôlés et les mêmes 85 lignes de migrations (comparées par nom, indépendamment de la collation). Les 23 identifiants Oh My Cream sont identiques. Cela confirme le transfert des données ; **cela ne transforme pas la restauration échouée en restauration valide**. Aucune désactivation de contrainte, revue inventée, purge ni réécriture du ledger n’a servi à obtenir un faux PASS.

## Rapport demandé

`NON EXÉCUTÉ` signifie arrêt préalable ; ce n’est ni un PASS ni un échec observé de la candidate.

| Bloc | Résultat |
|---|---|
| SHA réellement livré | **Aucun nouveau SHA** ; production conservée sur `0f22b49e` |
| Migration | NON EXÉCUTÉ — 85 conservées, Douglas toujours en attente |
| Contrôles sous pause | **FAIL au prérequis restauration** ; état initial et API existante contrôlés |
| Source unique Oh My Cream | NON EXÉCUTÉ — aucune source lancée |
| Collecte | NON EXÉCUTÉ |
| RAW/captures | NON EXÉCUTÉ pour le canari ; compteurs existants inchangés |
| Extraction | NON EXÉCUTÉ |
| Ingestion | NON EXÉCUTÉ |
| Idempotence / doublons | NON EXÉCUTÉ sur Railway ; Golden Path local antérieur conservé |
| GEO | NON EXÉCUTÉ pour le canari ; corpus Oh My Cream inchangé |
| Observabilité / heartbeat | État initial archivé ; heartbeat depuis la candidate NON EXÉCUTÉ |
| `/emplois` réel | Lecture préliminaire existante : **21 offres FR** visibles dans la preview ; résultat du canari NON EXÉCUTÉ |
| Retour en pause | **PASS — pause maintenue continuellement**, aucun dégel ni redémarrage nécessaire |
| Rollback nécessaire | **NON** — aucun changement de production à annuler |

### Volumes et écarts

- **0 ingestion, 0 nouvelle capture, 0 nouvelle offre attribuable à cette opération.**
- Oh My Cream était déjà présente : **23 offres, 21 FR et 2 sans pays**. Les 23 publications et leurs offres sont identiques avant/après. Ce volume préexistant n’est pas une preuve de canari réussi.
- Stock contrôlé inchangé : 537 sources, 34 883 Jobs, 35 349 JobSource, 0 DirectOffer, 9 164 CaptureBatch, 144 890 RawCapture, 268 765 RawBlob et corps chauds, 252 840 SourceExtraction, 2 083 SourceValidation, 918 fins d’ingestion, 932 PipelineRun, 20 849 PipelineEvent.
- Les quatre identifiants de déploiement, commandes et valeurs de pause sont identiques avant/après. Les CRON restent gelés. `/offres`, matching, offres directes et autres dépôts ne sont pas modifiés.

La preview website existante `76ddcb0cd93e13de4b145a215cf9b1b6d4c43471` a été consultée via le vrai parcours navigateur : [Oh My Cream, marché FR](https://catwalks-front-9en5b9xnf-catwalks-9c91c4d2.vercel.app/emplois?marche=FR&q=Oh%20My%20Cream). Aucun déploiement du website ni promotion globale de sa branche n’a eu lieu. L’émission externe de heartbeat reste à prouver dans le futur conteneur, après résolution du blocage.

## Preuves et reprise

Dossier privé hors Git : `/Users/lmelane/.catwalks/canary-ohmycream-20260922/`.

- `production-before.dump` et `production-before.dump.proof.json` : sauvegarde conservée, `restoreProven:false`.
- `restore.log`, `restore-blocker.json`, `restore-blocker-companies.json` : échec PostgreSQL et état directement relu en production.
- `before-services.json`, `before-platform-all.json`, `final-services.json` : services, pause, calendriers, commandes et révisions.
- `before-database.json`, `before-counts.json`, `restored-counts.json`, `final-counts.json`, `verdict.json` : mesures et invariants.
- Les secrets et le dump ne sont pas versionnés. Le fichier temporaire de variables Vercel a été retiré après usage. La base locale de restauration incomplète a été supprimée après les mesures ; le dump et les preuves sont conservés. Aucun clone utilisateur n’a été modifié.

**Blocage unique de reprise : rétablir une restauration intègre de la base Railway.** Il faut d’abord rechercher les revues originales dans des preuves/sauvegardes vérifiables, déterminer la cause de leur absence et préparer une correction séparée et testée sur clone. Si ces revues ne sont pas récupérables, une décision de traitement des références non prouvées est nécessaire ; aucune revue ne doit être fabriquée à partir de la seule présence d’un alias. Aucune réparation improvisée en production n’est autorisée par ce canari.

Une fois le correctif validé et livré dans son propre périmètre, refaire une sauvegarde et une restauration complète sans erreur, puis reprendre le [runbook](../../docs/architecture/canary-operations.md) à l’état initial. Produire les qualifications sous le SHA réellement livré. Ne pas réutiliser les preuves locales comme autorisations Railway, ne pas relancer automatiquement le canari, ne pas réactiver les CRON.
