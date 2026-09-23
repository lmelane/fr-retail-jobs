# Reset du runtime Railway — réalisation

**23 septembre 2026 — R1, R2, R3 et R4 PASS ; R5 attend l'accès DNS.** Les deux nouveaux runtimes de production utilisent les mêmes images que le clone. Le canari production unique `3caa7db0-242d-435e-8581-a840b23c16b8` est `COMPLETED` : 23 mises à jour, 0 création/fusion/erreur, 27 blobs vérifiés, egress métier limité à `careers.ohmycream.com`, heartbeat reçu, `/emplois` affiche les 21 offres FR. Le worker a chargé de nouveau `production-paused`, sans travail ni appel métier. PostgreSQL, son volume et les quatre anciens runtimes conservent leurs configurations et déploiements. Seules les écritures normales Oh My Cream et le renouvellement de ses preuves explicitement autorisé ont eu lieu. Voir les reçus [R2](../../audits/2026-09-23/runtime-reset-r2.json), [R3](../../audits/2026-09-23/runtime-reset-r3.json) et [R4](../../audits/2026-09-23/runtime-reset-r4.json).

Le domaine `agregator.catwalks.io` sert encore l'ancienne API. Son CNAME actuel est `4j23i5c2.up.railway.app`, certificat valide. Aucun accès DNS Cloudflare utilisable n'a été trouvé et le navigateur demande une connexion. Avant de détacher ce domaine, obtenir l'accès à la zone `catwalks.io` pour appliquer, si nécessaire, les enregistrements retournés par Railway et garantir le retour arrière. Ne pas rejouer R1–R4, ne pas relancer le canari, ne pas supprimer les anciens services avant le PASS public R5. Le ramp-up attend la clôture de R5.

**Contrôle R1 : PASS après accord explicite de Loïc sur les images publiques.** Les deux images `c3613a1` sont conservées sans rebuild. Le [reçu de release](../operations/railway/runtime-release.json) fixe les digests et documente les deux seuls écarts approuvés avec le contrat embarqué : la visibilité du registre, sans changement de commande, variables, garde ou données. R2 utilise le clone Railway isolé. Voir le [reçu R1](../../audits/2026-09-23/runtime-reset-r1.md).

La [cible structurée](../operations/railway/runtime-target.json) décrit le résultat attendu. Elle n'est pas encore un fichier exécutable de provisionnement. Le [relevé réel](../../audits/2026-09-23/railway-runtime-inventory.json) contient les identifiants, déploiements, décisions pour les **33 affectations de variables** des quatre services et empreintes des sauvegardes privées. Ne pas confondre configuration proposée, configuration distante et environnement effectivement chargé dans un processus.

## 1. État sauvegardé et dérives constatées

Export privé : `/Users/lmelane/.catwalks/runtime-reset-20260923/snapshot-20260923T044617Z/`. Dossier mode `0700`, fichiers `0600`, secrets hors Git. Sont conservés : configuration déchiffrée, variables effectives du plan de contrôle, métadonnées des variables, commandes, build, calendrier, politiques, domaines, source Git, métadonnées du dernier déploiement et digest, références des volumes, environnements et propriété IaC. `manifest.json` vérifie les empreintes. Ce n'est pas un nouveau dump de la DB.

Lors de l'export initial, le projet possédait cinq services en production : PostgreSQL et quatre runtimes. L'environnement `capture-validation-20260915` était vide. R2 a depuis ajouté l'environnement isolé `runtime-validation-20260923`, puis R3 les deux nouveaux runtimes en production ; les anciens attendent leur retrait après R5. Les quatre anciens runtimes indiquent toujours `72300c97586955536ee1f89b0a9b7b0273fbf8a9`. Le statut Railway `SUCCESS` ne prouve pas à lui seul qu'un processus de worker est vivant.

| Constat vérifié | Décision cible |
|---|---|
| Les trois workers gardent `RAILWAY_RUN_COMMAND`, avec `prisma db push --accept-data-loss` puis une commande npm | Supprimer l'override et refuser sa réintroduction. **Chaînes résiduelles stockées, pas preuve d'exécution ni cause établie des anomalies historiques.** |
| `PIPELINE_CMD=reconcile`, commande absente du worker courant | Ne pas recréer ce service ; aucun nouveau moteur de réconciliation |
| Les trois CRON valent `0 0 29 2 *` : prochain déclenchement le 29 février 2028 | `cronSchedule: null`, aucun calendrier de substitution |
| `EGRESS_PROBE=0` sur l'agrégateur, mais code et appel de la sonde toujours présents | Retirer sonde, appel et variable ; variable explicitement interdite |
| L'API lance `startPipelineDeadman()`, sans tenir compte de la pause | Retirer le timer et ses secrets de l'API ; suivre les mécanismes existants Railway, Healthchecks et PipelineRun/PipelineEvent |
| L'API applique automatiquement `prisma migrate deploy` en pré-déploiement | Aucun hook de migration dans les services cibles ; readiness en lecture seule |
| `Mode Careers` comme expéditeur, `https://modecareers.com` comme URL site de l'API | Identité opérationnelle Catwalks ; URL `https://catwalks.io`, déjà utilisée comme fallback par le code. Aucun changement du domaine du front ni des marchés |
| Domaines publics sur les trois workers, build déterminé par variable, source Git `main` avec autodeploy | Aucun domaine worker ; images immuables, livraison explicite ; configuration de build versionnée |
| Heartbeat configuré seulement sur l'agrégateur ; absence de configuration tolérée par le code | Heartbeat obligatoire pour le nouveau worker, erreur observable si absent |

