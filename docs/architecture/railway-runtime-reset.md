# Reset du runtime Railway — cible proposée

**23 septembre 2026 — PLAN, NON APPLIQUÉ.** La décision courante remplace le passage immédiat au ramp-up : reconstruire l'exécution Railway, conserver PostgreSQL intégralement. Le canari `72300c9` reste historiquement validé. Aucun service n'a été créé, modifié, redémarré ou supprimé pour établir ce plan ; aucune requête SQL de production n'a été exécutée.

La [cible structurée](../operations/railway/runtime-target.json) décrit le résultat attendu. Elle n'est pas encore un fichier exécutable de provisionnement. Le [relevé réel](../../audits/2026-09-23/railway-runtime-inventory.json) contient les identifiants, déploiements, décisions pour les **33 affectations de variables** des quatre services et empreintes des sauvegardes privées. Ne pas confondre configuration proposée, configuration distante et environnement effectivement chargé dans un processus.

## 1. État sauvegardé et dérives constatées

Export privé : `/Users/lmelane/.catwalks/runtime-reset-20260923/snapshot-20260923T044617Z/`. Dossier mode `0700`, fichiers `0600`, secrets hors Git. Sont conservés : configuration déchiffrée, variables effectives du plan de contrôle, métadonnées des variables, commandes, build, calendrier, politiques, domaines, source Git, métadonnées du dernier déploiement et digest, références des volumes, environnements et propriété IaC. `manifest.json` vérifie les empreintes. Ce n'est pas un nouveau dump de la DB.

Le projet possède cinq services en production : PostgreSQL et quatre runtimes. L'autre environnement, `capture-validation-20260915`, ne contient actuellement aucun service ni volume. Aucune propriété IaC n'est déclarée. Les quatre runtimes indiquent `72300c97586955536ee1f89b0a9b7b0273fbf8a9` ; leurs images ont des digests distincts. Le statut Railway `SUCCESS` ne prouve pas à lui seul qu'un processus de worker est vivant.

| Constat vérifié | Décision cible |
|---|---|
| Les trois workers gardent `RAILWAY_RUN_COMMAND`, avec `prisma db push --accept-data-loss` puis une commande npm | Supprimer l'override et refuser sa réintroduction. **Chaînes résiduelles stockées, pas preuve d'exécution ni cause établie des anomalies historiques.** |
| `PIPELINE_CMD=reconcile`, commande absente du worker courant | Ne pas recréer ce service ; aucun nouveau moteur de réconciliation |
| Les trois CRON valent `0 0 29 2 *` : prochain déclenchement le 29 février 2028 | `cronSchedule: null`, aucun calendrier de substitution |
| `EGRESS_PROBE=0` sur l'agrégateur, mais code et appel de la sonde toujours présents | Retirer sonde, appel et variable ; variable explicitement interdite |
| L'API lance `startPipelineDeadman()`, sans tenir compte de la pause | Remplacer cette surveillance par un moniteur indépendant connaissant les fenêtres d'exécution ; retirer le timer et ses secrets de l'API |
| L'API applique automatiquement `prisma migrate deploy` en pré-déploiement | Aucun hook de migration dans les services cibles ; readiness en lecture seule |
| `Mode Careers` comme expéditeur, `https://modecareers.com` comme URL site de l'API | Identité opérationnelle Catwalks ; URL `https://catwalks.io`, déjà utilisée comme fallback par le code. Aucun changement du domaine du front ni des marchés |
| Domaines publics sur les trois workers, build déterminé par variable, source Git `main` avec autodeploy | Aucun domaine worker ; images immuables, livraison explicite ; configuration de build versionnée |
| Heartbeat configuré seulement sur l'agrégateur ; absence de configuration tolérée par le code | Heartbeat obligatoire pour le nouveau worker et contrôle indépendant, erreur observable si absent |

Le plan de contrôle ne donne pas ici un nombre exploitable de changements en attente (`unmergedChangesCount: null`). Une relecture fraîche et le contrôle d'absence de changements concurrents seront obligatoires avant toute application.

## 2. Deux nouveaux runtimes ; PostgreSQL conservé

