# Operations — the versioned, reviewable executables

Les commandes maintenues vivent dans ce dossier ; les captures, dumps et identifiants d’accès restent privés. L’[architecture courante](../../../../docs/architecture/production-foundations.md) définit les contrats à livrer et les circuits à supprimer. Les chaînes de mutation ci-dessous restent des prototypes tant que leur répétition complète n’est pas validée ; leur présence ne certifie pas la production.

Le transport GraphQL commun est [`railway_api.py`](railway_api.py), utilisé par le contrôle des services, le contrôle des crons et la garde de déploiement. Il utilise `CATWALKS_RAILWAY_TOKEN` ou la connexion CLI Railway. Aucun exécutable de transport n’est chargé depuis `backups/`.

```sh
python3 -B apps/aggregator/scripts/ops/railway-service.py status api
python3 -B apps/aggregator/scripts/ops/read-crons.py
python3 -B -m unittest discover -s apps/aggregator/scripts/ops/tests
```

Les noms acceptés sont `aggregator`, `api`, `refresh` et `reconcile`. Le nom public courant est `catwalks-api` ; les commandes bornées ne s’appliquent qu’à l’aggregator. Le préflight compare les révisions de l’API et du worker séparément, y compris leurs dépendances partagées.

Le service Railway `reconcile` est conservé ici comme identifiant d’exploitation d’un service gelé. Son ancienne commande globale n’existe plus dans le runtime.

### Réparer une répartition de publications

Le [contrat d’identité](../../../../docs/architecture/publication-identity.md) décrit la requête, les limites et les preuves exigées. La prévisualisation est en lecture seule et crée un nouveau fichier privé ; l’application exige son empreinte exacte.

```sh
npx tsx scripts/ops/publication-groups.mts --request=partition.json --out=plan.json
npx tsx scripts/ops/publication-groups.mts --apply --plan=plan.json --hash=<empreinte-du-plan>
```

Chaque publication doit apparaître une seule fois dans la répartition complète des groupes nommés. Le plan version 3 reconstruit le contenu avec le lecteur RAW actuel, y compris lorsqu’une sortie archivée est référencée. Il vérifie séparément la provenance de cette capture et garde son empreinte distincte de celle du contenu reconstruit. Un RAW insuffisant demande une recollecte ou une qualification ; l’outil ne copie pas le contenu de l’ancien groupe. Une restauration conserve les événements antérieurs et ajoute une décision compensatrice. Une répétition du plan ne répète pas les mutations.

## Mutating production

| | |
|---|---|
| [`mutation.sh`](mutation.sh) | The single entry point for any production data mutation: guards → perimeter → backup → **restore** (the restore *is* the proof the backup is usable) → rehearsal on the clone → gate → before → apply → after + replay → archive. Resume is fingerprint-based, not marker-based. Still qualified as a **prototype not validated for exploitation**. |
| [`gate.mts`](gate.mts) | The blocking check between rehearsal and production. Exits non-zero when the replay changed anything, when the touched identifiers are not the declared perimeter, or when an invariant fails. Compares **sets**, and treats a **missing declaration as unverifiable, never as zero**. Tested in [`src/ops/gate.test.ts`](../../src/ops/gate.test.ts) — nine tests, all asserting exit 1. |
| [`deploy-guard.py`](deploy-guard.py) | Refuses a merge while a deployment or a production run is in flight. A run may be exempted explicitly with `--allow-running <id>`, never by a hard-coded id. |
| [`db.py`](db.py) | Which database, read-only or not, how the URL is built — `production` / `readonly` / `clone` / `test`. Secrets come from a host-local file named by `CATWALKS_DB_ACCESS`. |
| [`read-crons.py`](read-crons.py), [`running-pipeline-runs.mts`](running-pipeline-runs.mts) | Read the frozen cron schedules and any run still in flight. |

## Un cycle P7 borné : ingestion, preuve, manifeste, refresh