Le plan de contrôle ne donne pas ici un nombre exploitable de changements en attente (`unmergedChangesCount: null`). Une relecture fraîche et le contrôle d'absence de changements concurrents seront obligatoires avant toute application.

## 2. Deux nouveaux runtimes ; PostgreSQL conservé

| Service cible | Commande | Pause / CRON | Santé / redémarrage | Dépendances |
|---|---|---|---|---|
| `catwalks-catalogue-api` | `node apps/api/runtime/start.mjs` : contrôle de configuration puis serveur standalone existant | Pas de collecte ; aucun CRON | `/api/health`, 120 s ; `ON_FAILURE`, 3 reprises ; sonde HTTP externe | PostgreSQL privé, clé catalogue |
| `catwalks-ingestion-worker` | `sh apps/aggregator/start.sh`, entrée durcie | `PIPELINE_PAUSED=1`, CRON absent | événement de pause, signaux de run et heartbeat indépendant ; `NEVER` | PostgreSQL privé, Healthchecks, Brevo |
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

`CATWALKS_RUNTIME_PROFILE` sélectionne l'un des profils versionnés, jamais un script arbitraire. Les références privées sont injectées sans exposer leurs valeurs dans Git ou les journaux. Le domaine de validation et les accès DB sont indépendants de la production. Le check Healthchecks existant est partagé explicitement pour les essais séquentiels, sur décision de Loïc ; aucune credential de DB de production sur le clone. Le partage de credentials d'alerte éventuel doit être explicite, avec checks et destinataires de test identifiés.

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

L'outillage utilise **Railway CLI 5.59.0**, figée dans les commandes (`npm exec --yes --package @railway/cli@5.59.0 -- railway`). Sorties JSON, sélecteurs exacts de projet/environnement/service, mutations ciblées uniquement sur les deux runtimes autorisés et le clone. Les opérations non exposées par une commande dédiée passent par `railway api` et des variables JSON via stdin. Aucun framework IaC générique, aucune importation globale ni gestion de Postgres production. Le contrat JSON reste la source des réglages.

Avant chaque mutation : vérifier le projet/environnement, l'état courant et un diff sans aucune action sur Postgres/volume de production. Une suppression ne peut viser que les quatre anciens IDs explicitement listés, après validation finale. Les images sont publiées publiques, sur décision explicite de Loïc, par le job CI `runtime-images`, déclenché explicitement sur `development` par le marqueur de commit `[runtime-images]`, après les contrôles CI. Un tag SHA déjà publié est réutilisé ; les reçus embarqués et les digests sont vérifiés. Aucun autodeploy Railway. Le pull public par digest ne nécessite aucune credential de registre. Ne pas demander de PAT pour ce lot.

L'égalité demandée repose sur **trois preuves** :

1. **Cible résolue versionnée** : profils, commande, image par digest, SHA source, clés et valeurs non secrètes, références des secrets, calendrier, restart, réseau, dépendances et empreinte du contrat.
2. **Déploiement Railway effectif** : manifeste réellement déployé, image, argv/config, absence d'override, services/domaines/schedules présents. Comparer aussi les réglages supplémentaires de la plateforme ; les valeurs générées sont explicitement classifiées.
3. **Attestation du processus démarré** : profil, argv, environnement réel, SHA/contrat embarqués, IDs Railway, version Node et présence des secrets. Le garde échoue avant DB/réseau sur configuration inconnue ou contradictoire. Aucun secret dans l'attestation. La lecture distante des variables ne remplace pas cette preuve.

Une clé secrète présente n'est pas nécessairement la bonne : tester l'authentification et le rattachement à la bonne DB. Comparer les références, la portée et les noms ; ne publier ni valeur ni hash simple de secret. Le build et les images doivent intégrer l'attestation, sans accepter comme preuve un SHA fourni librement dans une variable.

**Cela requiert une nouvelle candidate.** Recréer des services à `72300c9` ne suffit pas à retirer la sonde, le deadman et le défaut de commande. La production reste à ce SHA jusqu'à validation de la nouvelle candidate. Construire une fois les deux images, enregistrer les digests et promouvoir exactement les images testées sur clone. Accès au registre OCI et authentification de pull Railway à vérifier avant provisioning ; pas de rebuild silencieux à la bascule.

