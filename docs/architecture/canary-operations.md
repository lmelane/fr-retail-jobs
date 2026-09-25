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

### Contrat de statut après D-453 et D-456 (24-25/09/2026)

Statuts employés ci-dessous : **décidé** = tranché par le CEO (D-453, D-456, D-462, `docs/governance/DECISIONS.md`
du dépôt backend) ; **application non arbitrée** = lecture d'une décision retenue par l'équipe sans arbitrage
propre (aucun motif dans ce cas depuis D-462, le 25/09) ; **garde technique** = protection du code, pas une
décision produit. Cette section décrit le classement du code de ce dépôt. Livraison du 25/09 : voir
`docs/operations/railway/runtime-release.json`, seul le reçu dit quelle image le worker exécute.

**Rejeu du classement du RUN du 24/09 (`35ba463f`).** Seul le *classement* est rejoué, hors base, sur les
chiffres que le RUN a enregistrés : santé, attribution, bilan et objet de l'alerte ; aucune source n'est
recollectée, rien n'est écrit. Le code du RUN (`2cc91d8`) rejoué reproduit exactement le bilan enregistré
(414 sources, 354 OK, 60 non OK : 2 INTERNAL, 58 UNKNOWN ; aucun écart par source). Sous la cible (D-453 §1 et
D-456) : 414 sources, 354 OK, 60 non OK, dont **19 non bloquantes** (retenues sur preuve de la source,
2 032 offres : les 18 sources à retenue Workday ou candidature close du 24/09, 1 969 offres, et Intersport,
63 offres) et **41 bloquantes** (`UNKNOWN`) : les 5 énumérations non prouvées (attaquer, kastner-ohler,
lumentee, marc-o-polo, picard), les 2 pannes de transport désormais nommées (Rolex, Ralph Lauren), 3
énumérations réfutées (hugo-boss-phenom, skechers-phenom, tapestry) et 31 incidents inchangés (identité, accès,
troncatures, retenues à instruire, couverture de champ). Statut **FAILED** (`UNRESOLVED_FAILURE`) au lieu de
FAILED (`INTERNAL_FAILURE`, `UNRESOLVED_FAILURE`). Aucune exclusion de périmètre ce jour-là. Sur les 41
bloquantes, 21 relèvent déjà d'une décision prise : les 20 refus d'identité (D-453 §4) et Ralph Lauren (D-453
§3). Les 41 sont à traiter (D-456 §5 : 20 refus d'identité, 8 échecs d'accès et de transport, 8 énumérations
non prouvées ou réfutées, 5 régressions), après la livraison et jamais pendant le RUN. Pour recompter :
`audits/2026-09-24/scripts/rejeu-classement-2409-extraction.mts` (lecture seule de la production, rôle
`catwalks_audit`) puis `audits/2026-09-24/scripts/rejeu-classement-2409.mts` ; le script refuse de rendre un
chiffre, `--json` compris, tant que l'ancien code ne reproduit pas le RUN. SourceRun ne garde que dix jours
d'historique (`HISTORY`, `pipeline/health.ts`) : au-delà du 04/10/2026, seul le fichier extrait
(`audits/2026-09-24/rejeu-classement-2409.json`) fait foi.

- **Panne de transport = UNKNOWN nommée par sa cause, jamais INTERNAL sur sa seule classe** (défaut du code
  corrigé, D-453). Le client HTTP (undici) rejette toute panne réseau ou TLS par
  `TypeError('fetch failed', { cause })`. Son code de cause la classe `UNKNOWN` / `TRANSPORT_<code>`
  (`TRANSPORT_UND_ERR_CONNECT_TIMEOUT` pour Rolex, `TRANSPORT_UNABLE_TO_VERIFY_LEAF_SIGNATURE` pour Ralph Lauren
  le 24/09). Une `TypeError`, `ReferenceError` ou `RangeError` de notre code reste INTERNAL, y compris quand
  `fetch` enveloppe un défaut de notre dispatcher. Un refus de notre garde SSRF levé avant la requête reste
  `UNKNOWN` / `BlockedUrlError` ; levé pendant la résolution DNS, `fetch` l'enveloppe dans
  `TypeError('fetch failed')`, que l'ancien classement rangeait INTERNAL / `TypeError` : il est désormais classé
  comme le refus lui-même, `UNKNOWN` / `BlockedUrlError`. La cause est conservée sur la capture
  (`RawCapture.failure` et `CaptureOutcome.failure` : `TypeError__UND_ERR_CONNECT_TIMEOUT` — le nom vivant
  d'abord, pour qu'un rejeu hors ligne relance la même erreur) et dans la note du SourceRun
  (`fetch failed [UND_ERR_CONNECT_TIMEOUT]`).
