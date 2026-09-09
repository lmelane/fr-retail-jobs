# Déploiement web et migrations — incident du 9 septembre 2026

## État avant et cause racine
Le merge PR52 (`bd2f882`) a déployé un client Prisma qui lit `Job.opportunityType`, avant application de la migration additive `20260909232000_talent_recruiter_opportunity`. Railway affichait SUCCESS parce que `/api/health` ne vérifiait que quelques colonnes anciennes. Le web standalone ne contenait pas le CLI de migration et aucun pre-deploy n’était configuré. La pause des workers empêchait leur contrôle de migration de s’exécuter ; ces workers n’appliquent intentionnellement aucune DDL dans un cron.

Deux erreurs `DatabaseUnavailableError` sont observées dans les logs à 15:22:20 et 15:22:40 UTC. La durée totale d’indisponibilité et le nombre de visiteurs affectés ne sont pas établis. Ne pas les extrapoler à partir de deux lignes. La migration sauvegardée et testée a été appliquée immédiatement après détection. L’API, la page France et la santé sont revenues en HTTP 200 ; preuves horodatées jointes.

## Correction
- L’image web embarque le CLI Prisma et ses dépendances verrouillées, dans un répertoire séparé du serveur standalone.
- `apps/web/railway.json` exige `prisma migrate deploy` avant démarrage et le contrôle `/api/health` avant bascule du trafic. Ce fichier doit être effectivement sélectionné dans le service Railway.
- Le build incorpore automatiquement les noms et SHA-256 de toutes ses migrations. La santé refuse une migration attendue absente, modifiée ou échouée. Des migrations additionnelles appliquées par une version ultérieure sont autorisées pour préserver un rollback compatible.
- Les workers conservent leur contrôle préalable et restent en pause pendant la qualification.

Selon la [documentation Railway](https://docs.railway.com/deployments/pre-deploy-command), l’échec du pre-deploy arrête le déploiement. La [configuration versionnée](https://docs.railway.com/config-as-code) évite que cette étape dépende uniquement d’une opération manuelle.

## Preuves et tests
Image Docker réelle construite et démarrée sur une base PostgreSQL 18 isolée : 38 migrations → santé 503 ; exécution du CLI embarqué → 39 migrations → santé 200 ; replay → aucune migration restante. Six tests du contrôle de santé et typecheck réussis. Vérification en lecture seule de production après récupération : 39 attendues, 39 appliquées, aucun checksum divergent ni échec.

Les nouvelles migrations doivent rester compatibles avec la version encore en service (expand/contract). Ce dispositif ne transforme pas une migration destructive en migration sûre et ne prétend pas détecter toute modification SQL manuelle du schéma.

## État de livraison
Correction locale testée au moment de ce document. Commit, merge et preuve du hook Railway effectif à compléter après livraison. Aucune réparation GANNI exécutée pour contourner l’incident. Lot 4 global toujours ouvert.