## 4. Observabilité adaptée à la pause

- API : healthcheck Railway et disponibilité HTTP surveillée depuis l'extérieur. Aucun minuteur qui déduit une panne d'une absence volontaire de collecte.
- Worker : `pipeline.paused`/`workStarted:false`, démarrage, `run.alive` toutes les 30 secondes, statut terminal et captures/fins attestées. Les logs seuls ne remplacent pas les preuves en DB.
- Healthchecks : utiliser uniquement la Ping URL existante, `/start`, `/fail` et succès. Aucune API de gestion, changement de compte ou d'intégration dans ce lot.
- Le retour en pause est une preuve distincte d'une ingestion réussie. Ne pas envoyer un heartbeat « succès métier » pour masquer une ingestion en échec.
- Test contrôlé réalisé le 23 septembre : les trois pings ont été acceptés, sans exposer l'URL. La réception de l'alerte reste une confirmation utilisateur séparée. Une réponse HTTP n'est pas une preuve de livraison de l'alerte. Si elle n'arrive pas, classer « configuration Healthchecks à revoir » sans bloquer la construction des runtimes.

Le timeout local borne le canari à quinze minutes. Sans accès à la configuration du check, ne pas prétendre avoir vérifié son délai d'alerte en cas d'arrêt brutal ni son comportement pendant une longue pause. La vérification HTTP de la nouvelle API fait partie des gates R2/R3/R5 ; aucun moniteur externe d'API supplémentaire n'est provisionné ici.

## 5. Séquence de réalisation et critères d'arrêt

### R0 — présent lot : audit et plan

Export privé terminé, décisions par service/variable, cible proposée, aucun changement distant. Les secrets restent dans le dossier privé. Le travail existant des autres développeurs est conservé.

### R1 — implémentation limitée sur `development`

Implémenter le garde et l'attestation, retirer la sonde egress et le deadman remplacé, supprimer les overrides et chemins d'exploitation devenus orphelins, adapter les deux images et l'outillage de provisionnement/lancement. Vérifier chaque suppression par ses consommateurs réels. Mettre à jour les runbooks et `.env.example` au lieu de les laisser autoriser des réglages supprimés. Aucun changement de schéma.

Tester les changements réels : variable parasite refusée, pause absente refusée, mauvais profil/argv/binding refusé, pause sans effet métier, egress/redirect hors scope bloqué, signal/timeout/échec visibles. Construire les images et vérifier le build API affecté. Pas de nouvelle campagne marchés/locales, audit FK, rollback complet ni restauration générale pour un changement qui ne les invalide pas.

### R2 — nouveaux runtimes contre un clone isolé

Créer un environnement de validation vide à partir de la cible ; ne pas dupliquer la production et ses variables. Y créer une DB clone distincte et restaurer le dump opérationnel déjà éprouvé par la procédure maintenue, sans monter le volume de production. La politique existante des huit FK historiques `NOT VALID` reste inchangée ; pas de réparation. Cette importation fournit la DB de test Railway, elle ne recommence pas le chantier historique de restaurabilité.

Démarrer les nouveaux services sous pause. Exiger santé API, bon rattachement DB, attestation complète, absence de CRON, pause, heartbeat et moniteur externe vérifiés. Exécuter une ingestion bornée Oh My Cream via le chemin existant, puis revenir sous pause. Cela suffit ici au témoin métier demandé ; ne pas rejouer tout le Golden Path déjà acquis. Vérifier egress, COMPLETED, zéro erreur, absence de fusion inattendue, captures/RAW et lecture `/emplois` via l'API de test. Tout écart réel de configuration déployée bloque le passage au lot suivant. Les typos, fixtures, assertions obsolètes et commandes locales incorrectes sont corrigées puis retestées sans demander un GO.

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

La clôture requiert un rapport court : diff cible/effectif/processus nul hors valeurs secrètes et identifiants générés classifiés, canari PASS, suivi existant attesté, services retirés listés, PostgreSQL/volume inchangés et reprise du ramp-up possible. Tant que ces preuves n'existent pas, le présent document reste un plan.

### Suivi du canari — décision du propriétaire

Aucun nouveau dashboard, outil de surveillance ou moniteur. Utiliser les logs live Railway du service et du digest attendus, le module Healthchecks existant (`/start`, succès ou `/fail`), les événements `run.alive`/statuts DB et les captures RAW, puis `/emplois`. Le retour du worker sous pause est contrôlé séparément. Pour cette release immuable, comparer les champs opérationnels au contrat embarqué `ba9fbd…` ; la seule différence autorisée entre celui-ci et la cible actuelle concerne les deux champs `sourceMode`, explicitement décrits dans `runtime-release.json`. Aucun autre écart n’est accepté.
