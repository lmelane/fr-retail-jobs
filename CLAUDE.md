# Catwalks — entrée documentaire

Le produit est un agrégateur mondial du luxe, de la mode, de la beauté et du retail, avec deux origines d’offres : publications directes Catwalks et publications externes.

## Critère central de clôture

Une erreur INTERNAL (code, architecture, configuration Catwalks) doit être corrigée.
Une cause UNKNOWN doit être investiguée. Seules les erreurs SOURCE démontrées par
les preuves natives peuvent rester des incidents acceptés. Le contrat de statuts,
alertes et livraison est dans [le runbook V1](docs/architecture/canary-operations.md).
La validation finale se fait sur Railway ; tests ciblés et CI la précèdent.

## Références actuelles

- [README du projet](README.md).
- [Exploitation et état vérifié](apps/aggregator/README.md).
- [Canari validé le 23 septembre 2026](audits/2026-09-23/canary-delta-oh-my-cream.md) : delta egress PASS ; restaurabilité acquise, état final en pause. Le reset et le run complet ont depuis été réalisés ; l’état courant figure dans le bilan d’exploitation ci-dessous. Les preuves acquises ne sont pas à rejouer sans changement qui les invalide.
- [Runtime Railway](docs/architecture/railway-runtime-reset.md) : nouvelle API publique, anciens services retirés, le [bilan post-RUN](audits/2026-09-23/post-run.md) distingue la version livrée, les corrections et leur validation. Le RUN quotidien est configuré à 18 h Europe/Paris, avec changement d’heure pris en charge ; les images, SHA et preuves effectives figurent dans le reçu de release.
- [Qualification des sources du 23 septembre](audits/2026-09-23/source-qualification.md) : résultats production, couverture multilingue, limites Aesop/L’Oréal et recouvrement SAP/LVMH.
- [Architecture produit](docs/architecture/production-foundations.md).
- [Capture native et rétention](docs/architecture/native-capture.md).
- [Faits issus des publications](docs/architecture/source-facts.md).
- [Audit RAW des rejets d’identité du 24 septembre](audits/2026-09-24/employer-raw-audit.md) : preuves manquées, conflits, clients non nommés et publications invalides ; la politique V1 sans employeur identifié reste indécise.
- [Plan de reprise et validations](audits/reprise-2026-09-15/plan.md).
- [Exploitation canari et retour arrière](docs/architecture/canary-operations.md) : worker unique, pause autoritaire, nouvelle source et répétition locale.
- [`/emplois` multilingue](docs/architecture/emplois-e2e.md) et [Golden Path nouvelle source](docs/architecture/golden-source.md).

Le code, les réponses brutes et les mesures datées doivent être vérifiés avant toute conclusion. L’ancien journal mêlait des constats historiques à des règles devenues contradictoires ; son historique reste dans Git.

Le RAW est la référence. Les interprétations restent séparées, versionnées et rejouables. Aucun métier, diplôme ou contrat universel ne doit devenir une condition de publication. Les offres Catwalks et externes gardent des suites de candidature distinctes : candidature interne pour l’une, site carrière de la Maison pour l’autre. D-447 §4 et D-450 §2 et §3 (24/09) ont décidé qu’un visiteur non connecté créera un compte et suivra tout le parcours d’inscription, onboarding compris, avant l’une comme l’autre, puis continuera chez la Maison par un bouton, sans redirection automatique : décidé, non implémenté (au commit `7ec15ca` du site, le lien externe est libre).

Lot livré : audit et correction post-RUN, depuis les RAW, SourceRun et logs de production. Le worker entretient accès et qualification native par les mécanismes existants. Les migrations non destructives nécessaires au correctif passent par development → main → CI → Railway ; aucun reset ni réparation des données historiques. Les validations de production restent ciblées, sans nouveau RUN complet. `/emplois`, marchés/filtres et Direct Offers ne sont pas refondus dans ce lot, qui ne touche ni `/offres`, ni le moteur de matching, ni l’onboarding candidat, y compris leur dette encore utilisée.