| Service cible | Commande | Pause / CRON | Santé / redémarrage | Dépendances |
|---|---|---|---|---|
| `catwalks-catalogue-api` | `node apps/api/runtime/start.mjs` **à implémenter** : contrôle de configuration puis serveur standalone existant | Pas de collecte ; aucun CRON | `/api/health`, 120 s ; `ON_FAILURE`, 3 reprises ; sonde HTTP externe | PostgreSQL privé, clé catalogue |
| `catwalks-ingestion-worker` | `sh apps/aggregator/start.sh`, entrée existante **à durcir** | `PIPELINE_PAUSED=1`, CRON absent | événement de pause, signaux de run et heartbeat indépendant ; `NEVER` | PostgreSQL privé, Healthchecks, Brevo |
| **Postgres existant** | Configuration inchangée | Inchangé | Inchangé | **Service, volume, image, schéma, données et accès conservés** |

Les deux runtimes : une réplique, région `europe-west4-drams3a`, aucun volume, aucun pré-déploiement, pas de mise en sommeil ni d'autodeploy Git/image. L'API conserve le domaine public **`agregator.catwalks.io`**, port 8080, et la clé catalogue existante. Le worker n'expose aucun port public. Son arrêt après une exécution est normal : pas de processus permanent artificiel ni de redémarrage automatique qui rejouerait une ingestion.

**Ressources de production exclues de toute gestion/destruction par ce reset :**

- Projet : `0eae47d0-598d-4cf0-bb3f-b38921eafa7e` ; environnement : `e66b019c-d280-41dc-85d8-25ed86bdd101`.
- Service Postgres : `b5c68d1c-6988-4f15-8d85-afe684109cea`.
- Volume : `32f92d01-d465-42e6-8fab-79e17d0a4d3f`, montage `/var/lib/postgresql/data`.

Aucune rotation de credentials DB, création de rôle, migration, réparation, purge ou reconstruction de la production dans ce lot. La seule écriture métier ultérieure sera l'ingestion Oh My Cream autorisée, avec ses captures et traces habituelles. « Conservation de la DB » ne signifie pas interdire les écritures normales du canari.

### Variables et secrets attendus

| Service | Variables non secrètes | Secrets / références privées |
|---|---|---|
| API | `NODE_ENV=production`, `HOSTNAME=0.0.0.0`, `PORT=8080`, `NEXT_PUBLIC_SITE_URL=https://catwalks.io`, `CATWALKS_RUNTIME_PROFILE` | `DATABASE_URL`, `CATALOGUE_API_KEY` |
| Worker | `NODE_ENV=production`, `PIPELINE_PAUSED=1`, `BREVO_SENDER_NAME=Catwalks`, `CATWALKS_RUNTIME_PROFILE` | `DATABASE_URL`, `HEALTHCHECK_PING_URL`, `BREVO_API_KEY` ; références privées explicites `BREVO_SENDER_EMAIL`, `ALERT_EMAIL` |

`CATWALKS_RUNTIME_PROFILE` sélectionne l'un des profils versionnés, jamais un script arbitraire. Les références privées sont injectées sans exposer leurs valeurs dans Git ou les journaux. Le domaine et le check de validation sont indépendants de la production ; aucune credential de DB de production sur le clone. Le partage de credentials d'alerte éventuel doit être explicite, avec checks et destinataires de test identifiés.

`NEXT_PUBLIC_SITE_URL` doit aussi être fixé et vérifié **au build Next.js**, car une valeur publique peut être incorporée dans les bundles : une variable changée au runtime ne prouve pas que le rendu a changé. Aucun secret DB ou catalogue dans les arguments de build.

Les migrations attendues (`CATWALKS_SCHEMA_MIGRATIONS`) sont un artefact du build API existant, pas une variable à recopier manuellement depuis Railway. Les paramètres internes non surchargés restent ceux du code au SHA figé : pas de recopie de toutes les options des adaptateurs en variables Railway. Les variables injectées par Node, l'image et Railway sont relevées séparément, classifiées et contrôlées ; **aucune exemption globale `RAILWAY_*`**, qui réautoriserait précisément l'ancien override.

