# Déploiement web et migrations — incident du 9 septembre 2026

## État avant et cause racine
Le merge PR52 (`bd2f882`) a déployé un client Prisma qui lit `Job.opportunityType`, avant application de la migration additive `20260909232000_talent_recruiter_opportunity`. Railway affichait SUCCESS parce que `/api/health` ne vérifiait que quelques colonnes anciennes. Le web standalone ne contenait pas le CLI de migration et aucun pre-deploy n’était configuré. La pause des workers empêchait leur contrôle de migration de s’exécuter ; ces workers n’appliquent intentionnellement aucune DDL dans un cron.

Deux erreurs `DatabaseUnavailableError` sont observées dans les logs à 15:22:20 et 15:22:40 UTC. La durée totale d’indisponibilité et le nombre de visiteurs affectés ne sont pas établis. Ne pas les extrapoler à partir de deux lignes. La migration sauvegardée et testée a été appliquée immédiatement après détection. L’API, la page France et la santé sont revenues en HTTP 200 ; preuves horodatées jointes.

## Correction
- L’image web embarque le CLI Prisma et ses dépendances verrouillées, dans un répertoire séparé du serveur standalone.
- Le contrat versionné `apps/web/deployment-contract.json` exige `prisma migrate deploy` avant démarrage et le contrôle `/api/health` avant bascule du trafic. Ses valeurs sont appliquées par l’API au service web et relues dans le manifeste du déploiement.
- Le build incorpore automatiquement les noms et SHA-256 de toutes ses migrations. La santé refuse une migration attendue absente, modifiée ou échouée. Des migrations additionnelles appliquées par une version ultérieure sont autorisées pour préserver un rollback compatible.
- Les workers conservent leur contrôle préalable et restent en pause pendant la qualification.

Selon la [documentation Railway](https://docs.railway.com/deployments/pre-deploy-command), l’échec du pre-deploy arrête le déploiement. L’API a explicitement refusé de sélectionner un nouveau fichier `railway.json` : ce mécanisme est déprécié. Le [remplacement IaC](https://docs.railway.com/infrastructure-as-code) porte sur l’environnement complet ; nous ne migrons pas implicitement toutes les ressources pour ce correctif. Le contrat du hook est versionné et sa configuration effective est vérifiée par API. La santé reste un verrou applicatif indépendant du hook.

## Preuves et tests
Image Docker réelle construite et démarrée sur une base PostgreSQL 18 isolée : 38 migrations → santé 503 ; exécution du CLI embarqué → 39 migrations → santé 200 ; replay → aucune migration restante. Six tests du contrôle de santé et typecheck réussis. Vérification en lecture seule de production après récupération : 39 attendues, 39 appliquées, aucun checksum divergent ni échec.

Les nouvelles migrations doivent rester compatibles avec la version encore en service (expand/contract). Ce dispositif ne transforme pas une migration destructive en migration sûre et ne prétend pas détecter toute modification SQL manuelle du schéma.

## État de livraison
Livré via PR53 : commits `29d8d2d` et `a0eda8f`, merge `459da3a`, CI `34371179064` verte. Les quatre services sont déployés sur ce merge. Le web `f07adaa6-3fb8-44c6-be6e-c41c02d8dea4` termine sa migration à 15:40:02 UTC, avant le démarrage du serveur à 15:40:16 UTC ; santé publique 200. Preuve du manifeste et des logs relue. Les workers globaux restent en pause. Aucune réparation GANNI n’a été exécutée pour contourner l’incident ; elle a repris après cette validation. Lot 4 global toujours ouvert.
