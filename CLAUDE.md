# Catwalks — entrée documentaire

Le produit est un agrégateur mondial du luxe, de la mode, de la beauté et du retail, avec deux origines d’offres : publications directes Catwalks et publications externes.

## Références actuelles

- [README du projet](README.md).
- [Exploitation et état vérifié](apps/aggregator/README.md).
- [Canari validé le 23 septembre 2026](audits/2026-09-23/canary-delta-oh-my-cream.md) : delta egress PASS ; restaurabilité acquise, état final en pause. Le reset et le run complet ont depuis été réalisés ; l’état courant figure dans le bilan d’exploitation ci-dessous. Les preuves acquises ne sont pas à rejouer sans changement qui les invalide.
- [Runtime Railway](docs/architecture/railway-runtime-reset.md) : nouvelle API publique, anciens services retirés, le [bilan post-RUN](audits/2026-09-23/post-run.md) distingue la version livrée, les corrections et leur validation. Le RUN quotidien est configuré à 18 h Europe/Paris, avec changement d’heure pris en charge ; les images, SHA et preuves effectives figurent dans le reçu de release.
- [Architecture produit](docs/architecture/production-foundations.md).
- [Capture native et rétention](docs/architecture/native-capture.md).
- [Faits issus des publications](docs/architecture/source-facts.md).
- [Plan de reprise et validations](audits/reprise-2026-09-15/plan.md).
- [Exploitation canari et retour arrière](docs/architecture/canary-operations.md) : worker unique, pause autoritaire, nouvelle source et répétition locale.
- [`/emplois` multilingue](docs/architecture/emplois-e2e.md) et [Golden Path nouvelle source](docs/architecture/golden-source.md).

Le code, les réponses brutes et les mesures datées doivent être vérifiés avant toute conclusion. L’ancien journal mêlait des constats historiques à des règles devenues contradictoires ; son historique reste dans Git.

Le RAW est la référence. Les interprétations restent séparées, versionnées et rejouables. Aucun métier, diplôme ou contrat universel ne doit devenir une condition de publication. Les offres Catwalks et externes gardent leurs parcours de candidature distincts.

Périmètre courant : audit et correction post-RUN, depuis les RAW, SourceRun et logs de production. Le worker entretient accès et qualification native par les mécanismes existants. Les migrations non destructives nécessaires au correctif passent par development → main → CI → Railway ; aucun reset ni réparation des données historiques. Les validations de production restent ciblées, sans nouveau RUN complet. `/emplois`, marchés/filtres et Direct Offers ne sont pas refondus dans ce lot. `/offres`, moteur de matching et onboarding candidat restent gelés, y compris leur dette encore utilisée.

Les évolutions restent validées par des tests ciblés. Le CRON chargé est 18 h Europe/Paris, une fois par jour ; son reçu est dans `docs/operations/railway/runtime-release.json`. Le code de production est `1db582d` ; les commits de documentation et preuves suivants ne reconstruisent pas les images. Les incidents de sources sont isolés. Le matching, l’onboarding et la nouvelle promesse de `/offres` restent des chantiers distincts et gelés. Ne pas relancer les protocoles déjà acquis sans changement qui les invalide.

## Branches et coordination

- `main` est réservée à la version livrée et vérifiée en production.
- `development` porte le travail en cours ; les pushes sur cette branche sont autorisés.
- La promotion de `development` vers `main` intervient après validation de la release. Un push de développement ne vaut pas autorisation de mise en production.

Les pushes sur `development` sont autorisés dans les cinq dépôts. Aucun push sur `main` ni déploiement du site, backend, back-office ou média sans validation explicite de Loïc. Le GO de Loïc couvre la livraison et l’exploitation normale de l’agrégateur décrites dans le bilan courant, y compris sa promotion vers `main`. La mission post-RUN autorise les correctifs génériques, leurs migrations non destructives versionnées, la CI et la livraison de l’agrégateur. Aucun reset, réparation historique ou déploiement des autres produits n’est inclus.

### Transition des copies de travail

Les checkouts actuellement utilisés par Claude sont conservés tant que son travail est actif. Leur branche locale peut donc encore porter un ancien nom, y compris `main` : cela ne vaut ni validation ni autorisation de production. `development` distante reçoit les commits validés. La branche locale sera réalignée après coordination, sans perdre de fichiers modifiés ou non suivis. Le SHA réellement déployé doit être vérifié avant d’affirmer que `main` lui correspond.

Le dossier de référence est `/Users/lmelane/Downloads/catwalks-job-aggregator`, dépôt GitHub `lmelane/fr-retail-jobs`. Les copies temporaires de test restent identifiées et isolées ; aucune copie active n’est supprimée ou synchronisée pendant une validation. Préserver le travail unique avant de supprimer une branche ou un clone.

Les tests doivent couvrir les changements réels. Pour les seuls README et consignes non consommés par le runtime, vérifier le diff, les liens et les affirmations ; ne pas ajouter une nouvelle campagne globale sans modification du code. Conserver les contrôles de sécurité et de données ainsi que les hooks existants.
