# Exploitation de l’agrégateur V1

## Contrat de livraison et attribution des incidents

Décision produit du 24 septembre 2026 : une livraison n'est terminée que lorsque
les défauts de code, d'architecture et de configuration Catwalks identifiés dans
son périmètre sont corrigés et vérifiés **sur le runtime Railway livré**. Un test
local ou une fixture verte ne remplace jamais cette validation. Les tests ciblés
et la CI préviennent les régressions avant la livraison ; aucun défaut n'est
injecté artificiellement dans la base de production pour exercer un test.

Le contrat s'appuie sur les chemins existants : registre → qualification et
admission → capture RAW → extraction → identité/publication → projection PG.
Une erreur ne supprime ni le RAW ni les garde-fous. Aucun patch SQL historique,
aucune attribution employeur par défaut, aucune seconde architecture.

| Attribution | Preuve et traitement |
|---|---|
| `SOURCE` | Incident natif démontré, rattaché à la capture de ce RUN. Peut rester un incident individuel accepté. |
| `INTERNAL` | Défaut de code, DB, capture, observabilité ou prérequis mal entretenu. Correction obligatoire. |
| `UNKNOWN` | Cause non démontrée. Investigation obligatoire ; jamais assimilée à SOURCE par défaut. |

L'automatisation initiale ne reconnaît comme SOURCE qu'un HTTP 5xx sur un GET
**admis**, dans son périmètre qualifié, avec réponse native complète persistée,
identifiant du RAW et requête exacte vérifiée. Le statut HTTP observé n'est pas
une règle de publication. Une panne pendant la qualification, un 4xx, un timeout,
un rejet d'identité ou une anomalie de contenu restent UNKNOWN tant que la cause
n'est pas démontrée. Une contradiction peut venir de notre ancien rattachement :
le maintien du blocage n'autorise pas à déclarer la livraison terminée.

| Résultat du RUN normal | PipelineRun / worker | Sortie / Healthchecks |
|---|---|---|
| Toutes les sources traitées, aucun incident | COMPLETED | 0 / succès |
| RUN terminé, uniquement des incidents SOURCE prouvés, autres sources réussies, récapitulatif transmis | COMPLETED_WITH_ERRORS | 0 / succès ; incidents conservés et alertés |
| Erreur INTERNAL ou UNKNOWN, aucune source, toutes les sources en échec, RUN incomplet, finalisation/alerte/heartbeat indisponible | FAILED | non nulle / fail |
| Arrêt du processus en cours | INTERRUPTED en base quand la persistance reste possible ; FAILED côté worker | non nulle / fail |

Le worker n'annonce un succès qu'après un acquittement du CLI correspondant à
la commande et au run, envoyé **après** la persistance du statut final. Un code 0
sans cet acquittement échoue. `source-add` conserve son propre verdict de
qualification ; il n'est pas rendu permissif par cette politique du RUN normal.
Le rejeu d'une seule source doit réussir pour valider cette source.

Les exceptions avant ingestion figurent dans le même récapitulatif que les
incidents après extraction. Une indisponibilité de l'alerte ne transforme pas un
RUN dégradé en succès silencieux. Les compteurs par source, les événements et les
preuves de capture restent accessibles ; aucune réécriture des anciens RUN.
`8d8c59aa` conserve ainsi son verdict historique et n'est pas repeint en vert.

### Protocole de changement

1. Reproduire le défaut depuis les preuves de la source et identifier ses consommateurs.
2. Corriger le chemin commun ; fixtures et tests défensifs ciblés, CI obligatoire.
3. `development` → `main`, images immuables, comparaison SHA/commande/env réels.
4. Requalifier les seules révisions de sources modifiées par le Golden Path existant,
   puis les ingérer réellement sur Railway ; lire bilan, RAW, catalogue et API.
5. Corriger tout défaut INTERNAL et investiguer tout UNKNOWN du périmètre livré.
   Conserver les refus natifs démontrés sans contournement.
6. Retirer le mécanisme remplacé après vérification des consommateurs ; actualiser
   le reçu de release et ce runbook. Aucun nouveau canari global sans changement pertinent.

Le GO couvre l'agrégateur. `/offres`, matching, onboarding, Direct Offers et le
site restent dans leurs périmètres gelés. PostgreSQL est le seul moteur de
recherche maintenu ; le challenger Elasticsearch a été supprimé. Les rapports
historiques expliquent la décision, sans conserver un moteur alternatif.