Un cycle ne se déclare pas terminé parce qu'il a tourné : chaque étape doit avoir produit sa preuve, et le
refresh ne touche que ce qui a été revu.

| | |
|---|---|
| [`ingest-preflight.py`](ingest-preflight.py) | Impose les étapes 1 à 8 et **refuse en exit 1** : commit figé, arbre propre, aucun run en vol, les **deux** services vérifiés séparément (`DEPLOYED_AT_COMMIT` / `SAME_CODE_FOR_THIS_SERVICE` démontré par le diff / `STALE_CODE`), allowlist exacte, sauvegarde **restaurée** et comparée sur six grandeurs, canaux d'alerte **testés par émission réelle**. Refuse aussi **avant la première écriture** si le disque n'a pas 8 Gio libres — le dump *et* le clone restauré tiennent sur le même disque — et **rend** la base clone une fois qu'elle a prouvé la restauration (jamais si la comparaison a échoué : ce clone-là doit rester inspectable). |
| [`bounded-ingest.sh`](bounded-ingest.sh) | Une ingestion bornée, sans aucun tube — le code de sortie d'un tube est celui de sa dernière commande. Pose la commande bornée, attend le SUCCESS sur CE commit, exécute, attend un statut **terminal** (restaurer plus tôt tuerait le run), restaure, contrôle les variables et les crons. |
| [`bounded-command.py`](bounded-command.py), [`bounded-refresh-command.py`](bounded-refresh-command.py) | Les commandes de démarrage, échappées par `shlex` — assemblées en shell elles se cassent en silence, et une commande malformée qui se déploie remplace la commande normale par quelque chose qui échoue. Le refresh y porte l’empreinte du manifeste immuable stocké dans `MaintenancePlan` ; le volume du plan ne gonfle pas la commande. |
| [`cycle-contracts.mts`](cycle-contracts.mts) | Les deux contrats d'une collecte, lus sur la base : `canonicalObservedIds = publiés ∪ retenus ∪ échecs ∪ rejets ∪ écartés`. Tout vient de la **capture attestante** de la source (manifeste scellé et rapport de fin d'ingestion), lue par le même lecteur que le refresh — jamais de `SourceRun` ni de `PipelineEvent`. |
| [`refresh-preview.mts`](refresh-preview.mts) | Ce que le refresh ferait, par identifiant, sur le planificateur **commun**. Lit `canonicalIds`, jamais `ids`. Chaque source recevable nomme sa capture attestante (`eligibility[].captureBatchId`). `--manifest-out=<fichier>` fige les désactivations avec leur preuve et le hash de l’état de l’offre. |
| [`bounded-refresh.sh`](bounded-refresh.sh) | Le refresh borné. **Refuse de démarrer si `INGEST_ONLY_KEYS` est posé** : un refresh ne collecte rien. Un manifeste vide arrête la chaîne en succès. La commande déployée est bornée **deux fois** : `REFRESH_ONLY_KEYS` *et* le manifeste version 4 complet chargé par empreinte. Les retraits d’orphelins et réouvertures ne font pas partie de ce mode. |
| [`railway-service.py`](railway-service.py) `execute` | Refuse de déclencher une exécution si le déploiement n'est pas SUCCESS, si le commit diffère, si la commande déployée n'est pas celle qu'on a posée, si le périmètre déployé n'est pas **exactement** l'allowlist attendue (via `INGEST_ONLY_KEYS` **ou** `REFRESH_ONLY_KEYS`), ou s'il porte **les deux** — un état incohérent n'est pas deux fois plus sûr. Sans cette garde, un `execute` lancé après un redéploiement automatique relancerait le pipeline **complet** en production. Contre-exemples en test : [`src/ops/executeGuard.test.ts`](../../src/ops/executeGuard.test.ts). |
| [`refresh-audit.mts`](refresh-audit.mts) | Lit les écritures et omissions expliquées dans `DataCorrection`, créé dans la transaction du refresh. Compare les identifiants et conséquences au manifeste, sans déduire les mutations d’une date de fermeture. |
| [`cycle-compare.mts`](cycle-compare.mts) | Cycle 1 contre cycle 2, **par identifiant**. Seule l'intersection des absences des deux cycles peut fonder une fermeture. |
| [`record-employer-alias.mts`](record-employer-alias.mts) | Une décision d'identité : libellé **exact**, portée **source**, preuve archivée dont le sha256 est vérifié. Refuse un alias global. |