Les évolutions restent validées par des tests ciblés. Le CRON chargé est 18 h Europe/Paris, une fois par jour ; son reçu est dans `docs/operations/railway/runtime-release.json`. Le code de production vérifié le 24 septembre est `c62a534` pour l’API de catalogue et `2cc91d8` pour le worker, inchangé dans le lot de localisation ; les commits de documentation et preuves suivants ne reconstruisent pas les images. Les incidents de sources sont isolés. Les décisions du 24 septembre fixent la suite de `/offres`, du matching et de l’onboarding, sans être implémentées. `/offres` n’aura pas de promesse propre : `/emplois`, `/offres` et `/mes-jobs` reposeront sur une seule page Emploi (D-447 §3) et `/offres/*` redirigera en 301 vers `/emplois` à la sortie du site (D-446 §3). Des préférences de recherche, dans le vocabulaire de `/emplois`, remplaceront le matching (D-447, D-448 §4). Seul geste exécuté : la vague d’e-mails `MASTER_JOB_MATCH_01` a été arrêtée le 24/09 à 19:23:30 UTC (D-448 §1). Le digest reste tel quel jusqu’aux alertes sur recherches sauvegardées (D-449 §1) et D-451 ferme l’acquisition du vivier par e-mail. La sortie se fera d’abord en français, avec l’onboarding existant pour tous ; l’onboarding international suivra en lot dédié (D-449 §2). Restent à instruire : la purge des données de matching, la garde « prête pour le matching » (D-401) et le retrait des règles R-118, R-82 et R-83 (D-451). D-448 lève le gel du groupe `(candidat)` pour ce lot, mené sur `development` du site. État détaillé : `docs/architecture/production-foundations.md`, section 1. Ne pas relancer les protocoles déjà acquis sans changement qui les invalide.

## Recherche V1 livrée côté agrégateur

La [recherche métier, mot-clé ou Maison](docs/architecture/recherche-semantique.md) retient **PostgreSQL enrichi pour V1**, après le challenger linguistique Elasticsearch et la [validation Railway](audits/2026-09-24/search-railway.md). La mesure initiale portait sur `f10e1f2`, 90 migrations et 76 096 documents. Le contrôle après correctif `2cc91d8` observe 76 097 documents et `pending=0`. Sur 300 recherches : p95 384 ms au repos / 400 ms pendant publications réelles. Ce relevé borné ne certifie pas la charge mondiale. Les images sont immuables ; les commits d'outillage et preuves suivants ne changent pas le runtime. Le site `/emplois`, ses langues natives et le retrait du sélecteur Métier restent sur `development`. Loïc a explicitement rappelé le gel du site le 24 septembre ; un GO agrégateur ne vaut jamais GO site. Les anciens filtres URL restent visibles et retirables.

Les secteurs utilisent le circuit SectorReview existant et des preuves officielles relues avec abstention. Six règles initiales ne constituent pas une couverture complète. Aucun appel IA par offre ou requête. La recherche ne dépend jamais d’un code métier ou secteur. Toute correction UI utilise le skill Catwalks. Direct Offers : D-444 (24/09) a décidé que l’agrégateur relira toutes les 5 minutes la liste publique du backend, sans le flux d’outbox ni aucun changement du backend, de Neon ou de Vercel côté backend ; non implémenté, 0 `DirectOffer` en production au 24/09 (détail dans `docs/architecture/recherche-marche.md`). `/offres`, matching et onboarding : voir plus haut. Aucun déploiement du site sans GO explicite.

## Branches et coordination

