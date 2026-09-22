# PR-1 — préparation technique du canari, 22 septembre 2026

**GO TECHNIQUE CANARI, limité à l’agrégateur et `/emplois`.** Ce verdict clôture les corrections locales de PR-1. Il ne constitue ni une validation de production globale, ni une autorisation de déploiement. `main` et la production sont intactes. Le remplacement de la commande Railway, la livraison et la collecte réelle Railway attendent le GO explicite de Loïc.

Ce bilan remplace, pour le périmètre canari, le [NO-GO précédent](production-readiness.md). `/emplois` V1 et Golden Path restent acquis ; aucune nouvelle campagne d’audit des données.

## Révisions et validations

- Code et lock testés : **9445599739f713fa5af987b24cd2114f5b1fe344**, poussé sur `development`.
- [CI complète verte](https://github.com/lmelane/fr-retail-jobs/actions/runs/35778156834) : agrégateur et API, installations neuves, migrations, types, tests, audit des dépendances high/critical et build API.
- Validation locale depuis une copie exacte, isolée du checkout partagé : **2 853 unitaires + 588 intégration agrégateur ; 260 API ; 19 subprocess de pause ; 22 Python**, tous PASS. Le conteneur PostgreSQL jetable de la suite est supprimé par le lanceur.
- La copie reçoit les métadonnées Git de la même révision pour les tests de préflight qui exigent réellement un dépôt. Les archives de rollback sont installées et construites depuis leurs locks ; aucun fichier non suivi du checkout actif n’y entre.
- Les exports CSV et travaux non suivis du développeur sont préservés. Les caches Python produits pendant ce lot peuvent être régénérés et sont retirés après contrôle.

| Bloc | Verdict | Preuve et portée |
|---|---|---|
| Fresh install | **PASS** | 86 migrations sur bases neuves, local et CI |
| Migrations | **PASS** | Ancienne version à 85 → candidate à 86 ; Douglas modifie la configuration et crée une révision ; checksums précédents conservés |
| CI API | **PASS** | 260 tests avec PostgreSQL, types et build ; seules les attentes DE ont changé (`de`, `Österreich`) |
| Worker / pause | **PASS** | Vrais entrypoints stoppés avant fichiers métier/DB/réseau ; garde aux frontières de collecte, commandes bornées et pilotage Railway |
| Nouvelle DRAFT sans manuel | **PASS** | `worker source-add` → registre DRAFT → preuves/portes existantes → ACTIVE → ingestion ; aucun SQL/status manuel |
| `/emplois` | **READY** | V1 multilingue conservée ; lecture du nouveau corpus sans aucune offre directe ; aucune modification du runtime API/UI |
| Railway / CRON | **READY pour livraison autorisée** | Commande normale et ordre de bascule documentés ; tous les services déployés restent volontairement anciens et en pause ; calendriers gelés |
| Observabilité | **READY** | Runs/événements persistés, dernière collecte, erreurs et signal de vie ; statut lisible ; alertes/heartbeat conservés ; tests des pings sans émission externe |
| Rollback rehearsal | **PASS** | Démarrages HTTP réels ancienne/candidate/ancienne, toutes les pages et une fiche comparées ; base conservée, worker en pause |
| Direct offers | **HORS CANARI** | `DirectOffer=0` dans les témoins ; aucun travail backend, `/offres` ou matching |
| S3 | **NON BLOQUANT CANARI** | Rollback et collecte réalisés sans variables S3 ; RAW chaud PostgreSQL ; stockage froid au backlog |
| Nouvelle source sans opération manuelle cachée | **PASS** | Commande typée d’une seule source, dossier généré, verdict bloquant et journal durable |

## Ce qui a été corrigé

Un worker commun remplace la commande de campagne résiduelle. `PIPELINE_PAUSED=1` est prioritaire, une valeur invalide refuse le lancement. La pause est celle de l’environnement du processus : arrêter/redémarrer un conteneur déjà lancé reste nécessaire pour lui appliquer un changement distant. Les commandes bornées conservent les canaux de surveillance et signalent les échecs partiels. Le pilotage Railway refuse une exécution lorsque la pause distante n’est pas exactement `0`.

Le lancement `source-add` reçoit une définition publique explicite, réutilise la qualification actuelle et ingère ensuite par le CLI normal. Le runner général reste ACTIVE uniquement. PAUSED/RETIRED, options vides/inconnues, périmètres manquants et configurations divergentes ne sont pas transformés en autorisation. Aucun changement des règles d’accès, d’identité, GEO, marchés ou facettes.

Cinq anciens lanceurs sont supprimés : `campagne-railway.sh`, `collecte-massive.sh`, `qualification-massive.sh`, `source-requalify.sh`, `enregistrer-source.mts`. La campagne maintenue rend un échec pour un verdict refusé ou une ingestion partielle, attend le drainage des journaux enfants, n’utilise plus de reprise par ancien fichier de verdict et persiste ses décisions opérationnelles.

Le signal de vie est enregistré toutes les 30 secondes. `worker-status.mts` lit les derniers runs, incidents et captures ; un ancien RUNNING sans signal récent est UNVERIFIED. Les événements de pause passent par le logger commun avant ouverture de la DB. Les erreurs du préflight worker déclenchent aussi le chemin heartbeat d’échec.

## Golden Path opérationnel — données réelles, base neuve

- Base locale dédiée : `catwalks_golden_source_test_1790107697403_729f6d`.
- Lecteur : `local-sha256:47a54a1e6dace7021dd3a933fe175bd5f30641fb9bf60dab0b454d50b9b6dc1a`.
- Oh My Cream : **23 créées**, puis **0 créée / 23 mises à jour**, zéro erreur et mêmes identifiants.
- Identité VERIFIED, accès ALLOWED, captures scellées, rejeux natifs exacts, deux admissions et deux fins attestées.
- API : **21 FR** ; les **2 pays inconnus** ne sont pas artificiellement localisés. Aucun flux direct présent.
- Refresh seulement lu : 23 PRESENT_AND_REATTESTED, zéro fermeture proposée ; aucune fermeture appliquée.
- Trois runs COMPLETED (campagne et deux ingestions), verdict de qualification durable, événements de début/fin/heartbeat ; **36 corps RAW chauds, zéro archive froide**.

Preuves privées : `/Users/lmelane/.catwalks/pr1-golden-final-20260922/proof.json` et `/Users/lmelane/.catwalks/readiness-20260922/pr1-final-observability.json`. Journaux privés de chaque étape conservés hors Git.

## Retour arrière réellement exécuté

Base locale dédiée : `catwalks_rollback_test_1790107630990_c33515`. Avant : code **0f22b49e**, 85 migrations, fixture Douglas enregistrée par le registre. Candidate : **9445599**, 86 migrations, configuration Douglas corrigée, nouvelle révision. Une collecte réelle crée 23 offres ; 21 sont lisibles en FR.

Après retour à l’ancienne API **0f22b49e**, healthcheck et liste authentifiée répondent 200, les offres complètes de toutes les pages et une fiche restent identiques. Le snapshot contrôlé de la base est inchangé : migrations, révisions/configurations des sources, identifiants/états des offres, nombre de RAW et fins d’ingestion. Les deux workers sont testés en pause.

C’est un **rollback applicatif avec base forward-compatible** : aucune suppression de migration ni downgrade. La modification Douglas est conservée. Les anciennes preuves ne sont pas recopiées pour autoriser une reprise sous l’ancien lecteur. Aucun S3 n’est configuré pendant cette répétition.

Preuve privée : `/Users/lmelane/.catwalks/pr1-rollback-final-20260922/proof.json`. Le [runbook maintenu](../../docs/architecture/canary-operations.md) fournit la commande de répétition et le plan d’exploitation. Les répétitions intermédiaires devenues inutiles sont supprimées ; leurs bilans restent conservés.

## Production relue, jamais modifiée

Les quatre services Railway sont toujours SUCCESS sur **0f22b49eb65ea8d6bf98a183e078276fa47c8b9e** ; `main` reste ce même SHA. Les trois workers ont `PIPELINE_PAUSED=1`, calendrier `0 0 29 2 *`, aucune allowlist dans les variables de service. L’override agrégateur contient encore les anciennes quatre clés et le script supprimé : **le remplacer sous pause avant la livraison**, comme prévu au runbook. L’ancien service reconcile reste gelé.

Les secrets Brevo et heartbeat de l’agrégateur sont présents et non vides ; leurs valeurs ne sont ni affichées ni versionnées. La candidate les conserve, contrairement à l’override historique. Le ping réel depuis Railway sera une vérification du canari autorisé. Les credentials API sont présents ; API prod health et lecture authentifiée étaient verts au préflight. La seule migration en attente reste Douglas ; aucune DDL supplémentaire n’a été introduite dans PR-1.

Les fichiers gelés du matching agrégateur et de `/offres` website sont identiques à leurs empreintes de référence. Website reste **76ddcb0** sur development. Aucun push sur les autres dépôts.

## Prochaine étape, après GO explicite

Canari d’une seule source, cron gelé et observation active : remplacement de l’override → sauvegarde/restauration vérifiée → livraison candidate et migration API → contrôles sous pause → exécution bornée autorisée → preuves + lecture `/emplois` → retour en pause. Aucun refresh automatique, aucun passage global en production. La qualification courante doit être produite sous le SHA effectivement livré ; les preuves locales ne sont pas importées comme autorisations Railway.

Ce lot ne valide pas une image Railway déjà livrée, l’émission réelle des alertes depuis ce conteneur, le stockage froid, l’ensemble des sources, les cadences CRON ni le flux direct. Ces limites sont explicites ; elles ne rouvrent ni le produit V1 accepté, ni `/offres`/matching.
