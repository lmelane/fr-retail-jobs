# Préparation au déploiement — constat du 22 septembre 2026

**Constat initial, avant correctifs PR-1.** Le [bilan PR-1](pr1-canary-readiness.md) fait foi pour le canari borné ; le flux direct est désormais explicitement hors de son périmètre.

**NO-GO technique au moment de ce constat.** Rapport de préparation uniquement : aucune migration, collecte, modification de configuration, livraison, fusion ou écriture en production. Aucun bloc fonctionnel gelé n’est rouvert.

## État

| Bloc | État |
|---|---|
| Fresh install | **PASS** — Golden Path sur base créée vide et migrations CI sur PostgreSQL neuf |
| Migrations agrégateur | **PASS au préflight** — 85 appliquées sur la cible, 86 attendues ; aucune migration inachevée/inconnue ni dérive de checksum ; seule Douglas reste à appliquer |
| API | **BLOCKED** — CI API rouge sur un test d’intégration obsolète |
| Aggregator | **BLOCKED** — commande Railway de campagne encore en place ; parcours opérationnel d’ajout neuf à fermer |
| Website `/emplois` | **BLOCKED** — dépend de l’API validée et du flux backend des offres directes, absent de production |
| Railway/CRON | **BLOCKED** — configuration de campagne résiduelle, ancien reconcile, absence de job direct-sync |
| Object storage | **BLOCKED pour l’archivage S3** — variables absentes ; non bloquant pour le canari en stockage PostgreSQL actuel |
| Observabilité | **BLOCKED pour l’exploitation** — journaux et healthcheck présents, mais alertes et heartbeat retirés par la commande effective du worker |
| Rollback | **BLOCKED** — versions de retour identifiées, procédure de retour de cette release non répétée |
| Ajout nouvelle source sans étape manuelle cachée | **FAIL en exploitation Railway actuelle** — CLI complète disponible ; le runner déployé sélectionne seulement les sources ACTIVE |

## Blocages réels à lever

