# Operations — the versioned, reviewable executables

Les commandes maintenues vivent dans ce dossier ; les captures, dumps et identifiants d’accès restent privés. L’[architecture courante](../../../../docs/architecture/production-foundations.md) définit les contrats à livrer et les circuits à supprimer. Les chaînes de mutation ci-dessous restent des prototypes tant que leur répétition complète n’est pas validée ; leur présence ne certifie pas la production.

## Runtime Railway courant

Le [runbook de livraison](../../../../docs/architecture/railway-runtime-reset.md), le [contrat cible](../../../../docs/operations/railway/runtime-target.json) et le [reçu de release](../../../../docs/operations/railway/runtime-release.json) décrivent les services `catwalks-catalogue-api` et `catwalks-ingestion-worker`. Leurs images immuables sont livrées explicitement, sans autodeploy. Les quatre anciens services ont été supprimés ; leurs pilotes, gardes de fusion et runners qui remplaçaient la commande de démarrage ont été retirés.

Le worker courant passe par `sh apps/aggregator/start.sh` et applique le contrat de runtime et la pause. Les lectures de runs et de preuves restent disponibles dans les outils ci-dessous ; elles ne déclenchent pas une livraison.

`railway_api.py` reste le transport de [`recuperer-tous-verdicts.py`](recuperer-tous-verdicts.py), lecteur **historique** des logs de l'ancien aggregator. Ce lecteur ne décrit pas les nouveaux services. L'accès aux anciens logs après suppression du service n'est pas garanti ; les verdicts déjà archivés restent dans le stockage privé. [`exporter-domaines-divergents.mts`](exporter-domaines-divergents.mts) relit cette archive privée, `backups/verdicts-campagne.json`. Aucun secret n'est chargé depuis un exécutable privé.

Tests hors réseau du transport historique :

```sh
python3 -B -m unittest discover -s apps/aggregator/scripts/ops/tests -p test_railway.py
```

### Réparer une répartition de publications

Le [contrat d’identité](../../../../docs/architecture/publication-identity.md) décrit la requête, les limites et les preuves exigées. La prévisualisation est en lecture seule et crée un nouveau fichier privé ; l’application exige son empreinte exacte.

```sh
npx tsx scripts/ops/publication-groups.mts --request=partition.json --out=plan.json
npx tsx scripts/ops/publication-groups.mts --apply --plan=plan.json --hash=<empreinte-du-plan>
```

Chaque publication doit apparaître une seule fois dans la répartition complète des groupes nommés. Le plan version 3 reconstruit le contenu avec le lecteur RAW actuel, y compris lorsqu’une sortie archivée est référencée. Il vérifie séparément la provenance de cette capture et garde son empreinte distincte de celle du contenu reconstruit. Un RAW insuffisant demande une recollecte ou une qualification ; l’outil ne copie pas le contenu de l’ancien groupe. Une restauration conserve les événements antérieurs et ajoute une décision compensatrice. Une répétition du plan ne répète pas les mutations.

## Restauration opérationnelle sans réparation de données

[`restore-operational.py`](restore-operational.py) restaure un dump hashé dans une **base Docker locale neuve**, sans nullification, suppression ni création d’objet métier. La [politique versionnée](restore-operational-policy.json) fixe les 45 FK et les populations/hashes exacts : les 8 FK historiques sont recréées `NOT VALID`, les 37 autres normalement. Toute différence de schéma/population ou toute erreur post-data échoue ; la liste ne s’élargit jamais automatiquement.

```sh
python3 -B apps/aggregator/scripts/ops/restore-operational.py \
  --dump /chemin/prive/production.dump --dump-sha256 SHA256_DU_DUMP \
  --container catwalks-consolide-rehearsal --database restore_operational_essai \
  --out-dir /chemin/prive/nouvel-essai
```