## Commande et pause uniques

Le démarrage Docker normal est `sh apps/aggregator/start.sh`. Il appelle `src/worker.ts`, qui vérifie les migrations **sans les appliquer**, puis appelle le CLI ou l'ajout explicite de source. Le runner normal garde son filtre ACTIVE. `reconcile` n'est pas une commande reconnue ; les anciens services ont été supprimés après R5.

`PIPELINE_PAUSED=1` arrête les lanceurs avant le travail avec un événement JSON `pipeline.paused`, `workStarted:false`, code 0. Les fonctions de collecte importées refusent également les effets métier. Le worker exige explicitement `0` ou `1` ; le CLI local accepte aussi l'absence de variable. Toute autre valeur échoue. La pause n'est pas contournée par une campagne ni par les commandes bornées. Les commandes de lecture restent disponibles.

La variable est lue dans l'environnement du **processus**. Pour arrêter un processus déjà démarré sur Railway, modifier la variable et arrêter/redémarrer le conteneur ; une modification distante ne réécrit pas l'environnement d'un ancien processus. Les signaux d'arrêt sont transmis aux enfants et les runs interrompus sont enregistrés. Un canari borne temporairement le calendrier ; le mode normal utilise `scheduled`, à 18 h Europe/Paris. Son état courant est attesté dans le reçu de release.

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

En local, préfixer par `npm run stack:exec --`. Le réviseur est explicite ; les captures et les lecteurs existants vérifient les déclarations. Le programme fabrique son dossier privé de preuves, enregistre DRAFT + révision, capture et valide le RAW, vérifie l'accès et l'identité, applique les portes d'activation existantes puis ingère via le CLI normal. Aucune nouvelle règle d'identité ou de publication. Une qualification refusée ou une ingestion partielle rend un code d'échec et un verdict persistant. Une définition publique ne réactive pas une source PAUSED ou RETIRED.

Une nouvelle définition ne remplace jamais une configuration existante divergente : une revue explicite est nécessaire. Les paramètres sont scalaires et publics ; aucun secret n'est accepté dans les noms de paramètres. Les configurations avancées restent dans le parcours de revue existant. `--out-dir` peut conserver les fichiers dans un dossier neuf ; les décisions, captures et événements durables restent en base.

### Requalifier une configuration déjà revue dans le registre

Après une correction de configuration, le registre met automatiquement une source ACTIVE en PAUSED. Pour requalifier une seule révision explicitement revue, y compris ses paramètres structurés :

```sh
sh apps/aggregator/start.sh source-add \
  --key=CLE_SOURCE --registered-revision=UUID_REVISION_REVUE \
  --official-domain=DOMAINE_OFFICIEL --reviewer=IDENTIFIANT_DU_REVISEUR
```

Cette forme lit la définition exacte en base ; aucun remplacement inline n'est accepté. Une révision différente ou une source RETIRED est refusée. La pause globale reste autoritaire. La reprise de qualification ne donne ni accès ni activation : le même Golden Path doit produire les preuves natives et une décision ALLOWED avant la promotion atomique, puis l'ingestion normale. Le RUN quotidien ne réactive jamais les sources PAUSED.

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

## Railway : plan courant et preuve historique

Le [reset du runtime Railway](railway-runtime-reset.md) remplace le nettoyage incrémental des variables et commandes. Les deux runtimes sont livrés depuis R5 ; PostgreSQL reste intégralement conservé. La configuration actuelle est décrite dans le reçu de release et l'audit post-RUN, avec comparaison cible/déploiement/processus et sans hook de migration automatique. Les sections de canari ci-dessus ne constituent pas le calendrier de production.

Le [bilan du 22 septembre](../../audits/2026-09-22/restorability-canary-final.md) atteste la livraison autorisée. Son écart HTTP hors périmètre a été clos par la [validation différentielle du 23 septembre](../../audits/2026-09-23/canary-delta-oh-my-cream.md), au même SHA `72300c9`. Ce canari reste PASS. Les commandes et preuves précédentes décrivent ce runtime existant ; chaque nouvelle release apporte sa propre attestation sans rejouer les validations produit non affectées.

Les futures migrations seront une opération de release distincte, jamais une conséquence d'un démarrage d'API/worker. Aucune migration n'est prévue pour le reset.

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
