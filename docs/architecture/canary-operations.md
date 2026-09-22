# Exploitation du canari agrégateur

Ce runbook prépare une livraison ; il ne l'autorise pas. `main`, les déploiements, migrations et collectes Railway attendent le GO explicite de Loïc. Le développement reste sur `development`. `/emplois` V1, les marchés, GEO, `/offres` et le matching ne sont pas modifiés par PR-1.

## Commande et pause uniques

Le démarrage Docker normal est `sh apps/aggregator/start.sh`. Il appelle `src/worker.ts`, qui vérifie les migrations **sans les appliquer**, puis appelle le CLI ou l'ajout explicite de source. Le runner normal garde son filtre ACTIVE. `reconcile` n'est pas une commande reconnue et son ancien service reste en pause.

`PIPELINE_PAUSED=1` arrête les lanceurs avant le travail avec un événement JSON `pipeline.paused`, `workStarted:false`, code 0. Les fonctions de collecte importées refusent également les effets métier. Seuls `0` et l'absence de variable permettent le lancement ; toute autre valeur échoue. La pause n'est pas contournée par une campagne ni par les commandes bornées. Les commandes de lecture restent disponibles.

La variable est lue dans l'environnement du **processus**. Pour arrêter un processus déjà démarré sur Railway, modifier la variable et arrêter/redémarrer le conteneur ; une modification distante ne réécrit pas l'environnement d'un ancien processus. Les signaux d'arrêt sont transmis aux enfants et les runs interrompus sont enregistrés. Le calendrier doit rester gelé pendant le canari ; aucun job périodique n'est activé ici.

## Une nouvelle source, sans modification manuelle de la base

Après inspection de sa définition publique, pour Oh My Cream :

```sh
sh apps/aggregator/start.sh source-add \
  --key=oh-my-cream --name='Oh My Cream' --kind=teamtailor \
  --careers-url=https://careers.ohmycream.com \
  --official-domain=ohmycream.com --tier=EMPLOYER_DIRECT \
  --setting=origin=https://careers.ohmycream.com \
  --reviewer=IDENTIFIANT_DU_REVISEUR
```

En local, préfixer par `npm run stack:exec --`. Le réviseur est explicite ; les captures et les lecteurs existants vérifient les déclarations. Le programme fabrique son dossier privé de preuves, enregistre DRAFT + révision, capture et valide le RAW, vérifie l'accès et l'identité, applique les portes d'activation existantes puis ingère via le CLI normal. Aucune nouvelle règle d'identité ou de publication. Une qualification refusée ou une ingestion partielle rend un code d'échec et un verdict persistant. PAUSED/RETIRED ne sont jamais réactivées par ce chemin.

Une nouvelle définition ne remplace jamais une configuration existante divergente : une revue explicite est nécessaire. Les paramètres sont scalaires et publics ; aucun secret n'est accepté dans les noms de paramètres. Les configurations avancées restent dans le parcours de revue existant. `--out-dir` peut conserver les fichiers dans un dossier neuf ; les décisions, captures et événements durables restent en base.

`source-campaign.mts` est le moteur commun de qualification, pas un second moteur d'ingestion. Il exige des clés explicites, un réviseur et un dossier neuf ; options inconnues, vides, dupliquées ou sources absentes sont refusées. Il ne saute aucun candidat sur la foi d'un ancien fichier de verdict. Les anciens scripts de campagne massive/requalification/enregistrement concurrent ont été retirés.

## Surveillance du vrai chemin

- stdout : pause, démarrage et fin du worker ; erreur avant démarrage métier incluse.
- `PipelineRun` : début, commande, révision, statut final et interruption.
- `PipelineEvent` : événements de collecte, qualification par source, erreurs, résultat et `run.alive` toutes les 30 secondes.
- `CaptureBatch` et `SourceIngestionCompletion` : dernière collecte, RAW, sorties et fin attestée ; les journaux ne remplacent pas ces preuves.
- `HEALTHCHECK_PING_URL` : succès ou `/fail` sur les terminaisons ; une URL configurée mais inaccessible rend le run en échec. Absence de configuration = `skipped`, jamais une preuve de surveillance externe.
- `BREVO_API_KEY` et les canaux existants sont conservés par les commandes opérationnelles ; les anciens `env -u` qui retiraient alertes et heartbeat disparaissent. Les alertes ne sont pas envoyées depuis cette validation locale.