Pas de secrets S3, Google Indexing ou Direct Offers ajoutés : ces dépendances ne sont pas nécessaires à ce runtime borné. Leur absence n'autorise pas la suppression de code métier encore utilisé ailleurs.

### Exécutions bornées, sans nouveau moteur d'ingestion

La pause devient obligatoire et explicite à l'entrée du runtime Railway : absente ou invalide = refus. Retirer le repli silencieux vers `ingest-all` et l'interprétation de `PIPELINE_CMD`. Le CLI, les adaptateurs, le registre et les contrôles d'ingestion existants restent le chemin commun.

Quatre profils : `validation-paused`, `validation-ohmycream`, `production-paused`, `production-ohmycream`. Chaque profil fixe la commande, la pause, le rattachement DB et les hôtes métier. Pour le seul profil canari :

```text
sh apps/aggregator/start.sh ingest --source=oh-my-cream --no-geocode
PIPELINE_PAUSED=0
Hôte métier autorisé : careers.ohmycream.com
Maximum : 1 lancement, fenêtre de 15 minutes
Retour obligatoire : profil paused du même environnement
```

L'outil de lancement produit le manifeste résolu (SHA, digest, profil, ID déploiement, échéance et run), interdit un lancement concurrent et n'effectue aucune relance automatique. Le garde compare l'argv réel au profil ; un argument ou hôte supplémentaire est refusé. Le délai borne l'exécution et son moniteur externe. Un run interrompu reste observable, sans prétendre annuler des écritures déjà validées.

Contrôler les hôtes **avant** le transport, y compris les redirections ; prouver la couverture des transports empruntés par Oh My Cream. Les tests négatifs n'émettent aucun appel métier réel hors périmètre. Le contrôle applicatif n'est pas présenté comme un pare-feu réseau Railway. Les futurs adaptateurs utilisant d'autres transports devront satisfaire le même contrôle avant ramp-up. Les appels PostgreSQL, Healthchecks et Brevo sont des dépendances opérationnelles distinctes des hôtes métier ; pas de diagnostic vers une source tierce ou un service d'IP publique.

## 3. Configuration versionnée et effectivement chargée

Utiliser le mécanisme Railway **Infrastructure as Code** avec un périmètre nommé `catwalks-runtime`, propriétaire des deux nouveaux runtimes seulement. Ne pas importer aveuglément l'état actuel comme cible, ni déclarer/recréer Postgres. Un plan global de projet peut supprimer les ressources omises ; le périmètre nommé laisse les ressources non gérées hors de sa portée. [Documentation Railway](https://docs.railway.com/infrastructure-as-code#multi-repo-projects).

La CLI installée `4.30.5` ne propose pas `config`. Il reste à figer une version CLI/SDK compatible dans l'outillage du dépôt et à valider le plan sur l'environnement de test. Aucun upgrade global ni `apply` n'a été lancé. Les nouveaux fichiers `railway.toml`/`railway.json` ne sont pas la cible : Railway déprécie ce mécanisme pour les nouveaux services. [Référence officielle](https://docs.railway.com/config-as-code/reference).

Le JSON proposé est le contrat sémantique. L'adaptateur `.railway/railway.ts` devra le consommer, sans seconde liste de variables maintenue manuellement. Les valeurs non résolues bloquent l'application ; elles ne sont pas complétées par des defaults implicites. Avant chaque mutation : vérifier le projet/environnement, l'empreinte d'état courant et un diff sans aucune action sur Postgres/volume. Une suppression ne peut viser que les quatre anciens IDs explicitement listés, après validation finale.

L'égalité demandée repose sur **trois preuves** :

1. **Cible résolue versionnée** : profils, commande, image par digest, SHA source, clés et valeurs non secrètes, références des secrets, calendrier, restart, réseau, dépendances et empreinte du contrat.
2. **Déploiement Railway effectif** : manifeste réellement déployé, image, argv/config, absence d'override, services/domaines/schedules présents. Comparer aussi les réglages supplémentaires de la plateforme ; les valeurs générées sont explicitement classifiées.
3. **Attestation du processus démarré** : profil, argv, environnement réel, SHA/contrat embarqués, IDs Railway, version Node et présence des secrets. Le garde échoue avant DB/réseau sur configuration inconnue ou contradictoire. Aucun secret dans l'attestation. La lecture distante des variables ne remplace pas cette preuve.

