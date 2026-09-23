# Agrégateur Catwalks — état vérifié et exploitation

État d’exploitation vérifié le **23 septembre 2026** : **CANARI VALIDÉ** après la seule validation différentielle de l’egress. Une ingestion Oh My Cream : 23 mises à jour, 0 création, 0 fusion, 0 erreur ; seul hôte métier observé `careers.ohmycream.com`. `/emplois` et le retour en pause sont confirmés. La restaurabilité reste acquise sans modifier les 613 lignes historiques. Voir le [bilan du delta](../../audits/2026-09-23/canary-delta-oh-my-cream.md). Le passage au ramp-up est désormais précédé du [reset du runtime Railway](../../docs/architecture/railway-runtime-reset.md), demandé ensuite : plan proposé, pas encore appliqué ; DB de production conservée. `/offres` et matching restent gelés.

## Développement et production

- `development` porte le travail validé ; `main` représente la production.
- `main` et les quatre services Railway : `72300c97586955536ee1f89b0a9b7b0273fbf8a9`, après le GO explicite du canari borné ; CI verte et 86 migrations appliquées.
- Les trois workers restent `PIPELINE_PAUSED=1`, anciens calendriers encore fixés au 29 février 2028 ; leur suppression réelle est prévue par le reset. L’agrégateur est revenu à `sh apps/aggregator/start.sh`, avec `EGRESS_PROBE=0`. Son exécution sous pause confirme `workStarted:false`, puis un conteneur arrêté.
- Le delta autorisé comprend une seule ingestion et se termine en pause. Le ramp-up attend la validation du nouveau runtime ; aucune campagne ou activation de CRON dans le présent lot. Le site public, backend, back-office et média ne sont pas déployés.

Les anciens chiffres de stock et bilans source par source restent dans les [audits datés](../../audits/reprise-2026-09-15/README.md). Ils ne représentent pas le catalogue courant. Aucun audit supplémentaire des offres n’est requis pour PR-1.

## Une chaîne opérationnelle

`sh apps/aggregator/start.sh` appelle le worker commun. Il respecte `PIPELINE_PAUSED`, vérifie les migrations sans les appliquer et lance le CLI. Les valeurs autorisées de pause sont `0`, `1` ou variable absente ; toute autre valeur est refusée. Un processus déjà démarré doit être arrêté/redémarré pour recevoir une nouvelle variable distante.

Le runner général ne prend que les sources ACTIVE. Pour une nouvelle source, utiliser **`start.sh source-add`**, avec définition publique, clé et réviseur explicites. Le programme crée DRAFT, réutilise les captures/preuves/portes de qualification existantes, active puis ingère par le CLI normal. Il ne réactive pas PAUSED/RETIRED et ne remplace pas une configuration divergente. Exemple complet : [runbook](../../docs/architecture/canary-operations.md#une-nouvelle-source-sans-modification-manuelle-de-la-base).

La table `Source` est le registre opérationnel ; le RAW archivé reste la référence du contenu publié. Les observations, faits dérivés et projections restent distincts. Un statut ACTIVE ne suffit pas à prouver une qualification ni une absence. Les captures, admissions et fins immuables fondent le cycle de vie, jamais un simple `lastSeenAt` ou un journal d’exécution.

La restauration du registre passe par `scripts/ops/exporter-registre-sources.mts` puis `reimporter-registre-sources.mts`. Aucun seed historique ni enregistrement SQL parallèle.

## Surveillance et reprise

Les runs, décisions de qualification, résultats de collecte et erreurs sont persistés. Le signal `run.alive` revient toutes les 30 secondes. `worker-status.mts` rend une lecture seule des derniers runs, captures et erreurs ; un RUNNING ancien sans signal récent reste UNVERIFIED. Les commandes maintenues conservent Brevo et heartbeat.

Le retour arrière PR-1 a été exécuté sur base locale dédiée : ancienne API à 85 migrations → candidate à 86 → 23 offres réellement collectées → ancienne API, résultats et fiche identiques. La base reste forward-compatible ; aucun downgrade Prisma ni effacement du ledger. Toute reprise de collecte après rollback exige les preuves du lecteur courant.

## Validation locale

Depuis la racine d’un checkout propre, après `npm ci --workspaces --include-workspace-root` :

```sh
npm run test:local
npm run api:build
npm run build:local -w @catwalks/aggregator
```

`test:local` crée sa propre base jetable, applique les migrations et lance types, unitaires, intégration, API et tests d’exploitation. Ne jamais fournir une base métier aux suites d’intégration. Le build Docker est distinct du build API et ne déploie rien.

Le [Golden Path](../../docs/architecture/golden-source.md) teste une nouvelle source, deux ingestions, les rejeux et la lecture API. Le [témoin de rollback](../../docs/architecture/canary-operations.md#répétition-du-retour-arrière) installe deux archives Git et démarre réellement leurs API, dans un environnement local dédié.

Lectures de production, sans mutation :

```sh
python3 -B apps/aggregator/scripts/ops/railway-service.py status api
python3 -B apps/aggregator/scripts/ops/read-crons.py
```

Les [outils d’exploitation](scripts/ops/README.md) décrivent les contrôles maintenus. Le transport Railway utilise `CATWALKS_RAILWAY_TOKEN` ou la connexion CLI locale ; les valeurs des secrets restent privées.

## Dépendances hors canari

**DIRECT_OFFERS = hors canari.** Le consommateur existant `direct-sync` exige `CATALOGUE_FLUX_URL` et `CATALOGUE_FLUX_KEY`, reprend au curseur et signale les refus sur `DirectFeedCursor.lastError`. Son déploiement est séparé ; ni le backend des candidatures ni `/offres` ne sont modifiés. Le Golden Path vérifie `/emplois` avec zéro offre directe.

**S3 = non bloquant canari.** Les RAW chauds sont durables dans PostgreSQL ; la répétition de rollback fonctionne sans stockage objet. Stockage froid et politique de rétention restent au backlog Production Hardening avant purge ou production globale.

## Repères

- [Architecture et contrats](../../docs/architecture/production-foundations.md).
- [Parcours des sources](../../docs/architecture/source-onboarding.md).
- [Capture native](../../docs/architecture/native-capture.md) et [faits RAW](../../docs/architecture/source-facts.md).
- [Contrat de recherche](../../docs/architecture/recherche-marche.md) et [E2E `/emplois`](../../docs/architecture/emplois-e2e.md).
- Runtime/tests : `src/` ; outils : `scripts/` ; référentiels : `data/` ; mesures : `audits/` à la racine.
- RAW volumineux, dumps et secrets : stockage privé, jamais dans Git.
