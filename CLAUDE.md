# Catwalks — entrée documentaire

Le produit est un agrégateur mondial du luxe, de la mode, de la beauté et du retail, avec deux origines d’offres : publications directes Catwalks et publications externes.

## Références actuelles

- [README du projet](README.md).
- [Exploitation et état vérifié](apps/aggregator/README.md).
- [Restauration et canari du 22 septembre 2026](audits/2026-09-22/restorability-canary-final.md) : résultat final, périmètre de preuve et état de pause. L’unique ingestion autorisée a été exécutée ; le bilan n’autorise pas une nouvelle collecte.
- [Architecture produit](docs/architecture/production-foundations.md).
- [Capture native et rétention](docs/architecture/native-capture.md).
- [Faits issus des publications](docs/architecture/source-facts.md).
- [Plan de reprise et validations](audits/reprise-2026-09-15/plan.md).
- [Exploitation canari et retour arrière](docs/architecture/canary-operations.md) : worker unique, pause autoritaire, nouvelle source et répétition locale.
- [`/emplois` multilingue](docs/architecture/emplois-e2e.md) et [Golden Path nouvelle source](docs/architecture/golden-source.md).

Le code, les réponses brutes et les mesures datées doivent être vérifiés avant toute conclusion. L’ancien journal mêlait des constats historiques à des règles devenues contradictoires ; son historique reste dans Git.

Le RAW est la référence. Les interprétations restent séparées, versionnées et rejouables. Aucun métier, diplôme ou contrat universel ne doit devenir une condition de publication. Les offres Catwalks et externes gardent leurs parcours de candidature distincts.

Périmètre courant : `/emplois` et maintenabilité de l’agrégateur. `/offres`, moteur de matching et onboarding candidat restent gelés, y compris leur dette encore utilisée.

La phase avance par lots validés et audités. Le CRON, le matching et la nouvelle promesse de `/offres` restent des chantiers distincts. Aucune affirmation de préparation globale à la production sans les contrôles de release.

## Branches et coordination

- `main` est réservée à la version livrée et vérifiée en production.
- `development` porte le travail en cours ; les pushes sur cette branche sont autorisés.
- La promotion de `development` vers `main` intervient après validation de la release. Un push de développement ne vaut pas autorisation de mise en production.

Les pushes sur `development` sont autorisés dans les cinq dépôts. Aucun push sur `main` ni déploiement du site, backend, back-office ou média sans validation explicite de Loïc. L’agrégateur exige lui aussi le GO explicite de Loïc avant tout push sur `main`, déploiement, migration ou collecte de production. Un GO technique canari ne vaut pas cette autorisation.

### Transition des copies de travail

Les checkouts actuellement utilisés par Claude sont conservés tant que son travail est actif. Leur branche locale peut donc encore porter un ancien nom, y compris `main` : cela ne vaut ni validation ni autorisation de production. `development` distante reçoit les commits validés. La branche locale sera réalignée après coordination, sans perdre de fichiers modifiés ou non suivis. Le SHA réellement déployé doit être vérifié avant d’affirmer que `main` lui correspond.

Le dossier de référence est `/Users/lmelane/Downloads/catwalks-job-aggregator`, dépôt GitHub `lmelane/fr-retail-jobs`. Les copies temporaires de test restent identifiées et isolées ; aucune copie active n’est supprimée ou synchronisée pendant une validation. Préserver le travail unique avant de supprimer une branche ou un clone.

Les tests doivent couvrir les changements réels. Pour les seuls README et consignes non consommés par le runtime, vérifier le diff, les liens et les affirmations ; ne pas ajouter une nouvelle campagne globale sans modification du code. Conserver les contrôles de sécurité et de données ainsi que les hooks existants.