### Cycle de vie et échéances

[`refresh-manifest.mts`](refresh-manifest.mts) archive le plan avant exécution. La table `MaintenancePlan` refuse les modifications et suppressions ; chaque worker contrôle à nouveau l’empreinte lors du chargement.

- `REFRESH_ONLY_KEYS` absent : portée non bornée. Une valeur explicitement vide : aucune mutation.
- Une source cassée ou sans preuve complète ne prouve aucune absence. Un zéro explicitement annoncé et entièrement parcouru peut le faire.
- `REFRESH_MAX_CLOSE_RATIO=0.05`, `REFRESH_MIN_CLOSE_FOR_GUARD=50`, `REFRESH_STALE_HOURS=48` sont les valeurs par défaut du même moteur pour le preview et l’exécution. Le ratio porte sur les offres actives du périmètre de sources ; il bloque à partir de 50 retraits/fermetures prévus. Les limites du manifeste sont figées dans son empreinte.
- Un manifeste version 4 désactive seulement les représentations nommées ; chaque preuve d’absence y nomme sa capture attestante. L’état de l’offre et de ses autres publications est vérifié sous verrou. Une preuve ou un état nouveau entraîne une omission tracée ; relancer le même manifeste ne rejoue pas la mutation. Les manifestes des versions antérieures restent de l’historique : `bounded-refresh-command.py` et `loadRefreshManifest` les refusent, et un test Python vérifie que les deux versions ne divergent plus (mesuré le 16 septembre 2026 : la commande exigeait encore la version 2 quand le planificateur produisait la 3).
- `JobSource.expiresAt` vient d’un chemin RAW qualifié. Les jours sans heure expirent après la fin de la journée dans tous les fuseaux (lendemain à 12:00 UTC). La preuve garde cette politique et la valeur originale. Une date telle que `9999-12-31`, dont la fin calculée dépasse la plage de Prisma, conserve `BEYOND_STORAGE_RANGE` dans la preuve et aucun instant inventé. `Job.validThrough` ne remplace jamais cette preuve.
- [`source-expiry.mts`](source-expiry.mts) prépare le rattrapage RAW par pages de 250 (`preview --keys=… --out=…`). Le plan version 3 lie chaque échéance à une identité native qualifiée et vérifie toute capture référencée. `apply --plan=… --hash=…` revalide preuves et état, puis journalise les changements de cache de façon idempotente. La révision est calculée automatiquement ; `--revision` est refusé. Une page contenant un examen non résolu ne peut pas être appliquée. Le preview doit être répété si la source, son URL, sa capture ou le lecteur a changé. Les RAW, contenus, activités et dates d’attestation restent inchangés.
- Les tests PostgreSQL de `refresh.test.ts`, `expiry.test.ts`, `sourceExpiry.test.ts` et les tests API couvrent les invariants. Les anciens scripts manuels de parité et le second calcul du manifeste ont été supprimés.

### Ce qu'une absence exige

