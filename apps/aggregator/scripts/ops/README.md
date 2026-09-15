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
| [`cycle-contracts.mts`](cycle-contracts.mts) | Les deux contrats d'un cycle, lus sur la base : `canonicalObservedIds = persistés ∪ retenus ∪ échecs ∪ rejets ∪ erreurs`. Tout est corrélé au **même `runId`** — une retenue historique n'est pas une retenue du cycle. |
| [`refresh-preview.mts`](refresh-preview.mts) | Ce que le refresh ferait, par identifiant, sur le planificateur **commun**. Lit `canonicalIds`, jamais `ids`. `--manifest-out=<fichier>` fige les désactivations avec leur preuve et le hash de l’état de l’offre. |
| [`bounded-refresh.sh`](bounded-refresh.sh) | Le refresh borné. **Refuse de démarrer si `INGEST_ONLY_KEYS` est posé** : un refresh ne collecte rien. Un manifeste vide arrête la chaîne en succès. La commande déployée est bornée **deux fois** : `REFRESH_ONLY_KEYS` *et* le manifeste version 2 complet chargé par empreinte. Les retraits d’orphelins et réouvertures ne font pas partie de ce mode. |
| [`railway-service.py`](railway-service.py) `execute` | Refuse de déclencher une exécution si le déploiement n'est pas SUCCESS, si le commit diffère, si la commande déployée n'est pas celle qu'on a posée, si le périmètre déployé n'est pas **exactement** l'allowlist attendue (via `INGEST_ONLY_KEYS` **ou** `REFRESH_ONLY_KEYS`), ou s'il porte **les deux** — un état incohérent n'est pas deux fois plus sûr. Sans cette garde, un `execute` lancé après un redéploiement automatique relancerait le pipeline **complet** en production. Contre-exemples en test : [`src/ops/executeGuard.test.ts`](../../src/ops/executeGuard.test.ts). |
| [`refresh-audit.mts`](refresh-audit.mts) | Lit les écritures et omissions expliquées dans `DataCorrection`, créé dans la transaction du refresh. Compare les identifiants et conséquences au manifeste, sans déduire les mutations d’une date de fermeture. |
| [`cycle-compare.mts`](cycle-compare.mts) | Cycle 1 contre cycle 2, **par identifiant**. Seule l'intersection des absences des deux cycles peut fonder une fermeture. |
| [`record-employer-alias.mts`](record-employer-alias.mts) | Une décision d'identité : libellé **exact**, portée **source**, preuve archivée dont le sha256 est vérifié. Refuse un alias global. |

### Cycle de vie et échéances

[`refresh-manifest.mts`](refresh-manifest.mts) archive le plan avant exécution. La table `MaintenancePlan` refuse les modifications et suppressions ; chaque worker contrôle à nouveau l’empreinte lors du chargement.

- `REFRESH_ONLY_KEYS` absent : portée non bornée. Une valeur explicitement vide : aucune mutation.
- Une source cassée ou sans preuve complète ne prouve aucune absence. Un zéro explicitement annoncé et entièrement parcouru peut le faire.
- `REFRESH_MAX_CLOSE_RATIO=0.05`, `REFRESH_MIN_CLOSE_FOR_GUARD=50`, `REFRESH_STALE_HOURS=48` sont les valeurs par défaut du même moteur pour le preview et l’exécution. Le ratio porte sur les offres actives du périmètre de sources ; il bloque à partir de 50 retraits/fermetures prévus. Les limites du manifeste sont figées dans son empreinte.
- Un manifeste version 2 désactive seulement les représentations nommées. L’état de l’offre et de ses autres publications est vérifié sous verrou. Une preuve ou un état nouveau entraîne une omission tracée ; relancer le même manifeste ne rejoue pas la mutation.
- `JobSource.expiresAt` vient d’un chemin RAW qualifié. Les jours sans heure expirent après la fin de la journée dans tous les fuseaux (lendemain à 12:00 UTC). La preuve garde cette politique et la valeur originale. Une date telle que `9999-12-31`, dont la fin calculée dépasse la plage de Prisma, conserve `BEYOND_STORAGE_RANGE` dans la preuve et aucun instant inventé. `Job.validThrough` ne remplace jamais cette preuve.
- [`source-expiry.mts`](source-expiry.mts) prépare le rattrapage RAW par pages de 250 (`preview --keys=… --out=…`). Le plan version 3 lie chaque échéance à une identité native qualifiée et vérifie toute capture référencée. `apply --plan=… --hash=…` revalide preuves et état, puis journalise les changements de cache de façon idempotente. La révision est calculée automatiquement ; `--revision` est refusé. Une page contenant un examen non résolu ne peut pas être appliquée. Le preview doit être répété si la source, son URL, sa capture ou le lecteur a changé. Les RAW, contenus, activités et dates d’attestation restent inchangés.
- Les tests PostgreSQL de `refresh.test.ts`, `expiry.test.ts`, `sourceExpiry.test.ts` et les tests API couvrent les invariants. Les anciens scripts manuels de parité et le second calcul du manifeste ont été supprimés.