- **Retenue sur preuve de la source = visible, attribuée à la source, non bloquante** (décidé, D-453 §1 et
  D-456 §1). Preuves publiées par la source elle-même : la candidature impossible sur son site — close
  explicitement (exemple de D-453), page de candidature en erreur 404 ou marquée « modèle expiré » (D-456 §1),
  page supprimée en 410 (D-462, aucune offre le 24/09) — ; l'employeur
  absent de l'annonce Workday sous la politique revue du 09/09 (exemple de D-453) ; le retrait de son listing,
  la publication de test, l'événement de recrutement ou job dating (D-462, 25/09). La source reçoit l'attribution `SOURCE` / `NATIVE_RETENTION`, avec pour preuve le rapport
  scellé de fin d'ingestion (`completionReportHash`) de sa capture admise ; elle reste DEGRADED dans SourceRun
  et, seule, donne COMPLETED_WITH_ERRORS. La garde de masse de JobAffinity (plus de la moitié des pages
  retirées sur 50 offres ou plus = collecte refusée, `jobaffinityWordpress.ts`) reste en place.
- **Une retenue n'est « non publiée » que par ce RUN.** Elle empêche ce RUN de publier l'offre ; elle ne retire
  une publication antérieure que si son motif porte une disposition (candidature close, 404, 410, retrait du
  listing, exclusion de périmètre) et que la source en a daté le retrait (`publicationHold.ts`). Sans
  disposition (employeur absent de l'annonce Workday, modèle expiré, publication de test, événement de
  recrutement), l'offre déjà publiée reste en ligne (`PRESENT_BUT_HELD`, `refreshPlan.ts`). L'ingestion compte,
  après avoir archivé ses retenues, celles qui restent en ligne telles que le site les voit (représentation
  disponible, offre active et non fusionnée) ; l'alerte le dit par motif et par source (« non publiées par ce
  RUN ; N restent en ligne depuis une collecte antérieure », « maintien en ligne non mesuré » si la lecture a
  échoué), le bilan en donne le total (`retainedStillOnline`). Mesuré le 25/09 à 06:29 UTC sur les retenues du
  RUN du 24/09 (lecture seule, `audits/2026-09-25/scripts/retenues-encore-en-ligne-2409.mts`) : aucune des
  1 981 retenues sans disposition n'est en ligne (1 967 employeur absent, 12 modèle expiré, 1 test, 1
  événement) et aucune n'a jamais été publiée ; des 59 retenues à disposition (51 candidatures closes, 8 pages
  404), 2 avaient été publiées et aucune ne l'est plus ; 2 retenues à instruire (échec de lecture du détail,
  nordstrom et urbn-hub) restent en ligne depuis une collecte antérieure. Le retrait des offres n'est pas
  modifié : la question est soumise au CEO.
- **Exclusion de périmètre = décision de l'équipe, visible, non bloquante** (décidé, D-456 §2). Ce n'est pas une
  preuve de la source : aucune attribution, aucun échec ; SourceRun, alerte et bilan (`teamExclusions`) la
  nomment « écartée par l'équipe ». Aucune offre concernée le 24/09.
- **Ce qui reste bloquant.** Les échecs de lecture (`*_DETAIL_FETCH_FAILED`), les états non reconnus, tout
  motif nouveau (liste fermée) ; une retenue n'exempte jamais le reste de la collecte : troncature, énumération
  non prouvée ou réfutée, effondrement ou couverture de champ effondrée restent bloquants et sont nommés dans la
  même note. Un refus d'identité (`EmployerIdentityReviewRequired`) est un refus d'écriture : il bloque, et les
  retenues de la même source restent nommées à côté (note du SourceRun, bilan `retainedOnBlockingSources`).