Une absence n'est jamais déduite d'un `lastSeenAt` ancien — ce serait une preuve de **non-ré-attestation**.
Elle exige que l'identifiant ne figure pas dans l'ensemble **réellement observé**, lu dans
`pageEvidence[].canonicalIds` du manifeste **scellé** de la capture attestante de la source : sa dernière
collecte admise, achevée par son rapport de fin d'ingestion, et encore capable de publier aujourd'hui (source
ACTIVE, même révision, même décision d'accès, identité et qualification courantes, aucune tentative plus
récente). `SourceRun` et `PipelineEvent` ne sont plus lus pour décider (lot 5G3C). Et cet ensemble doit parler
le même langage que la base : mesuré le 2026-09-12, un adaptateur archivait des *diffusions* là où la base
stocke des *annonces* — recouvrement nul, 37 offres vivantes déclarées absentes.

### Une garde qui refuse un état conforme est un défaut, pas une sécurité

Mesuré le 2026-09-12 : la garde d'`execute` exigeait `INGEST_ONLY_KEYS` dans la commande déployée. Or un
refresh porte `REFRESH_ONLY_KEYS` — **un refresh ne collecte rien**, il ne peut donc pas porter la variable
d'ingestion. La garde était **inatteignable pour un refresh, par construction** : elle n'avait jamais été
exercée sur ce chemin, et elle a bloqué net le premier refresh conforme.

Elle a échoué du bon côté — rien n'a été muté, la commande normale a été restaurée, l'état vérifié inchangé
(79 049 offres actives avant comme après). Mais une garde qui refuse le conforme finit par être contournée
« juste cette fois », et c'est alors la garde elle-même qu'on perd.

La règle qui en sort : **ce qui compte n'est pas le nom de la variable, c'est que le périmètre déployé soit
exactement l'attendu** — et toute garde doit être exercée par un contre-exemple sur *chacun* des chemins
qu'elle prétend protéger, sans quoi elle n'est vérifiée que sur celui qu'on a essayé.

### Ce que le protocole consomme, et pourquoi il doit le rendre

Chaque préflight écrit un dump (~500 Mo) **et** restaure une base clone (~2,5 Go) — sur le même disque. Rien ne
les rendait : le 2026-09-12, 73 dumps (32 Gio) et 25 bases clones (48 Gio) avaient laissé **146 Mo** libres, le
dump est sorti **tronqué**, et `pg_restore` a rendu `found unexpected block ID (0)`. Le préflight a refusé — la
garde a tenu — mais après avoir interrogé la production pour rien.

Deux conséquences, toutes deux dans le code : la place est exigée **avant** la première écriture, et le clone
est **rendu** dès qu'il a prouvé ce qu'on lui demandait. Une sauvegarde tronquée n'est pas une sauvegarde, et
on ne l'apprend qu'à la restauration.


## Ajouter et qualifier une source

[`source-onboard.mts`](source-onboard.mts) est l’entrée unique : `register`, `profile`, `evidence`, `relation`, `identity`, `access`, `collect`, `validate`, `status`, `promote`. Le [guide maintenu](../../../../docs/architecture/source-onboarding.md) décrit les entrées, les portes et leurs limites. L’enregistrement et la revue sont des aperçus sans `--apply`. La capture de preuve, la collecte, la validation et la promotion exigent `--apply` ; la promotion exige aussi la révision explicitement choisie. Aucune étape ne déclenche l’ingestion.

