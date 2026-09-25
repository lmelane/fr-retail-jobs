# Agrégateur Catwalks — état vérifié et exploitation

**État runtime vérifié le 24 septembre 2026.** Le code `f10e1f2` est livré sur l’API et le worker. La [recherche V1 est validée sur Railway](../../audits/2026-09-24/search-railway.md), avec PostgreSQL unique, ingestion simultanée et `pending=0`. Les [qualifications ciblées](../../audits/2026-09-23/source-qualification.md) ont publié Nocibé, Monoprix/Naturalia, Bonsoirs, Puma, Gemmyo, Luxury of Retail et élargi Sephora à ses langues publiées. L'Oréal est qualifiée mais sa publication échoue sur HTTP 406 ; Aesop Workday reste non activée et les recouvrements entre canaux ne sont pas réconciliés. Le [bilan post-RUN](../../audits/2026-09-23/post-run.md) conserve les résultats du passage quotidien précédent. Le CRON normal est rétabli et attesté une fois par jour à 18 h Europe/Paris. Registre mesuré le 23 septembre : 415 ACTIVE, 11 PAUSED, 116 RETIRED. Les quatre anciens runtimes sont supprimés ; PostgreSQL et son volume sont conservés. Le site, backend, back-office et média ne sont pas déployés.

## Une chaîne opérationnelle

`sh apps/aggregator/start.sh` appelle le worker commun. Sur Railway, `PIPELINE_PAUSED` est **obligatoire** (`0` ou `1`). Sous pause, il sort avant DB/réseau ; sinon il vérifie les migrations sans les appliquer puis lance le CLI. Les images Railway exigent en plus leur contrat embarqué et un profil exact. Un processus déjà démarré doit être arrêté/redémarré pour recevoir une nouvelle variable distante.

Le runner général ne prend que les sources ACTIVE. Le parcours maintenu d'une nouvelle source reste **`start.sh source-add`**, avec `PIPELINE_PAUSED=0`, définition publique, clé et réviseur explicites. Le programme crée DRAFT, réutilise les captures/preuves/portes de qualification existantes, active puis ingère par le CLI normal. Cette définition publique ne réactive pas PAUSED/RETIRED et ne remplace pas une configuration divergente. La variante `--registered-revision` permet de requalifier une seule configuration déjà revue, y compris PAUSED, avec les mêmes preuves obligatoires ; RETIRED reste refusée. Exemple complet : [runbook](../../docs/architecture/canary-operations.md#une-nouvelle-source-sans-modification-manuelle-de-la-base). Le worker de production accepte aussi ce `source-add`, avec le même parseur strict avant toute activité, puis le mode normal sans argument (`ingest-all`) , `scheduled` (déclenchement quotidien) ou `ingest --source=<clé> [--no-geocode]`, avec profil `production` et pause explicite. Voir le [contrat cible](../../docs/operations/railway/runtime-target.json).

La table `Source` est le registre opérationnel ; le RAW archivé reste la référence du contenu publié. Les observations, faits dérivés et projections restent distincts. Un statut ACTIVE ne suffit pas à prouver une qualification ni une absence. Les captures, admissions et fins immuables fondent le cycle de vie, jamais un simple `lastSeenAt` ou un journal d’exécution.

Après autorisation d’exécution, le mode normal et le mode ciblé entretiennent la preuve d’accès de chaque ACTIVE : une décision valide est conservée ; `ACCESS_STALE` ou `ACCESS_MISSING` déclenche la même qualification que `source-add` (capture native, validation par rejeu, robots, décision persistée). La collecte normale repasse ensuite toutes les admissions. Un refus explicite n’est jamais renouvelé automatiquement, même après un changement de révision ; une décision concurrente ne peut pas être écrasée. Même si l’accès reste valide pendant 30 jours, une qualification native périmée (24 h) est recapturée et revalidée sans remplacer la décision d’accès. Une qualification impossible bloque sa source et laisse les autres continuer. Ces preuves appartiennent au même run et au même budget par source. Sous `PIPELINE_PAUSED=1`, aucun de ces appels n’est exécuté.

La restauration du registre passe par `scripts/ops/exporter-registre-sources.mts` puis `reimporter-registre-sources.mts`. Aucun seed historique ni enregistrement SQL parallèle.

## Surveillance et reprise

