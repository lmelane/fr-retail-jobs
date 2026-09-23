# Agrégateur Catwalks — état vérifié et exploitation

**État vérifié le 23 septembre 2026.** Le RUN quotidien de 18 h Paris a parcouru 409 sources : 349 OK, 33 partielles, 27 en échec de santé, sans timeout ni échec de persistance. Les correctifs suivants (`3581d05`) sont livrés sur l’API et le worker et vérifiés par replays ciblés ; le [bilan post-RUN](../../audits/2026-09-23/post-run.md) distingue résultats, incidents restants et données historiques gelées. Le CRON normal est rétabli une fois par jour à 18 h Europe/Paris. Les quatre anciens runtimes sont supprimés ; PostgreSQL et son volume sont conservés. Le site, backend, back-office et média ne sont pas déployés.

## Une chaîne opérationnelle

`sh apps/aggregator/start.sh` appelle le worker commun. Sur Railway, `PIPELINE_PAUSED` est **obligatoire** (`0` ou `1`). Sous pause, il sort avant DB/réseau ; sinon il vérifie les migrations sans les appliquer puis lance le CLI. Les images Railway exigent en plus leur contrat embarqué et un profil exact. Un processus déjà démarré doit être arrêté/redémarré pour recevoir une nouvelle variable distante.

Le runner général ne prend que les sources ACTIVE. Le parcours maintenu d'une nouvelle source reste **`start.sh source-add`**, avec `PIPELINE_PAUSED=0`, définition publique, clé et réviseur explicites. Le programme crée DRAFT, réutilise les captures/preuves/portes de qualification existantes, active puis ingère par le CLI normal. Cette définition publique ne réactive pas PAUSED/RETIRED et ne remplace pas une configuration divergente. La variante `--registered-revision` permet de requalifier une seule configuration déjà revue, y compris PAUSED, avec les mêmes preuves obligatoires ; RETIRED reste refusée. Exemple complet : [runbook](../../docs/architecture/canary-operations.md#une-nouvelle-source-sans-modification-manuelle-de-la-base). Le worker de production accepte aussi ce `source-add`, avec le même parseur strict avant toute activité, puis le mode normal sans argument (`ingest-all`) , `scheduled` (déclenchement quotidien) ou `ingest --source=<clé> [--no-geocode]`, avec profil `production` et pause explicite. Voir le [contrat cible](../../docs/operations/railway/runtime-target.json).

La table `Source` est le registre opérationnel ; le RAW archivé reste la référence du contenu publié. Les observations, faits dérivés et projections restent distincts. Un statut ACTIVE ne suffit pas à prouver une qualification ni une absence. Les captures, admissions et fins immuables fondent le cycle de vie, jamais un simple `lastSeenAt` ou un journal d’exécution.

Après autorisation d’exécution, le mode normal et le mode ciblé entretiennent la preuve d’accès de chaque ACTIVE : une décision valide est conservée ; `ACCESS_STALE` ou `ACCESS_MISSING` déclenche la même qualification que `source-add` (capture native, validation par rejeu, robots, décision persistée). La collecte normale repasse ensuite toutes les admissions. Un refus explicite n’est jamais renouvelé automatiquement, même après un changement de révision ; une décision concurrente ne peut pas être écrasée. Même si l’accès reste valide pendant 30 jours, une qualification native périmée (24 h) est recapturée et revalidée sans remplacer la décision d’accès. Une qualification impossible bloque sa source et laisse les autres continuer. Ces preuves appartiennent au même run et au même budget par source. Sous `PIPELINE_PAUSED=1`, aucun de ces appels n’est exécuté.

La restauration du registre passe par `scripts/ops/exporter-registre-sources.mts` puis `reimporter-registre-sources.mts`. Aucun seed historique ni enregistrement SQL parallèle.

## Surveillance et reprise

Les runs, décisions de qualification, résultats de collecte et erreurs sont persistés. Le signal `run.alive` revient toutes les 30 secondes. `worker-status.mts` rend une lecture seule des derniers runs, captures et erreurs ; un RUNNING ancien sans signal récent reste UNVERIFIED. Les commandes maintenues conservent Brevo et heartbeat.