[`source-requalify.sh`](source-requalify.sh) rejoue les preuves d'une source **déjà revue** sous le lecteur courant (captures, dossiers d'identité et d'accès reliés aux nouvelles captures, décisions, promotion, ingestion et prévisualisation du refresh) : nécessaire dès que le code de l'agrégateur change, puisque décisions et captures sont liées à `captureReaderRevision`. [`source-campaign.mts`](source-campaign.mts) qualifie une vague de candidats exportés du registre, séquentiellement, avec un verdict prouvé par source (QUALIFIEE, REFUSEE, INACCESSIBLE, RETIREE, BLOCAGE_EXTERNE, IDENTITE_NON_PROUVEE, DOMAINE_OFFICIEL_MANQUANT, DOMAINE_OFFICIEL_DIVERGENT, COLLECTE_NON_VALIDEE, HORS_PARCOURS), reprend où il s'est arrêté (`--resume`) et n'invente aucune décision : énoncés factuels, périmètres dérivés des requêtes observées, réviseur nommé. Le portail configuré est archivé en premier (servi sur le domaine officiel ou redirigé par son éditeur vers son hôte canonique, il se prouve par lui-même), puis la page officielle, `www`, ses liens « carrières » et les chemins usuels ; les écarts du registre (domaine carrière absent, domaine officiel dérivé du domaine carrière, hôte canonique hors domaine officiel) sont consignés dans `etapes` sans être inventés. [`source-campaign-report.mts`](source-campaign-report.mts) agrège les `verdicts.json` d'une ou plusieurs vagues (dernier verdict par clé) en comptes par verdict, famille et motif, volumes d'offres et éligibilité d'absence, et écrit avec `--registry=<fichier.md>` le registre de qualification source par source (verdict, identité, collecte, accès, publication et motifs de refus d'écriture, absence, écarts du registre) : lecture seule, sans configuration native. Les candidats d'une campagne sortent de [`source-campaign-candidates.sql`](source-campaign-candidates.sql), lecture seule sur une copie du registre (une ligne JSON par source ACTIVE des familles sous contrat, domaine officiel de la Maison par `JobSource` → `Company`), jamais sur la production vivante. Les trois se lancent dans la stack locale par `npm run stack:exec -- …` (lot F3).

[`source-discovery.mts`](source-discovery.mts) conserve `inspect` et `prepare` en lecture seule. Ses rapprochements sont des pistes ; ils ne certifient ni l’identité ni une couverture mondiale. Les anciennes orchestrations P3/B6 et la validation par compteur manuel ont été supprimées.

Outils de diagnostic distincts du parcours de qualification :

| Outil | Rôle |
|---|---|
| [`offline-transport.ts`](offline-transport.ts) | Transport de fixtures pour les répétitions d’ingestion. Une requête non enregistrée échoue. |
| [`record-cassette.mts`](record-cassette.mts) | Capture de fixtures locales de diagnostic, sans écriture en base ; ce format ne remplace pas une validation native de format 2. |
| [`replay-ingest.mts`](replay-ingest.mts) | Répétition d’ingestion sur clone avec interruption contrôlée après transactions validées. |
| [`validator-regression.mts`](validator-regression.mts) | Comparaison de versions du classement de libellés ; ne délivre pas de certification. |

### Two distinctions the proofs depend on

**Representations are not canonical rows.** A posting attested by several sources is one `Job` and several
`JobSource`. Counting only `Job` hides whether the source's own attestations exist at all.

**Observed is not written, and `updatedAt` does not separate them.** A re-attestation stamps `updatedAt` on every
row it re-sees, so on an idempotent second pass "touched" equals "observed" while nothing changed — measured: 6
and 6, with zero field differences. `firstSeenAt` is the unambiguous one: it only moves when a row is born.
Whether anything *changed* is answered by comparing values between two passes, not by a count.

### Preserve the real exit code

An interruption is only proven if its exit code survives. `cmd | grep | tail` reports the exit code of `tail`;
the measured crash exits **137** and must be read directly, or captured with `PIPESTATUS`/a temporary file.

## Captures, validation technique et rétention

Le [contrat maintenu](../../../../docs/architecture/native-capture.md) décrit les tables, les limites, la configuration privée et les commandes. [`raw-capture.mts`](raw-capture.mts) lit les réponses natives, les sorties par offre et les observations historiques, ou rejoue une extraction hors ligne. Le format 2 exige la consommation de toutes les réponses et la concordance des sorties ordonnées ainsi que des métadonnées complètes du résultat. Les collectes historiques sans manifeste ne peuvent pas produire cette validation. Le budget d’exécution est affiché séparément de l’empreinte de configuration. Les collectes enregistrées portent la révision immuable du registre ; une collecte obsolète reste inspectable mais ne peut pas publier dans une nouvelle configuration. Le rejeu utilise toujours le fichier privé des réglages effectifs. Les limites et l’annulation du transport sont communes aux commandes de validation et de lecture de preuve officielle. [`retention.mts`](retention.mts) prépare et applique un plan borné dont l’empreinte doit être fournie explicitement.