1. **CI API** : [exécution 35769769225](https://github.com/lmelane/fr-retail-jobs/actions/runs/35769769225), 259 tests verts et 1 rouge. `apps/api/lib/__tests__/perimetre-marche.test.ts:135` attend encore `langueDesLibelles: fr` et `Autriche` pour DE ; le produit validé sert désormais l’allemand. Aligner ces attentes sur le contrat validé et obtenir une CI verte, sans changer le runtime. Ce test PostgreSQL faisait partie des tests non exécutés par la commande locale sans base d’intégration. Le job CI agrégateur, y compris migrations, types, tests et audit des dépendances, est vert.
2. **Commande effective Railway** : `catwalks-aggregator` démarre encore `campagne-railway.sh` sur quatre anciennes clés, avec `CAMPAGNE_INGEST=1`, sans Brevo ni heartbeat. Cette commande contourne `start.sh`, donc `PIPELINE_PAUSED=1` ne l’arrête pas. La neutraliser explicitement AVANT toute livraison automatique. Le calendrier sentinelle ne protège pas d’un démarrage de déploiement. Garder `reconcile` désactivé : sa commande générale n’existe plus dans la CLI.
3. **Ajout réellement neuf** : `register` crée DRAFT ; `source-campaign-candidates.sql` ne sélectionne que ACTIVE. Le runner Railway ne couvre donc pas, seul, l’entrée d’un nouveau candidat. Préparer une exécution bornée prenant le dossier candidat explicite et utilisant directement `source-campaign.mts --keys=... --limit=1 --reviewer=... --ingest`, avec rapports persistés et verdict bloquant. Aucun passage manuel DRAFT → ACTIVE, aucune insertion SQL ad hoc. Éprouver ce chemin dans l’image cible avant son canari autorisé. Les qualifications doivent porter le SHA réellement déployé (`RAILWAY_GIT_COMMIT_SHA`), pas une empreinte locale ni un SHA pré-fusion.
4. **Offres directes** : le backend de production ne contient pas `/api/catalogue/flux`. Sa clé `CATALOGUE_FLUX_KEY` est absente ; le worker n’a ni `CATALOGUE_FLUX_URL` ni `CATALOGUE_FLUX_KEY`, ni job de synchronisation. La migration backend `20260916170000_catalogue_outbox_d423` et le flux version 1 existent sur development, compatibles avec le consommateur version 1. Leur release séparée doit être validée avant de livrer la coexistence des deux origines. Ne pas promouvoir aveuglément tout le backend avec ses autres changements.
5. **Exploitation/retour arrière** : restaurer une commande normale surveillée, puis répéter le retour des versions et des configurations sur une copie isolée. Les scripts de sauvegarde/restauration existent ; ce n’est pas une preuve de rollback de cette release. Ne pas envoyer une alerte ou activer un CRON dans cette phase de lecture seule.

## Ordre de livraison proposé — seulement après autorisation explicite

1. Fermer les blocages ci-dessus et figer les SHA des trois livraisons compatibles. Répéter migration et rollback sur copie ; conserver les versions, variables privées et commandes antérieures. Les services Railway suivent actuellement `main` : un merge peut déclencher plusieurs déploiements et la migration API automatiquement. Contrôler ce déclenchement avant toute promotion.
2. Neutraliser la commande de campagne et maintenir tous les workers/CRON gelés. Sauvegarder la cible et prouver la restauration. Aucune purge du catalogue n’est nécessaire pour cette release.
3. Livrer l’API : son hook existant exécute `prisma migrate deploy`, puis son healthcheck `/api/health` exige les noms et checksums du build. La seule migration agrégateur en attente ajoute `brandProperty` à Douglas ; **aucun DROP ni retrait de colonne**. Source présente avec famille/origine attendues et clé absente : préconditions satisfaites. Le changement crée une nouvelle révision de source, à requalifier normalement.
4. Livrer le worker sur le même SHA que l’API, toujours gelé ; vérifier commandes, variables et absence de run inattendu. Livrer séparément le backend/outbox après validation de ses propres migrations, poser la clé de flux partagée et préparer `direct-sync`. `start.sh` n’accepte pas actuellement `PIPELINE_CMD=direct-sync` : un job borné explicite est nécessaire, sans détourner `reconcile`.
5. Exécuter, uniquement après autorisation, le canari d’une source via le tooling courant sous le SHA livré, deux ingestions et rejeux ; vérifier les fins, l’absence de doublons et la lecture API. Synchroniser les offres directes et vérifier le curseur/contrat. Ne pas réactiver une collecte générale pour prouver ce canari.
6. Livrer website en dernier, avec l’URL et la clé API concordantes ; smoke tests des deux parcours de candidature et CA/CH/BE. Les cadences ingestion, refresh, direct-sync et rétention restent un plan de jobs distinct ; aucune activation implicite.

## Variables et stockage

| Service | Constat / prérequis |
|---|---|
| API Railway | DATABASE_URL, CATALOGUE_API_KEY, NODE_ENV présents ; clé non vide ; requêtes authentifiée `/api/jobs?marche=FR` et `/api/health` : HTTP 200 sur la version actuelle |
| Website Vercel | EMPLOIS_API_URL et CATALOGUE_API_KEY présentes en production, sensibles ; égalité de leurs valeurs non certifiée par le listing, à vérifier par smoke test après livraison |
| Worker / refresh | DATABASE_URL et pause présentes ; périmètre, commande normale et canaux de surveillance à remettre explicitement ; aucune nouvelle variable nécessaire au parsing Douglas |
| Flux direct | CATALOGUE_FLUX_URL et CATALOGUE_FLUX_KEY à fournir au consommateur ; même clé au backend |
| Archive S3 | OBSERVATION_ARCHIVE_S3_ENDPOINT, REGION, BUCKET, ACCESS_KEY_ID, SECRET_ACCESS_KEY et PREFIX absentes des workers ; FORCE_PATH_STYLE facultative |

Le stockage chaud est `RawBlobBody` dans PostgreSQL. La cible n’a **aucune référence `RawBlobArchive` ni dépendance froide** ; le code sait capturer et rejouer sans S3. Il serait faux d’affirmer qu’un bucket manque pour la première ingestion. Le raccordement et la validation S3 ne deviennent obligatoires qu’avant une politique d’archivage/purge des corps chauds ; aucun nouveau chantier de stockage n’est ouvert ici.

## Retour arrière et références exactes

Production lue : Railway API/aggregator/refresh/reconcile **0f22b49e** ; website **bccf5412** ; backend **63f61fa2**. Candidats : agrégateur/API **3fa42d1**, website **76ddcb0**, backend development **92a29a7** (dépendance, pas une release globalement validée).

Retour prévu : regeler les écritures, revenir au website précédent puis à l’API/worker précédents en conservant les données. Prisma ne possède pas de migration descendante automatique. Si la configuration Douglas doit aussi revenir, préparer une compensation ciblée sur l’état sauvegardé, suivie d’une requalification sous le lecteur de retour ; ne pas supprimer une ligne de `_prisma_migrations` pour simuler un rollback. Une restauration de base n’est acceptable qu’après examen des écritures postérieures, afin de ne pas les perdre.

Le rapport de release du 16 septembre ne décrit plus la cible actuelle : les anciennes 33 migrations en attente sont déjà appliquées. Le constat présent repose sur les métadonnées Railway/Vercel, la CI, le journal SQL lu dans une transaction READ ONLY et les chemins de code cités. Aucun audit supplémentaire du corpus d’offres n’a été mené.

**NO-GO TECHNIQUE POUR UN DÉPLOIEMENT — ce constat n’autorise aucune action sur main ou production.**