Le retour arrière PR-1 a été exécuté sur base locale dédiée : ancienne API à 85 migrations → candidate à 86 → 23 offres réellement collectées → ancienne API, résultats et fiche identiques. La base reste forward-compatible ; aucun downgrade Prisma ni effacement du ledger. Depuis la migration 88, un retour arrière doit aussi conserver le champ décimal `experienceYears` et un runtime compatible ; ne pas redéployer un modèle Prisma où ce champ est entier. Toute reprise de collecte exige les preuves du lecteur courant.

## Validation locale

Depuis la racine d’un checkout propre, après `npm ci --workspaces --include-workspace-root` :

```sh
npm run test:local
npm run api:build
npm run build:local -w @catwalks/aggregator
```

`test:local` crée sa propre base jetable, applique les migrations et lance types, unitaires, intégration, API et tests d’exploitation. Ne jamais fournir une base métier aux suites d’intégration. Le build Docker est distinct du build API et ne déploie rien.

Le [Golden Path](../../docs/architecture/golden-source.md) teste une nouvelle source, deux ingestions, les rejeux et la lecture API. Le [témoin de rollback](../../docs/architecture/canary-operations.md#répétition-du-retour-arrière) installe deux archives Git et démarre réellement leurs API, dans un environnement local dédié.

Le contrôle des services courants suit le [runbook Railway](../../docs/architecture/railway-runtime-reset.md), le [contrat cible](../../docs/operations/railway/runtime-target.json) et le [reçu de release](../../docs/operations/railway/runtime-release.json). Les services sont `catwalks-catalogue-api` et `catwalks-ingestion-worker` ; leur livraison par image immuable est explicite, sans autodeploy. Les anciens lecteurs de crons et pilotes des services supprimés ont été retirés.

Les [outils d’exploitation](scripts/ops/README.md) décrivent les lecteurs de runs, de captures et de preuves conservés. Les accès et les valeurs des secrets restent privés.

## Dépendances séparées

**Direct Offers : chantier séparé.** Le consommateur existant `direct-sync` exige `CATALOGUE_FLUX_URL` et `CATALOGUE_FLUX_KEY`, reprend au curseur et signale les refus sur `DirectFeedCursor.lastError`. Son déploiement est séparé ; ni le backend des candidatures ni `/offres` ne sont modifiés. Le Golden Path vérifie `/emplois` avec zéro offre directe.

**Stockage froid : non bloquant pour l’exploitation autorisée.** Les RAW chauds sont durables dans PostgreSQL ; la répétition de rollback fonctionne sans stockage objet. Stockage froid et politique de rétention restent à traiter avant toute purge des RAW ; leur absence ne bloque pas l’exploitation autorisée.

## Repères

- [Architecture et contrats](../../docs/architecture/production-foundations.md).
- [Parcours des sources](../../docs/architecture/source-onboarding.md).
- [Capture native](../../docs/architecture/native-capture.md) et [faits RAW](../../docs/architecture/source-facts.md).
- [Contrat de recherche](../../docs/architecture/recherche-marche.md) et [E2E `/emplois`](../../docs/architecture/emplois-e2e.md).
- Runtime/tests : `src/` ; outils : `scripts/` ; référentiels : `data/` ; mesures : `audits/` à la racine.
- RAW volumineux, dumps et secrets : stockage privé, jamais dans Git.

## RUN quotidien et cycle de vie

Railway déclenche `sh apps/aggregator/start.sh scheduled` aux deux créneaux UTC `0 16,17 * * *`. Le worker ne lance le pipeline qu’à 18 h Europe/Paris ; l’autre créneau sort avant DB/réseau/heartbeat. La pause est vérifiée en premier. Les tests couvrent été, hiver et les deux changements d’heure. Une seule réplique, restart NEVER ; ne pas relancer le service pendant un RUN.

Après ingestion et géocodage, le RUN quotidien appelle le refresh existant sur les seules ACTIVE. Fermeture explicite, expiration native et absence ont des preuves distinctes ; une énumération partielle peut publier les offres individuellement qualifiées mais ne prouve jamais une absence. Le garde contre les fermetures massives reste actif. Les sources en pause conservent leurs offres ; leur expiration publique reste filtrée par l’API.
