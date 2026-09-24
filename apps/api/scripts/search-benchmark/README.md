# Mesures de recherche PostgreSQL

PostgreSQL enrichi est le seul moteur maintenu. Le challenger Elasticsearch,
son profil, son indexeur et ses tests ont été retirés à la demande du produit.
Les rapports datés restent des preuves historiques ; leur code se retrouve dans
Git au commit `9aa2e2c`. Ils ne décrivent pas un second moteur à exploiter.

## Pertinence et régression

`intentions.json`, les annotations natives `judgments*.json`, `anchors.json` et
`regressions.json` conservent les cas déjà relus. Les anciens résultats comparatifs
ne prouvent pas la qualité d'un nouveau corpus. Un seul évaluateur, sans validation
humaine indépendante ; les cas réservés déjà lus ne sont plus un jeu aveugle.

`prepare.ts`, `index.py`, `adapters.ts`, `measure.ts` et `run.py` mesurent uniquement
PostgreSQL, avec le modèle et le compilateur du runtime public. L'indexeur refuse
un hôte distant ou une base qui n'est pas nommée `catwalks_search_benchmark_*`.
Les mesures locales servent aux régressions ; la validation de livraison se fait
sur Railway par le chemin réel. Aucune fixture de test ne s'écrit en production.

```sh
npx tsx apps/api/scripts/search-benchmark/prepare.ts /prive/snapshot /prive/documents.ndjson
python3 -B apps/api/scripts/search-benchmark/index.py /prive/documents.ndjson /prive/access.json /chemin/psql
python3 -B apps/api/scripts/search-benchmark/run.py /prive/access.json apps/api/scripts/search-benchmark/measure.ts /prive/documents.ndjson.metadata.json apps/api/scripts/search-benchmark/intentions.json /prive/mesures.ndjson
python3 -B apps/api/scripts/search-benchmark/evaluate.py /prive/documents.ndjson /prive/mesures.ndjson apps/api/scripts/search-benchmark/judgments-linguistic.json > /prive/bilan.json
python3 -B apps/api/scripts/search-benchmark/verify.py /prive/mesures.ndjson /prive/bilan.json
```

`evaluate.py` vérifie empreintes, labels contradictoires et cas inconnus.
`snapshot.py` exporte en lecture seule ; les RAW et secrets restent hors Git.
`pool.py` prépare les résultats à annoter depuis leur contenu natif.

## Mesure Railway

`railway.py` lit la clé via la CLI Railway, teste l'API publique puis mesure un lot borné (32–480 requêtes, concurrence 1–8). Il ne démarre aucun worker et ne modifie aucune offre. Exécuter séparément au repos et pendant une ingestion autorisée, puis rattacher le vrai `PipelineRun` et ses horodatages au relevé ; un nom de phase n'est pas une preuve de recouvrement.

```sh
python3 -B apps/api/scripts/search-benchmark/railway.py /prive/baseline.json --sha SHA_COMPLET --phase baseline --requests 240 --concurrency 4
```

Les métriques Railway arrivent en différé : relire la même fenêtre après publication, ne jamais interpréter une limite/RAM nulle comme une consommation mesurée. Les temps HTTP incluent réseau public et transfert JSON. Le reçu contient les limites du protocole ; il n'atteste pas à lui seul les transitions fermeture/expiration ni la capacité mondiale.

La charge comprend les 234 formulations communes, plus les 16 cas fonctionnels. `--duration-seconds 120` espace les lots sur au moins deux minutes ; les requêtes lentes peuvent allonger ce temps. Le test plafonne à quatre requêtes simultanées dans la qualification V1 : ce n'est pas une simulation du trafic mondial.

## Déclenchement d'un nouveau benchmark

`guard-policy.json` versionne les seuils et `guard.py` les applique à un relevé JSON. Cet outil reste hors runtime et ne crée aucun service de surveillance. Le suivi programmé de cette tâche lit les logs/metrics Railway, le healthcheck et les preuves de reconstruction/pertinence existantes ; il appelle ce garde puis relance le benchmark partagé si un seuil est franchi. Les observations privées datées restent hors Git. Une donnée absente ou invalide donne `unknown`, jamais zéro ou PASS.

```sh
python3 -B apps/api/scripts/search-benchmark/guard.py /prive/observations.json
python3 -B -m unittest discover -s apps/api/scripts/search-benchmark -p 'test_*.py'
```

Relevé attendu : `searchSamples`, `p95Ms`, `documents`, `cpuFractions` (usage / limite réelle, échantillons consécutifs de 30 s), `oldestPendingSeconds`, `deadlocksDelta`, `ingestionSlowdownRatio` (p95 pendant ingestion / p95 au repos, même charge), `rebuildSeconds`, `failedRelevanceRegressions`, `precisionAtAvailable20`, `ndcgAt20`. Conserver séparément horodatages et provenance ; ne pas réutiliser une qualité ancienne comme mesure d'une nouvelle version.

Seuils : p95 >1 s sur ≥100 recherches ; CPU >70 % de la limite sur trois points consécutifs ; file âgée de >120 s ; nouveau deadlock ; ralentissement ingestion >1,5× ; reconstruction >2× la durée réelle de référence (232,569 s) ; perte de précision ou nDCG >2 points, ou régression native ; dépassement du nombre de documents réellement éprouvé. Le nombre de documents est une **frontière de validation**, pas une capacité maximale attribuée à PostgreSQL. Les seuils de service et de qualité sont des décisions d'exploitation explicites, pas des résultats de benchmark.

Un déclenchement lance une nouvelle mesure PostgreSQL isolée sur un snapshot identifié. Il ne bascule jamais le moteur et ne déploie rien automatiquement. Pour un nouveau corpus, réannoter les nouveaux résultats à partir des preuves natives : ne pas recycler les labels d'un autre snapshot. En présence d'un incident de production, aucun test de charge supplémentaire : diagnostic en lecture seule et mesure hors production. Le suivi local dépend de l'exécution de Codex ; les garde-fous et alertes Railway/Healthchecks existants restent responsables de l'exploitation continue.