`NOT VALID` conserve les anciennes lignes et active les contrôles des nouvelles écritures. L’outil vérifie les triggers et le rôle de réplication, tente des nouvelles insertions orphelines en transactions annulées et exerce chaque définition FK avec les vrais parents dans un schéma témoin annulé. Certains triggers métier refusent avant la FK : leur erreur exacte est conservée séparément du témoin RI `23503`. Aucune désactivation de trigger. Les empreintes de **toutes les lignes de toutes les tables et des séquences** doivent rester identiques.

Un exit 0 certifie cette restauration structurelle explicite ; API, `/emplois` et Golden Path doivent ensuite passer avant le canari. Le résultat distingue les 37 VALID des 8 NOT VALID. Le `repair` précédent est retiré : aucun mode de nullification n’est conservé. L’ancien script `nettoyer-collecte.mts`, sans appelant actuel et lié à un reset antérieur, est supprimé ; un témoin interdit son retour et les mécanismes de désactivation d’intégrité dans les entrypoints.

```sh
INTEGRITY_TEST_CONTAINER=catwalks-consolide-rehearsal python3 -B -m unittest discover \
  -s apps/aggregator/scripts/ops/tests -p 'test_restore_operational.py'
```

La base et le dossier de résultat doivent être nouveaux. `--pg-restore` désigne le binaire PostgreSQL compatible installé sur l’hôte. Cette procédure ne possède aucun mode production et n’autorise aucun nettoyage historique.

## Données et preuves de répétition

| | |
|---|---|
| [`gate.mts`](gate.mts) | The blocking check between rehearsal and production. Exits non-zero when the replay changed anything, when the touched identifiers are not the declared perimeter, or when an invariant fails. Compares **sets**, and treats a **missing declaration as unverifiable, never as zero**. Tested in [`src/ops/gate.test.ts`](../../src/ops/gate.test.ts) — nine tests, all asserting exit 1. |
| [`db.py`](db.py) | Which database, read-only or not, how the URL is built — `production` / `readonly` / `clone` / `test`. Secrets come from a host-local file named by `CATWALKS_DB_ACCESS`. |
| [`running-pipeline-runs.mts`](running-pipeline-runs.mts) | Lit les runs sans fin attestée dans la base ; ne déduit pas leur état des anciens crons. |

## Preuves de collecte et manifestes de refresh

Un cycle ne se déclare pas terminé parce qu'il a tourné : chaque étape doit avoir produit sa preuve, et le
refresh ne touche que ce qui a été revu.

| | |
|---|---|
| [`cycle-contracts.mts`](cycle-contracts.mts) | Les deux contrats d'une collecte, lus sur la base : `canonicalObservedIds = publiés ∪ retenus ∪ échecs ∪ rejets ∪ écartés`. Tout vient de la **capture attestante** de la source (manifeste scellé et rapport de fin d'ingestion), lue par le même lecteur que le refresh — jamais de `SourceRun` ni de `PipelineEvent`. |
| [`refresh-preview.mts`](refresh-preview.mts) | Ce que le refresh ferait, par identifiant, sur le planificateur **commun**. Lit `canonicalIds`, jamais `ids`. Chaque source recevable nomme sa capture attestante (`eligibility[].captureBatchId`). `--manifest-out=<fichier>` fige les désactivations avec leur preuve et le hash de l’état de l’offre. |
| [`refresh-audit.mts`](refresh-audit.mts) | Lit les écritures et omissions expliquées dans `DataCorrection`, créé dans la transaction du refresh. Compare les identifiants et conséquences au manifeste, sans déduire les mutations d’une date de fermeture. |
| [`cycle-compare.mts`](cycle-compare.mts) | Cycle 1 contre cycle 2, **par identifiant**. Seule l'intersection des absences des deux cycles peut fonder une fermeture. |
| [`record-employer-alias.mts`](record-employer-alias.mts) | Une décision d'identité : libellé **exact**, portée **source**, preuve archivée dont le sha256 est vérifié. Refuse un alias global. |

### Cycle de vie et échéances

[`refresh-manifest.mts`](refresh-manifest.mts) archive le plan avant exécution. La table `MaintenancePlan` refuse les modifications et suppressions ; chaque worker contrôle à nouveau l’empreinte lors du chargement.