`source-onboard.mts collect <clé> --apply --deadline-ms=30000` capture les réglages enregistrés puis les valide hors réseau. `source-onboard.mts validate <capture-id> --apply` revalide une collecte scellée, depuis S3 si nécessaire. Ces deux opérations produisent une décision technique immuable et laissent le statut de la source inchangé. Une sortie vide exige son propre protocole natif qualifié. La promotion consomme maintenant ce verdict, jamais le compteur manuel. Les anciennes orchestrations P3/B6 ont été supprimées. L’identité et l’accès exigent leurs propres décisions immuables ; les anciens champs robots modifiables ont été archivés puis retirés du registre.

Le mécanisme unique déplace les corps vers des blocs S3 vérifiés et conserve les métadonnées en base. Les anciens `retention-observations.mts`, `observationArchive.ts` et `bloc0-snapshot.mts` ont été supprimés. Une migration refuse de supprimer les anciennes tables si elles contiennent encore des références d’archive. Aucun cron n’est activé par ces commandes.

## Reprise des faits par publication

[`source-facts.mts`](source-facts.mts) prépare un plan borné par source, avec différences et empreintes, puis l’applique sous contrôle de ces preuves. La [documentation des faits](../../../../docs/architecture/source-facts.md) décrit les états, les limites et la pagination. L’ancien `scripts/trust/backfill-workplace.mts` a été supprimé : il choisissait la première interprétation et ne corrigeait pas les valeurs déjà remplies.

Les commandes `apply-domain-sheet` et `separate-fused` sont également retirées. Les [décisions d’identité](../../../../docs/architecture/publication-identity.md) remplacent les fusions par proximité de titre. Les réparations d’employeurs passent par `scripts/identity/cli.mts` et leur plan revu ; la reprise des groupes historiques est en cours dans le lot 4.

## Mesurer ce qu'un cycle a coûté

Lecture seule, sur ce que le run a réellement enregistré ; une grandeur absente est rendue `null` avec son motif, jamais complétée.

| Outil | Question à laquelle il répond |
|---|---|
| [`capacity-report.mts`](capacity-report.mts) `--run-id=<id> [--out=…]` | Où sont passés le temps, les requêtes, la mémoire, les connexions et les écritures d'une passe. |
| [`cycle-resources.mts`](cycle-resources.mts) `--run-id=<id>` | Ce qu'un cycle a coûté par source : bornes, compteurs, erreurs, écritures. |
| [`cycle-sets.mts`](cycle-sets.mts) `--keys=a,b --out=…` | Les ensembles d'identifiants d'un cycle, par source, pour comparer deux cycles par « lesquelles » et jamais par cardinaux. |
| [`ingest-facts.mts`](ingest-facts.mts) `--keys=<k1,k2> --phase=before|after …` | Les faits d'une ingestion bornée avant puis après (`--before=<f.json> --since=<iso> --command=<run>`), différence par ensembles d'identifiants, sans fermer aucune offre. |
| [`storage-snapshot.mts`](storage-snapshot.mts) `[--out=…] [--compare=<avant.json>]` | La taille de ce qu'on garde, table par table, avant et après un corpus. |
| [`front-probe.mts`](front-probe.mts) `--phase=<avant|pendant|apres>` | Le site public pendant une ingestion : contrôle de non-régression, pas un test de charge. |

Tous s'exécutent sous `db.py readonly` (ou sur le clone) : `db.py readonly npx tsx scripts/ops/<outil> …`.

## Registre, rapports et clés