### Ce qu'une absence exige

Une absence n'est jamais déduite d'un `lastSeenAt` ancien — ce serait une preuve de **non-ré-attestation**.
Elle exige que l'identifiant ne figure pas dans l'ensemble **réellement observé**, lu dans
`pageEvidence[].canonicalIds` et corrélé au run par `runId`. Et cet ensemble doit parler le même langage que la
base : mesuré le 2026-09-12, un adaptateur archivait des *diffusions* là où la base stocke des *annonces* —
recouvrement nul, 37 offres vivantes déclarées absentes.

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


## Integrating a source, and proving it

Les scénarios P3 ci-dessous rejouent sur captures et clones. Ils ne constituent pas encore un parcours unique d’ajout de source : des chemins datés et plusieurs commandes de validation subsistent. Le lot sources doit les remplacer selon le contrat d’architecture, puis supprimer les anciens appelants.

| | |
|---|---|
| [`offline-transport.ts`](offline-transport.ts) | Replaces the network transport and **nothing else**: the seam is at `globalThis.fetch`, *under* the adapters, so the ATS adapter, the normalisers, the identity gate, the scope rules, the dedup and the upsert all run for real. An unrecorded request **fails loudly** — returning an empty body would fabricate a source with no postings. |
| [`record-cassette.mts`](record-cassette.mts) | Online, once per source: runs the real adapter through the production dispatch table and saves every response, robots.txt included. Writes to no database. |
| [`make-candidate.mts`](make-candidate.mts) | Clone only. Turns an existing source back into a **not-yet-integrated candidate** so onboarding starts from `exists:false`. Orphan Jobs are deactivated, not deleted. |
| [`onboard-source.mts`](onboard-source.mts) | The full path — `register → validate → certify → promote → ingest` — calling only maintained pipeline functions, with the state **re-read from the database after every transition**. |
| [`replay-ingest.mts`](replay-ingest.mts) | `ingestAllBySource` itself, offline, on a clone. `--crash-after=N` kills the process after N **committed transactions** (the ingest persists through `$transaction`, not `job.update`) to produce a genuinely partial write. Separates observed identifiers from those actually written. |
| [`config-change.mts`](config-change.mts) | Changes a real `Source.config` and shows the certification stop applying, because `sourceIdentityHash` binds the review to the configuration. |
| [`validator-regression.mts`](validator-regression.mts) | Applies an **earlier and a corrected version of a shared control** (`classifyLabel`) to the same archived proofs, and names the certifications that exist only because of the correction. Locked by [`src/ops/validator-regression.test.ts`](../../src/ops/validator-regression.test.ts). |
| [`onboarding-proof.mts`](onboarding-proof.mts) | The proof, read back from the clone: state transitions, `JobSource` representations as well as `Job` rows, identifiers **observed** vs **created/modified**, and values field by field. |

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

## Captures et rétention — lot 2

Le [contrat maintenu](../../../../docs/architecture/native-capture.md) décrit les tables, les limites, la configuration privée et les commandes. [`raw-capture.mts`](raw-capture.mts) lit les réponses natives, les sorties par offre et les observations historiques, ou rejoue une extraction hors ligne. [`retention.mts`](retention.mts) prépare et applique un plan borné dont l’empreinte doit être fournie explicitement.

Le mécanisme unique déplace les corps vers des blocs S3 vérifiés et conserve les métadonnées en base. Les anciens `retention-observations.mts`, `observationArchive.ts` et `bloc0-snapshot.mts` ont été supprimés. Une migration refuse de supprimer les anciennes tables si elles contiennent encore des références d’archive. Aucun cron n’est activé par ces commandes.

## Reprise des faits par publication

[`source-facts.mts`](source-facts.mts) prépare un plan borné par source, avec différences et empreintes, puis l’applique sous contrôle de ces preuves. La [documentation des faits](../../../../docs/architecture/source-facts.md) décrit les états, les limites et la pagination. L’ancien `scripts/trust/backfill-workplace.mts` a été supprimé : il choisissait la première interprétation et ne corrigeait pas les valeurs déjà remplies.

Les commandes `apply-domain-sheet` et `separate-fused` sont également retirées. Les [décisions d’identité](../../../../docs/architecture/publication-identity.md) remplacent les fusions par proximité de titre. Les réparations d’employeurs passent par `scripts/identity/cli.mts` et leur plan revu ; la reprise des groupes historiques est en cours dans le lot 4.