- `REFRESH_ONLY_KEYS` absent : portée non bornée. Une valeur explicitement vide : aucune mutation.
- Une source cassée ou sans preuve complète ne prouve aucune absence. Un zéro explicitement annoncé et entièrement parcouru peut le faire.
- `REFRESH_MAX_CLOSE_RATIO=0.05`, `REFRESH_MIN_CLOSE_FOR_GUARD=50`, `REFRESH_STALE_HOURS=48` sont les valeurs par défaut du même moteur pour le preview et l’exécution. Le ratio porte sur les offres actives du périmètre de sources ; il bloque à partir de 50 retraits/fermetures prévus. Les limites du manifeste sont figées dans son empreinte.
- Un manifeste version 4 désactive seulement les représentations nommées ; chaque preuve d’absence y nomme sa capture attestante. L’état de l’offre et de ses autres publications est vérifié sous verrou. Une preuve ou un état nouveau entraîne une omission tracée ; relancer le même manifeste ne rejoue pas la mutation. Les manifestes des versions antérieures restent de l’historique : le lecteur `loadRefreshManifest` les refuse.
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

[`source-add.mts`](source-add.mts), lancé par `start.sh source-add`, reçoit une définition typée et qualifie **une** source sous le lecteur courant ; aucun JSON manuel ni statut SQL. Il réutilise [`source-campaign.mts`](source-campaign.mts), avec périmètre explicite, options strictes, dossier de preuve neuf, observation persistée et signal d'échec. Chaque lancement requalifie : aucune reprise fondée sur un ancien verdict. Les sources PAUSED et RETIRED sont refusées. [`source-campaign-report.mts`](source-campaign-report.mts) reste un lecteur des verdicts ; [`source-campaign-candidates.sql`](source-campaign-candidates.sql) reste un export des sources ACTIVE. Les anciens lanceurs `campagne-railway`, `collecte-massive`, `qualification-massive`, `source-requalify` et `enregistrer-source` ont été supprimés. Voir le [runbook canari](../../../../docs/architecture/canary-operations.md).

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

## Livraison explicite

Une fusion Git ne déploie plus les services Railway. Toute livraison ou interruption du worker suit le [runbook courant](../../../../docs/architecture/railway-runtime-reset.md) et son contrôle des exécutions en cours. Les anciennes gardes de fusion attachées aux services supprimés ne sont plus des commandes d'exploitation.

## Mesures datées, rejouables

Des preuves gravées avec leur lot, pas des procédures courantes : on les rejoue pour re-mesurer, jamais pour opérer.

- [`verif-couverture-registre.mts`](verif-couverture-registre.mts) (`npm run verif:couverture`) et [`verif-couverture-marches.mts`](verif-couverture-marches.mts) : les taux gravés dans `packages/db/marches.ts`, recomptés sur la bonne colonne, en lecture seule stricte.
- [`verif-marche-cn.mts`](verif-marche-cn.mts), [`verif-marche-cn-facettes.mts`](verif-marche-cn-facettes.mts), [`verif-marche-cn-discrimination.mts`](verif-marche-cn-discrimination.mts), [`verif-marche-cn-dimension-unique.mts`](verif-marche-cn-dimension-unique.mts) : les mesures du marché Chine (lot 6, 15/09/2026) — ouverture, facettes côté site, pouvoir de discrimination, dimension unique `工作性质`.
- [`p9-verdict.mts`](p9-verdict.mts) `--keys=a,b [--run-id=…]` : le verdict complet d'une ingestion P9 par source, la chaîne entière sans trou entre deux nombres.
- [`wave-candidates.mts`](wave-candidates.mts) `--actors=<actors.csv> [--limit=40]` : le vivier d'une vague, construit en sondant les portails (D33 : 45 % des `careers.<domaine>` devinés étaient des NXDOMAIN).

Retirés au lot 12 (16/09/2026), sans remplaçant parce que sans usage : `_ca2.mts`, `_demote.mts`, `p9-ingest-facts.mts`, `p9-set-locale.mts`, `p9-url-proof.mts` (essais et mutations ponctuels de septembre).