Une clé secrète présente n'est pas nécessairement la bonne : tester l'authentification et le rattachement à la bonne DB. Comparer les références, la portée et les noms ; ne publier ni valeur ni hash simple de secret. Le build et les images doivent intégrer l'attestation, sans accepter comme preuve un SHA fourni librement dans une variable.

**Cela requiert une nouvelle candidate.** Recréer des services à `72300c9` ne suffit pas à retirer la sonde, le deadman et le défaut de commande. La production reste à ce SHA jusqu'à validation de la nouvelle candidate. Construire une fois les deux images, enregistrer les digests et promouvoir exactement les images testées sur clone. Accès au registre OCI et authentification de pull Railway à vérifier avant provisioning ; pas de rebuild silencieux à la bascule.

## 4. Observabilité adaptée à la pause

- API : healthcheck Railway et disponibilité HTTP surveillée depuis l'extérieur. Aucun minuteur qui déduit une panne d'une absence volontaire de collecte.
- Worker : `pipeline.paused`/`workStarted:false`, démarrage, `run.alive` toutes les 30 secondes, statut terminal et captures/fins attestées. Les logs seuls ne remplacent pas les preuves en DB.
- Moniteur externe Healthchecks : signal de début, succès/échec, alerte sur dépassement de fenêtre même si le worker est tué. Il est armé pour l'exécution autorisée ; en pause durable aucun CRON ou délai quotidien implicite ne réclame une collecte.
- Le retour en pause est une preuve distincte d'une ingestion réussie. Ne pas envoyer un heartbeat « succès métier » pour masquer une ingestion en échec.
- Vérifier configuration **et réception** d'une alerte de test contrôlée avant retrait de l'ancien dispositif. La seule réponse HTTP d'une URL de ping ne démontre pas que l'alerte arrivera. Paramètres du moniteur à exporter et comparer eux aussi ; aucune nouvelle automatisation périodique dans ce lot.

L'accès d'administration du moniteur et la configuration de ses canaux n'ont pas été vérifiés pendant cet inventaire Railway. Leur vérification appartient à l'implémentation ; une URL de ping ne donne pas cet accès. Ne pas déclarer l'observabilité PASS si cette preuve manque.

## 5. Séquence de réalisation et critères d'arrêt

### R0 — présent lot : audit et plan

Export privé terminé, décisions par service/variable, cible proposée, aucun changement distant. Les secrets restent dans le dossier privé. Le travail existant des autres développeurs est conservé.

### R1 — implémentation limitée sur `development`

Implémenter le garde et l'attestation, retirer la sonde egress et le deadman remplacé, supprimer les overrides et chemins d'exploitation devenus orphelins, adapter les deux images et l'outillage de provisionnement/lancement. Vérifier chaque suppression par ses consommateurs réels. Mettre à jour les runbooks et `.env.example` au lieu de les laisser autoriser des réglages supprimés. Aucun changement de schéma.

Tester les changements réels : variable parasite refusée, pause absente refusée, mauvais profil/argv/binding refusé, pause sans effet métier, egress/redirect hors scope bloqué, signal/timeout/échec visibles. Construire les images et vérifier le build API affecté. Pas de nouvelle campagne marchés/locales, audit FK, rollback complet ni restauration générale pour un changement qui ne les invalide pas.

### R2 — nouveaux runtimes contre un clone isolé

Créer un environnement de validation vide à partir de la cible ; ne pas dupliquer la production et ses variables. Y créer une DB clone distincte et restaurer le dump opérationnel déjà éprouvé par la procédure maintenue, sans monter le volume de production. La politique existante des huit FK historiques `NOT VALID` reste inchangée ; pas de réparation. Cette importation fournit la DB de test Railway, elle ne recommence pas le chantier historique de restaurabilité.

Démarrer les nouveaux services sous pause. Exiger santé API, bon rattachement DB, attestation complète, absence de CRON, pause, heartbeat et moniteur externe vérifiés. Exécuter une ingestion bornée Oh My Cream via le chemin existant, puis revenir sous pause. Cela suffit ici au témoin métier demandé ; ne pas rejouer tout le Golden Path déjà acquis. Vérifier egress, COMPLETED, zéro erreur, absence de fusion inattendue, captures/RAW et lecture `/emplois` via l'API de test. Arrêt du lot si un champ de configuration reste inexpliqué.