```sh
npm run stack:exec -- node --import tsx apps/aggregator/scripts/ops/worker-status.mts
```

Cette lecture seule expose pause, dernière exécution, dernier échec et dernière collecte. Un run RUNNING sans signal récent est `UNVERIFIED` : une ligne abandonnée ne prouve pas qu'un processus vit. Une base indisponible fait échouer la commande ; l'absence de signal reste observable côté plateforme et moniteur externe.

Pour le contrôle avant dégel, utiliser une invocation versionnée, sans commande shell composée :

```sh
node --import tsx apps/aggregator/scripts/ops/worker-status.mts --preflight --expected-revision=SHA_LIVRE_40_CARACTERES
```

Ce mode exige `PIPELINE_PAUSED=1`, le SHA de processus attendu et un heartbeat configuré avant tout accès réseau. Il lit le statut dans une transaction READ ONLY, refuse un run récemment observé vivant, exerce le vrai worker sous pause et exige son événement `workStarted:false`. Il vérifie ensuite l'acquittement HTTP du heartbeat et écrit une preuve synchrone unique `worker.paused_preflight`. Il ne crée aucun `PipelineRun`, aucune capture et aucune ingestion. Son ping est explicite ; la simple lecture de statut sans options ne le déclenche pas.

Les journaux Railway structurés peuvent avoir un champ `message` vide : lire aussi `attributes { key value }` et décoder les valeurs JSON pour retrouver `event`, `workStarted` et le résultat du heartbeat. L’absence de texte dans `message` seul ne prouve pas une absence de signal.

## Plan Railway à appliquer seulement après GO

1. Figer le SHA candidat validé et le SHA actuellement déployé. Sauvegarder la base et vérifier la restauration opérationnelle décrite ci-dessous. Vérifier les canaux d'alerte depuis le futur environnement (l'émission réelle reste une étape du canari autorisé).
2. Tous les workers restent `PIPELINE_PAUSED=1`, calendriers gelés. Remplacer l'override de campagne de l'agrégateur par `sh apps/aggregator/start.sh` ; aucune référence à un fichier supprimé ne doit subsister dans le manifeste Railway. Fixer explicitement `EGRESS_PROBE=0` dans l’environnement du service canari et vérifier sa prise en compte au déploiement : l’ancienne sonde vise un hôte indépendant de la source sélectionnée. Ne pas compter sur un ancien préfixe inline qui disparaît avec l’override. Cette vérification de configuration s’ajoute au preflight ; ce dernier ne vérifie pas cette variable.
3. Livrer le candidat, appliquer les migrations **une seule fois par l'étape de release API**, puis vérifier `/api/health`, lecture authentifiée et statut des services. Le worker refuse les migrations en attente ; il ne les applique pas.
4. Pour le seul service autorisé, préparer la commande `source-add` ci-dessus, périmètre d'une seule source. Conserver les secrets d'alerte, vérifier les variables présentes sans les afficher, garder les autres services en pause. Retirer la pause du seul service canari et exécuter **une fois**, sous surveillance. La méthode de déploiement Railway peut démarrer le conteneur immédiatement : le dégel lui-même est une action d'exécution soumise au GO.
5. Vérifier verdict, admissions/fins, captures liées, doublons, lecture API et `/emplois`. Restaurer la pause et la commande normale, confirmer les calendriers et l'absence de processus actif. Aucun refresh ni clôture automatique dans ce premier canari.