- **Garde de la preuve négative** (garde technique, pas une décision). « L'annonce ne nomme pas d'employeur »
  ne distingue pas un portail multi-marques d'une page dont le format a changé. Seul ce motif Workday est
  surveillé : il devient bloquant (`UNKNOWN` / `NATIVE_RETENTION_JUMP`) si la part des offres de la source
  qu'il laisse non publiées dépasse de plus de 10 points, et d'au moins 10 offres, la part non publiée au
  RUN COMPLET de référence. La référence est le dernier RUN complet de production où la source a été collectée,
  reconnu à l'événement `sectors.qualification` qu'émet seul un RUN non ciblé qui a fini sa boucle
  (`FULL_RUN_MARKER`) ; un run ciblé, un canari ou `ingest --source` ne l'est jamais. Sa part non publiée
  compte tous les motifs : borne haute, garde moins sensible, jamais plus. Sans référence, la retenue reste non
  bloquante (§1 interdit qu'une retenue native bloque faute d'historique) et le bilan le dit
  (`guardWithoutReference`, ligne « garde technique sans référence » dans l'alerte). Au rejeu du 24/09, les 15 sources
  Workday sont sans référence : les RUN du 23/09 (images `653920c`, `a532165`) n'émettaient pas encore le
  marqueur, ajouté le 24/09 (`f1d16b4`) ; le RUN du 24/09 l'a émis. Une retenue qui emporte plus de la moitié du
  volume publié précédent est déjà un effondrement. Limites connues : une source saturée ne peut plus bondir
  (Levi's : 1 268 offres non publiées sur 1 270, 99,8 %) ; un saut accepté devient la référence suivante ; pour
  un jobboard filtré par secteur, la part de la référence compte aussi les offres hors secteur.
- **« Non prouvée » n'est pas « réfutée », et les deux bloquent** (décidé, D-453 §1, précisé le 25/09).
  `complete: false` sans aucun fait observé qui contredise la fin du parcours — lien depuis une page d'accueil,
  flux RSS/Atom, pager terminé sur une page vide — est une énumération **non prouvée** : DEGRADED, `UNKNOWN` /
  `ENUMERATION_NOT_PROVEN`, note « énumération non prouvée … à instruire ». Avec un fait observé (total annoncé
  non atteint ou contredit, identifiant répété, motif de parcours nommé par l'adaptateur, ligne illisible), elle
  est **réfutée** : `UNKNOWN` / `ENUMERATION_REFUTED`, le fait est nommé ; une troncature garde son libellé
  propre. Une énumération **inconnue** (`complete` absent) ne fait aucun incident (règle du 11/09). Aucune des
  trois n'atteste une absence. La sortie de l'adaptateur et sa preuve scellée ne changent pas — seule la lecture
  du RUN distingue non prouvée et réfutée (`pipeline/enumerationReading.ts`) — pour que le rejeu des collectes
  antérieures reste exact. Limite connue : la lecture ignore `enumeration.termination`, les `scopes` et les écarts
  au total déclaré inférieurs à 10 % ; un adaptateur qui voit une coupure sans la nommer (ex. Workable, un arrêt
  `REPEATED_PAGE` de DigitalRecruiters) serait dit « non prouvé » au lieu de « réfuté » — toujours bloquant.
- **L'alerte et le bilan disent ce qui bloque, et pourquoi chaque offre est retenue** (défauts corrigés).
  L'alerte empile un bloc par source (lisible sur téléphone, plus de tableau) : chaque bloc dit « bloquant » ou
  « non bloquant » ; « chaque ligne est une source à investiguer » ne coiffe que les bloquantes ; les retenues
  sont toutes listées, par nombre d'offres décroissant, avec leur total. Chaque motif a sa ligne : le texte
  (« l'annonce ne nomme pas l'employeur (X % des offres collectées de la source) », « la source rend la
  candidature impossible » pour une candidature close, une 404, une 410 ou un modèle expiré, « écartée par
  l'équipe » pour le périmètre), le statut (« décidé » avec sa décision, « application non arbitrée », rien pour
  un motif à instruire, dont le texte le dit déjà) et ce qui reste en ligne (voir plus haut) ; la garde se
  nomme « garde technique ». Une retenue décidée n'est jamais dite « non résolue ». Un refus d'identité dit sa
  cause en clair, depuis les codes bornés du rapport scellé (motifs de `identity/errors.ts`) : « 477 erreurs de
  collecte ou d'écriture, dont 477 refus d'identité (employeur non certifié : 477) ». Au RUN du 24/09 (lecture
  seule, `audits/2026-09-25/scripts/refus-identite-motifs-2409.mts`) : 1 446 refus sur 20 sources, 1 371
  « employeur non certifié » (portail non certifié mono-marque) et 75 « nouvelle graphie de l'employeur »
  (b-s-international 59, funky-buddha 15, swatch-group 1).
  Une source qui échoue avant toute collecte aboutie (exception de la source, délai, anti-bot) est « non
  collectée » : « aucune collecte aboutie par ce RUN ; ses offres en ligne restent publiées », jamais « en
  panne, 0 offre publiée » (le refresh ne ferme rien sans collecte attestée). Aucun tiret cadratin, même dans le
  texte d'erreur d'une source (D-319). Le bilan `ingest.completed` nomme les causes non bloquantes
  (`nonBlockingCauses` : `NATIVE_RETENTION`, `NATIVE_HTTP_5XX`), liste sans troncature `nativeRetentions`,
  `teamExclusions`, `guardWithoutReference`, `retainedOnBlockingSources` et `retainedStillOnline`, et met les
  lignes bloquantes en tête de `failures`.
  Un RUN ciblé dont les seules sources retiennent sur preuve de la source finit COMPLETED_WITH_ERRORS, jamais
  `ALL_SOURCES_FAILED`. Défaut connu : l'alerte part avant le bilan (`cli.ts`) et ne porte pas l'issue du RUN.
- **Le registre des invérifiables parle le vocabulaire du RUN** (défaut corrigé). Il lit les mêmes listes
  (`retentionClass`) : candidature impossible, retrait, test, événement y sont des retenues décidées
  (`NATIVE_EVIDENCE`), l'exclusion de périmètre une décision de l'équipe non bloquante, l'échec de lecture un
  cas à instruire ; l'employeur absent de l'annonce Workday y reste à instruire (seule une certification du
  propriétaire du portail permettrait de publier). Une énumération `complete: false` y est dite non prouvée ou
  réfutée, jamais « le balayage n'a pas atteint la fin » ; une énumération inconnue y a sa propre nature
  (`ENUMERATION_UNKNOWN`), non bloquante comme au RUN, et une source sans défaut nommé n'a pas pour autant le
  droit d'attester. Les délais de 30 jours des preuves de la source et de 90 jours d'une énumération inconnue
  sont des choix techniques, non arbitrés. Les règles
  et les textes vivent dans `pipeline/unverifiable.ts` (`registerEntries`), sous témoin ; le script ne fait que
  lire et écrire.
- **Traçabilité des corrections.** `DataCorrection.commitHash` porte le SHA de la release embarquée,
  le même que `PipelineRun.revision` ; `LOCAL_WORKTREE` ne désigne plus qu'un poste local sans release.
  Les 755 puis 54 corrections de cycle de vie (`REFRESH_LIFECYCLE`) écrites en production les 23 et
  24/09 portent `LOCAL_WORKTREE` : elles restent telles quelles (aucune réparation historique) ; leur
  SHA se retrouve en rapprochant leur `createdAt` de la fenêtre du `PipelineRun` qui les a écrites
  (le lot `refresh:<uuid>` ne porte pas l'identifiant du RUN).

| Résultat du RUN normal | PipelineRun / worker | Sortie / Healthchecks |
|---|---|---|
| Toutes les sources traitées, aucun incident (une exclusion de périmètre seule n'en est pas une) | COMPLETED | 0 / succès |
| RUN terminé, uniquement des incidents SOURCE prouvés (HTTP 5xx natif ; retenues sur preuve de la source, dans la release attestée par `runtime-release.json`), autres sources réussies, récapitulatif transmis | COMPLETED_WITH_ERRORS | 0 / succès ; incidents conservés et alertés |
| Erreur INTERNAL ou UNKNOWN (dont pannes de transport, énumérations non prouvées ou réfutées, troncatures, retenues à instruire, saut de la preuve négative, refus d'identité), aucune source, toutes les sources en échec, RUN incomplet, finalisation/alerte/heartbeat indisponible | FAILED | non nulle / fail |
| Arrêt du processus en cours | INTERRUPTED en base quand la persistance reste possible ; FAILED côté worker | non nulle / fail |

L'ingestion ciblée `ingest --source=<clé>` (comme `ingest` sans argument) garde son verdict strict : toute
attribution, SOURCE comprise (retenue sur preuve de la source, 5xx natif), la rend en échec (code 1) et son
alerte présente la source comme bloquante. Une exclusion de périmètre seule n'est une attribution sur aucun
chemin : code 0, et l'alerte la dit non bloquante. D-453 et D-456 ne portent que sur le RUN quotidien.

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
