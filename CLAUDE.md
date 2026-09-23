# Catwalks — entrée documentaire

Le produit est un agrégateur mondial du luxe, de la mode, de la beauté et du retail, avec deux origines d’offres : publications directes Catwalks et publications externes.

## Références actuelles

- [README du projet](README.md).
- [Exploitation et état vérifié](apps/aggregator/README.md).
- [Canari validé le 23 septembre 2026](audits/2026-09-23/canary-delta-oh-my-cream.md) : delta egress PASS ; restaurabilité acquise, état final en pause. Le reset et le run complet ont depuis été réalisés ; l’état courant figure dans le bilan d’exploitation ci-dessous. Les preuves acquises ne sont pas à rejouer sans changement qui les invalide.
- [Runtime Railway](docs/architecture/railway-runtime-reset.md) : nouvelle API publique, anciens services retirés, worker `653920c` en exploitation normale toutes les quatre heures UTC. Les 384 ACTIVE ont été tentées : 255 réussies, 35 partielles, 94 échouées individuellement ; aucun blocage systémique d’accès ni échec de persistance. Voir le [bilan](audits/2026-09-23/normal-production-run.json).
- [Architecture produit](docs/architecture/production-foundations.md).
- [Capture native et rétention](docs/architecture/native-capture.md).
- [Faits issus des publications](docs/architecture/source-facts.md).
- [Plan de reprise et validations](audits/reprise-2026-09-15/plan.md).
- [Exploitation canari et retour arrière](docs/architecture/canary-operations.md) : worker unique, pause autoritaire, nouvelle source et répétition locale.
- [`/emplois` multilingue](docs/architecture/emplois-e2e.md) et [Golden Path nouvelle source](docs/architecture/golden-source.md).

Le code, les réponses brutes et les mesures datées doivent être vérifiés avant toute conclusion. L’ancien journal mêlait des constats historiques à des règles devenues contradictoires ; son historique reste dans Git.

Le RAW est la référence. Les interprétations restent séparées, versionnées et rejouables. Aucun métier, diplôme ou contrat universel ne doit devenir une condition de publication. Les offres Catwalks et externes gardent leurs parcours de candidature distincts.

Périmètre courant : exploitation normale de l’agrégateur autorisée après R5 et le run complet des ACTIVE. Le worker entretient ses preuves d’accès via la qualification existante. Aucun reset, effacement ou changement du schéma de production ; les écritures normales d’ingestion et de géocodage restent autorisées. `/emplois`, marchés/filtres et Direct Offers ne sont pas refondus dans ce lot. `/offres`, moteur de matching et onboarding candidat restent gelés, y compris leur dette encore utilisée.

Les évolutions restent validées par des tests ciblés. Le CRON d’ingestion normal est actif ; les incidents de sources doivent être traités individuellement. Le matching, l’onboarding et la nouvelle promesse de `/offres` restent des chantiers distincts et gelés. Ne pas relancer les protocoles déjà acquis sans changement qui les invalide.

## Branches et coordination

- `main` est réservée à la version livrée et vérifiée en production.
- `development` porte le travail en cours ; les pushes sur cette branche sont autorisés.
- La promotion de `development` vers `main` intervient après validation de la release. Un push de développement ne vaut pas autorisation de mise en production.

Les pushes sur `development` sont autorisés dans les cinq dépôts. Aucun push sur `main` ni déploiement du site, backend, back-office ou média sans validation explicite de Loïc. Le GO de Loïc couvre la livraison et l’exploitation normale de l’agrégateur décrites dans le bilan courant, y compris sa promotion vers `main`. Il ne vaut pas autorisation d’une migration, d’une réparation historique ou d’un déploiement des autres produits.

### Transition des copies de travail

Les checkouts actuellement utilisés par Claude sont conservés tant que son travail est actif. Leur branche locale peut donc encore porter un ancien nom, y compris `main` : cela ne vaut ni validation ni autorisation de production. `development` distante reçoit les commits validés. La branche locale sera réalignée après coordination, sans perdre de fichiers modifiés ou non suivis. Le SHA réellement déployé doit être vérifié avant d’affirmer que `main` lui correspond.

Le dossier de référence est `/Users/lmelane/Downloads/catwalks-job-aggregator`, dépôt GitHub `lmelane/fr-retail-jobs`. Les copies temporaires de test restent identifiées et isolées ; aucune copie active n’est supprimée ou synchronisée pendant une validation. Préserver le travail unique avant de supprimer une branche ou un clone.

Les tests doivent couvrir les changements réels. Pour les seuls README et consignes non consommés par le runtime, vérifier le diff, les liens et les affirmations ; ne pas ajouter une nouvelle campagne globale sans modification du code. Conserver les contrôles de sécurité et de données ainsi que les hooks existants.