Précision du 24 septembre : retirer un mécanisme seulement après inventaire de
ses consommateurs, remplacement et tests défensifs. La suppression aveugle des
anciens chemins peut casser `/offres`, matching, facettes ou reprise des RAW.
Le GO de promotion vers `main` de l’agrégateur porte sur le chantier agrégateur
validé ; il ne vaut pas GO site et ne transforme pas les corrections locales
encore non qualifiées en release de production.
L'arbitrage V1 est **PostgreSQL unique au runtime**. Le challenger ES, son outillage et son runtime local sont retirés ; les seuils entraînent une nouvelle mesure PostgreSQL. Les seuils de `apps/api/scripts/search-benchmark/guard-policy.json` déclenchent une nouvelle mesure ; suivi de cette tâche toutes les six heures, dépendant de Codex local. Les métriques absentes restent inconnues. Aucune bascule automatique ni prétention à couvrir toute la croissance mondiale. Le GO recherche ne clôture pas les qualifications d'identité encore ouvertes dans l'audit RAW.

- `main` est réservée à la version livrée et vérifiée en production.
- `development` porte le travail en cours ; les pushes sur cette branche sont autorisés.
- La promotion de `development` vers `main` intervient après validation de la release. Un push de développement ne vaut pas autorisation de mise en production.

Les pushes sur `development` sont autorisés dans les cinq dépôts. Aucun push sur `main` ni déploiement du site, backend, back-office ou média sans validation explicite de Loïc. Le GO de Loïc couvre la livraison et l’exploitation normale de l’agrégateur décrites dans le bilan courant, y compris sa promotion vers `main`. La mission post-RUN autorise les correctifs génériques, leurs migrations non destructives versionnées, la CI et la livraison de l’agrégateur. Aucun reset, réparation historique ou déploiement des autres produits n’est inclus. Ce GO ne couvre pas les gestes de production de D-444 (promotion de l’agrégateur portant les offres directes, nouveau service Railway `catwalks-direct-sync`, sa surveillance) : chacun part sur GO explicite, jamais pendant le RUN de 18 h.

### Copies de travail

Le checkout de référence de l’agrégateur travaille sur `development` ; Git n’enregistre qu’un worktree pour ce dépôt, avec les branches locales `development` et `main`. Le SHA du code réellement déployé est attesté dans le reçu de release ; les commits de documentation ne reconstruisent pas les images. Préserver toute copie utilisée par un autre agent ou processus et tout travail unique avant une opération de nettoyage.

Le dossier de référence est `/Users/lmelane/Downloads/catwalks-job-aggregator`, dépôt GitHub `lmelane/fr-retail-jobs`. Les copies temporaires de test restent identifiées et isolées ; aucune copie active n’est supprimée ou synchronisée pendant une validation. Préserver le travail unique avant de supprimer une branche ou un clone.

Les tests doivent couvrir les changements réels. Pour les seuls README et consignes non consommés par le runtime, vérifier le diff, les liens et les affirmations ; ne pas ajouter une nouvelle campagne globale sans modification du code. Conserver les contrôles de sécurité et de données ainsi que les hooks existants.

## Localisation publique et filtres (24 septembre)

Le lot pays/langues remplace les anciens profils « localisé / repli anglais » par un registre unique de 41 marchés natifs, avec 25 catalogues d’interface API/site. Les mesures historiques quittent le runtime. La nature d’emploi regroupe contrat, programme et indépendant dans un menu ; le temps de travail reste distinct. Le détail et la procédure d’ajout sont dans `docs/architecture/recherche-marche.md` et le README du site. La priorité des offres Catwalks, leurs candidatures, les faits RAW, les périmètres GB+IE/DE+AT et les parcours du groupe `(candidat)` restent inchangés par ce lot. Le GO de Loïc couvre la promotion vers `main` de la seule partie agrégateur de ce lot : l’API `c62a534`, livrée le 24 septembre (reçu dans `docs/operations/railway/runtime-release.json`) ; aucune migration ni collecte n’est requise. La partie site (catalogues, `/emplois`, sélecteur) reste sur `development` du site : aucun push sur `main` ni déploiement du site sans GO site explicite de Loïc.