Les runs, décisions de qualification, résultats de collecte et erreurs sont persistés. Le signal `run.alive` revient toutes les 30 secondes. `worker-status.mts` rend une lecture seule des derniers runs, captures et erreurs ; un RUNNING ancien sans signal récent reste UNVERIFIED. Les commandes maintenues conservent Brevo et heartbeat.

**Statut du RUN après D-453 et D-456 (24-25/09).** Livraison du 25/09 : voir `docs/operations/railway/runtime-release.json`, seul le reçu dit quelle image le worker exécute ; le [contrat de statut](../../docs/architecture/canary-operations.md#contrat-de-statut-après-d-453-et-d-456-24-25092026) décrit le classement du code de ce dépôt. Une retenue fondée sur une preuve publiée par la source elle-même reste visible mais ne fait plus échouer le RUN : décidé pour la candidature close et l'employeur absent de l'annonce Workday (portail non certifié mono-marque, D-453 §1), la page de candidature en erreur 404 et le modèle expiré (D-456 §1) ; la page supprimée (410), le retrait du listing, la publication de test et l'événement de recrutement (job dating) (D-462). Une offre écartée hors périmètre est une décision de l'équipe, visible et non bloquante (D-456 §2). Une retenue empêche ce RUN de publier l'offre ; elle ne retire une publication antérieure que si son motif porte une disposition (candidature close, 404, 410, retrait, périmètre) : sans disposition (employeur absent, modèle expiré, test, événement), l'offre déjà publiée reste en ligne, et l'alerte dit par motif et par source combien (« non publiées par ce RUN ; N restent en ligne depuis une collecte antérieure »). Mesuré le 25/09 sur les retenues du RUN du 24/09 (`audits/2026-09-25/scripts/retenues-encore-en-ligne-2409.mts`) : aucune des 1 981 retenues sans disposition n'est en ligne, aucune n'ayant jamais été publiée ; 2 retenues à instruire le restent. Restent bloquants : les énumérations non prouvées et réfutées, les troncatures, les refus d'identité, les échecs d'accès et de lecture, les motifs inconnus. Une garde technique surveille la seule preuve négative (employeur absent Workday) : plus de 10 points et au moins 10 offres de part non publiée au-delà du dernier RUN complet de production la rendent bloquante ; sans RUN complet de référence, la retenue reste non bloquante et le bilan le signale. Une panne réseau ou TLS du client HTTP est `UNKNOWN` / `TRANSPORT_<code>`, jamais INTERNAL sur sa seule classe ; l'alerte et le bilan disent de chaque source si elle bloque, pourquoi chaque offre est retenue et la cause d'un refus d'identité ; les corrections portent le SHA de la release embarquée. Rejeu du classement du RUN du 24/09 sous ces règles : 414 sources, 354 OK, 60 non OK dont 19 non bloquantes (2 032 offres retenues sur preuve de la source) et 41 bloquantes, RUN toujours en échec (`UNRESOLVED_FAILURE`) ; 21 des 41 relèvent de décisions déjà prises (les 20 refus d'identité, D-453 §4 ; Ralph Lauren, D-453 §3) et les 41 sont à traiter (D-456 §5). Le rejeu se recompte avec `audits/2026-09-24/scripts/rejeu-classement-2409*.mts`.

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

**Direct Offers (D-444) : `direct-liste`, sur `development`, non livré.** La commande relit la liste publique du backend (`CATALOGUE_LISTE_URL`, `/api/jobs`) et le compte que le backend donne des mêmes offres (`/api/jobs/filters`), n’écrit que ce qui change, ne retire rien sur une réponse vide, tronquée à 500, plus courte que ce compte (ou sans compte lisible) ou en partie illisible, et n’écrit rien sur une panne (état dans `DirectFeedCursor` `catwalks-liste`, passe en échec). Le service Railway `catwalks-direct-sync` qui la lance toutes les 5 minutes est défini dans le contrat d’exécution, en pause, non créé : sa création, son check Healthchecks dédié et sa mise en marche sont des gestes de production sur GO. Le consommateur d’outbox `direct-sync` (`CATALOGUE_FLUX_URL`, `CATALOGUE_FLUX_KEY`) n’a plus de producteur : le backend a retiré ce flux de sa branche `development` le 25/09/2026 (`8352cff`), et la stack locale qui en dépend est à adapter au lecteur de la liste ; D-444 ne l’utilise pas. Détail : [recherche-marche.md](../../docs/architecture/recherche-marche.md), « Deux origines, une recherche ».

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