| Outil | Rôle |
|---|---|
| [`source-registry.mts`](source-registry.mts) `[--out=…] [--md=…]` | Le registre opérationnel des sources : une décision par source, aucune par défaut (`decideMode`). |
| [`operations-report.mts`](operations-report.mts) `[--out=…] [--md=…]` | L'état courant de chaque source en une lecture (accès, mode, dernier run). |
| [`source-keys.mts`](source-keys.mts) | Les clés du catalogue pour valider une allowlist ; le statut est rendu à côté, jamais comme critère. |
| [`tenant-key-table.mts`](tenant-key-table.mts) `--runs=<id,…>` | La clé de tenant effectivement utilisée par la porte, source par source. |
| [`production-counts.mts`](production-counts.mts) | Les six grandeurs qui prouvent qu'une restauration reproduit la production, en une transaction. |
| [`run-status.mts`](run-status.mts) `--command=<nom>` / [`run-verdict.mts`](run-verdict.mts) | Le statut d'un `PipelineRun` nommé ; le verdict terminal d'un passage borné, lu en base par le runner. |
| [`public-chain-reconcile.mts`](public-chain-reconcile.mts) `--jobs=<id,…>` | Réconcilie les cinq surfaces publiques par identifiant. |
| [`publication-groups.mts`](publication-groups.mts) `--request=… [--apply]` | Prévisualise puis applique une partition de publication complète et bornée. |
| [`purge-preflight-clones.mts`](purge-preflight-clones.mts) `[--keep-latest=2] [--apply]` | Purge les clones de préflight périmés (`db.py clone`). |
| [`backup.py`](backup.py) `<chemin.dump>` | Sauvegarde logique, sous `db.py production`. |

## Fusionner sans tuer un run

[`safe-merge.sh`](safe-merge.sh) `<PR> [args gh pr merge…]` refuse une fusion pendant un passage borné (un déploiement remplace le conteneur et tue le run : incidents du 09/09 et du 13/09/2026). [`run-merge.sh`](run-merge.sh) `<journal.log> <PR>` l'enveloppe pour que le code de sortie lu soit celui de la fusion, jamais celui d'un `tail`. Témoin : `src/ops/safeMerge.test.ts`.

## Mesures datées, rejouables

Des preuves gravées avec leur lot, pas des procédures courantes : on les rejoue pour re-mesurer, jamais pour opérer.

- [`verif-couverture-registre.mts`](verif-couverture-registre.mts) (`npm run verif:couverture`) et [`verif-couverture-marches.mts`](verif-couverture-marches.mts) : les taux gravés dans `packages/db/marches.ts`, recomptés sur la bonne colonne, en lecture seule stricte.
- [`verif-marche-cn.mts`](verif-marche-cn.mts), [`verif-marche-cn-facettes.mts`](verif-marche-cn-facettes.mts), [`verif-marche-cn-discrimination.mts`](verif-marche-cn-discrimination.mts), [`verif-marche-cn-dimension-unique.mts`](verif-marche-cn-dimension-unique.mts) : les mesures du marché Chine (lot 6, 15/09/2026) — ouverture, facettes côté site, pouvoir de discrimination, dimension unique `工作性质`.
- [`p9-verdict.mts`](p9-verdict.mts) `--keys=a,b [--run-id=…]` : le verdict complet d'une ingestion P9 par source, la chaîne entière sans trou entre deux nombres.
- [`wave-candidates.mts`](wave-candidates.mts) `--actors=<actors.csv> [--limit=40]` : le vivier d'une vague, construit en sondant les portails (D33 : 45 % des `careers.<domaine>` devinés étaient des NXDOMAIN).

Retirés au lot 12 (16/09/2026), sans remplaçant parce que sans usage : `_ca2.mts`, `_demote.mts`, `p9-ingest-facts.mts`, `p9-set-locale.mts`, `p9-url-proof.mts` (essais et mutations ponctuels de septembre).