`railway-service.py` refuse une commande bornée/exécution si la pause distante n'est pas exactement `0`, avant mutation. La restauration de la commande normale reste possible en pause. Le [bilan du 22 septembre](../../audits/2026-09-22/restorability-canary-final.md) atteste la livraison autorisée et le retour à la commande normale. Il distingue l’ingestion réussie de l’écart HTTP hors périmètre ; il n’autorise pas une seconde ingestion.

## Restauration du stock historique, sans data repair

Décision explicite de Loïc du 22 septembre 2026 : les 754 violations historiques sur 613 lignes ne sont pas réparées pendant le canari. [`restore-operational.py`](../../apps/aggregator/scripts/ops/restore-operational.py) applique une [liste figée](../../apps/aggregator/scripts/ops/restore-operational-policy.json) de huit FK, avec comptes et hashes exacts. Le dump est restauré en pre-data, data et post-data normal, sauf ces huit FK explicitement recréées `NOT VALID`. Les 37 autres doivent être VALID. Une population différente, une FK supplémentaire en violation ou une erreur post-data bloque la restauration.

Les huit FK restent actives pour les nouvelles écritures. Aucun trigger n’est désactivé, aucune référence nullifiée, aucun parent inventé. Le résultat expose les huit contraintes non validées et les témoins d’écriture refusée ; il ne prétend jamais que la dette a disparu. Les données complètes et séquences doivent être identiques avant/après reconstruction. Cette tolérance historique limitée remplace, pour la restauration du stock, l’ancien critère irréalisable de zéro orphelin sans changement des données.

Une restauration verte est suivie des contrôles API, `/emplois` et Golden Path avant reprise du canari autorisé. Aucun changement des huit contraintes ni des données historiques n’est appliqué directement sur Railway par cette procédure. L’ancien outil de réparation et le lanceur de purge qui désactivait l’intégrité sont retirés.

## Périmètres volontairement séparés

**DIRECT_OFFERS = hors canari.** Le Golden Path prouve la lecture `/emplois` avec `DirectOffer` vide. Ni backend des candidatures, ni `direct-sync`, ni `/offres`/matching ne sont des dépendances de ce canari. La priorité et les parcours des offres directes existants restent inchangés.

**S3 = non bloquant canari.** Les RAW chauds restent durables dans PostgreSQL. La répétition de rollback désactive le stockage objet et vérifie la collecte puis la lecture API. Stockage froid, politique de rétention, sauvegarde et restauration des archives restent au backlog Production Hardening avant une production globale. Ne pas lancer purge/archivage pendant le canari.

## Répétition du retour arrière

```sh
npm run stack:exec -- node apps/aggregator/scripts/ops/rollback-rehearsal.mjs \
  --before=SHA_PRODUCTION_40_CARACTERES \
  --candidate=SHA_CANDIDAT_40_CARACTERES \
  --out-dir=/chemin/prive/nouvelle-repetition
```

Le témoin crée une base locale neuve et deux archives Git immuables, installe leurs locks et construit les deux API. Il applique les migrations de l'ancienne version, enregistre une fixture Douglas par le registre, démarre l'ancienne API ; applique la candidate et vérifie migration/révision Douglas ; démarre la candidate, ajoute réellement Oh My Cream par le worker ; puis redémarre l'ancienne API avec la base conservée. Il exige des offres réelles, mêmes identifiants et résultats HTTP avant/après rollback, RAW et ledger inchangés, worker en pause. Les journaux restent privés. Les archives et la base ne sont pas effacées automatiquement pour permettre l'inspection.

Le retour arrière testé est **applicatif, avec base forward-compatible**. Aucune suppression du ledger ni tentative de downgrade Prisma. La configuration Douglas reste corrigée et sa nouvelle révision est conservée. Les anciennes qualifications ne sont pas transposées sous un ancien lecteur : après rollback, la collecte reste en pause et toute reprise exige une qualification courante.

Les 85→86 migrations décrivent le couple de révisions de PR-1 ; le témoin exige exactement cette migration supplémentaire. Une future release avec d'autres migrations devra réviser sa répétition, pas réutiliser automatiquement ce PASS.