### R3 — nouveaux services de production, tous les workers sous pause

Après validation du clone et revue de ce plan : désactiver réellement les calendriers et triggers de déploiement des anciens workers, confirmer leur pause et leur arrêt. Créer les nouveaux runtimes dans l'environnement production avec les mêmes images et les profils de production en pause. Lier à la DB privée existante sans la modifier. Aucune collecte sur création, redémarrage ou reconfiguration.

Vérifier les trois couches de configuration, healthcheck et authentification de la nouvelle API sur une URL temporaire, sans lui transférer encore le domaine public. Le profil du clone n'est jamais « repointé » vers la production : les environnements et secrets restent séparés. Une indisponibilité d'accès registre, domaine/DNS ou moniteur bloque seulement cette étape ; elle ne justifie aucun contournement.

### R4 — un canari Oh My Cream, puis retour en pause

Une seule exécution, aucun refresh/global/migration. Exiger : Oh My Cream seul, zéro egress métier hors source, run COMPLETED, zéro erreur, aucun doublon/fusion inattendue, captures/RAW cohérents, lecture API et `/emplois` correcte, retour effectif sous pause. Le nouveau lancement doit porter la nouvelle attestation ; le PASS de l'ancienne candidate ne la remplace pas.

### R5 — domaine, retrait des anciens services, clôture

Canari vert : transférer `agregator.catwalks.io` vers la nouvelle API ; vérifier DNS/TLS, health et requête authentifiée depuis l'extérieur. Ne pas promettre une bascule sans interruption sans avoir éprouvé le transfert de domaine. Puis supprimer **les quatre anciens runtimes**, et leurs triggers, variables, domaines worker et schedules associés. Contrôler de nouveau les IDs, l'absence de volumes attachés et l'absence d'instances actives dans un autre environnement juste avant suppression.

| Ancien service à supprimer après PASS | ID |
|---|---|
| `catwalks-aggregator` | `203613c5-701f-4013-a2c0-66c8de147c34` |
| `catwalks-refresh` | `ddc5dece-7865-4cfa-b71e-8d139e2e1ea5` |
| `catwalks-reconcile` | `85d0e5ba-992a-467e-9ddd-0dc25be1d74c` |
| `catwalks-api` | `a2280bb1-36be-4e6a-8250-2acc2aef0a47` |

Résultat attendu en production : **Postgres conservé + deux nouveaux runtimes, aucun ancien worker relançable, aucun CRON, worker en pause, config égale au contrat résolu.** L'environnement de validation identifié ne constitue pas une deuxième génération de workers de production et ne dispose pas de ses accès DB.

Le code de refresh n'est pas déclaré mort parce que son ancien service est retiré. Son éventuelle exploitation future, le ramp-up multi-sources et le calendrier relèvent d'un lot suivant. `/offres`, matching, Direct Offers, marchés/filtres et dette historique restent hors périmètre.

## 6. Retour arrière sans rollback de données

Avant retrait : l'ancienne API sert encore de repli pour le domaine, les anciens workers restent arrêtés sous pause. En cas d'échec, arrêter le nouveau worker, rétablir le routage API si nécessaire et conserver la DB. Aucun redémarrage global ni restauration de données.

Après retrait : recréer le dernier runtime approuvé depuis ses images et son contrat, sous pause. Les anciens exports restent des preuves et une aide à reconstruire les références nécessaires ; **ne jamais les réappliquer en bloc**, ce qui réintroduirait les commandes dangereuses et pourrait gérer la DB. La capacité de récupérer les images/contrats approuvés et de restaurer le routage doit être confirmée avant décommissionnement.

La clôture requiert un rapport court : diff cible/effectif/processus nul hors valeurs secrètes et identifiants générés classifiés, canari PASS, moniteur PASS, services retirés listés, PostgreSQL/volume inchangés et reprise du ramp-up possible. Tant que ces preuves n'existent pas, le présent document reste un plan.
