# Benchmark de recherche

Trois lectures du **même catalogue public figé** : SQL actuel, PostgreSQL enrichi, Elasticsearch enrichi. Les deux candidats partagent le modèle public (`model.ts` le réexporte), `search-intent.ts` et le compilateur PostgreSQL. Les scripts de mesure ne sont pas appelés par les routes publiques. Les résultats [S1](../../../../audits/2026-09-24/search-s1.md) et [S2](../../../../audits/2026-09-24/search-s2.md) distinguent la qualité, le temps local et les limites restantes.

S1 est figé au commit `8d93697`. Le code courant contient les corrections S2 : revenir à ce commit pour reproduire exactement les prototypes S1. Le même snapshot sert aux deux étapes.

## Artefacts

- `intentions.json` : 115 intentions, 234 formulations ; 17 intentions réservées avant mesure. Le jeu réservé a désormais été lu : il sert à la régression, pas à une nouvelle prétention d'évaluation aveugle.
- `judgments.json` : 3 129 groupes de titres/employeurs annotés à partir du contenu natif, sans moteur ni rang ni code métier visible ; trois abstentions explicites. Un seul évaluateur Codex, pas une revue humaine indépendante.
- `judgments-s2.json` : supplément explicite de 299 groupes pour les résultats apparus en S2 ; ne remplace pas les labels S1.
- `regressions.json` / `verify.py` : inclusions et exclusions natives vérifiées dans les cent premiers résultats, avec empreinte du snapshot.
- `anchors.json` : neuf positifs natifs supplémentaires, y compris des offres manquées par tous les moteurs. Le rappel reste celui d'un pool partiel.
- `evaluate.py` : contrôle les empreintes et l'intégralité des mesures, refuse les jugements contradictoires, sépare inconnues et vrais négatifs. Les résultats vides avec positif connu valent zéro. La comparaison appariée utilise les mêmes requêtes pour les trois moteurs.
- Le snapshot, les descriptions natives, les secrets locaux et les mesures individuelles restent dans un répertoire privé **hors Git**. Les identifiants et grades versionnés permettent de rejouer l'évaluation avec ce snapshot ; ils ne permettent pas de reconstruire les descriptions absentes.

## Rejouer

Prérequis : dépendances npm du dépôt, Python ≥ 3.11, PostgreSQL local, Elasticsearch **9.5.4** local. Le profil courant est le challenger linguistique ; pour reproduire S2 utiliser son commit historique, pas ce profil. Le snapshot initial est daté du 23 septembre 2026 à 21:53:35 UTC. Réexporter aujourd'hui produirait un autre catalogue et invaliderait les jugements associés à son empreinte.

1. Utiliser le snapshot existant. Pour une **nouvelle** campagne explicitement voulue, `snapshot.py /chemin/prive/nouveau-snapshot` exporte en transaction PostgreSQL Repeatable Read / Read Only via Railway SSH. Il ne mute pas la production.
2. Créer une base vide nommée `catwalks_search_benchmark_<identifiant>` sur `127.0.0.1`. Créer un JSON privé (mode `0600`) avec `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` ; aucune valeur dans Git ni dans les commandes. Le chargeur refuse une base non vide ou un hôte distant.
3. Démarrer Elasticsearch sur `127.0.0.1:59200` (transport `59300`), nœud unique, un shard, zéro replica, heap 512 Mio. La désactivation d'authentification de cette instance n'est acceptable que sur loopback. Aucun service système ni service Railway supplémentaire n'est nécessaire.
4. Exécuter depuis la racine du dépôt en remplaçant les chemins :

```sh
npx tsx apps/api/scripts/search-benchmark/prepare.ts /prive/snapshot /prive/documents.ndjson
python3 -B apps/api/scripts/search-benchmark/index.py /prive/documents.ndjson /prive/access.json /chemin/psql
python3 -B apps/api/scripts/search-benchmark/run.py /prive/access.json apps/api/scripts/search-benchmark/measure.ts /prive/documents.ndjson.metadata.json apps/api/scripts/search-benchmark/intentions.json /prive/mesures.ndjson
python3 -B apps/api/scripts/search-benchmark/evaluate.py /prive/documents.ndjson /prive/mesures.ndjson apps/api/scripts/search-benchmark/judgments-linguistic.json > /prive/bilan.json
python3 -B apps/api/scripts/search-benchmark/verify.py /prive/mesures.ndjson /prive/bilan.json
```

Les sorties sont créées sans écrasement. L'indexation est create-only ; une interruption laisse des ressources partielles identifiables. Pour recommencer, recréer **uniquement cette base de benchmark et cet index local**, jamais un clone de répétition partagé. Le script `run.py` fournit l'URL de connexion via l'environnement, sans l'imprimer. `measure.ts` accepte en dernier argument `postgres,elastic` ou un moteur seul. Le chargeur de l'ancien schéma Job/DirectOffer et ses vecteurs S1 a été retiré : les deux candidats courants lisent directement la projection partagée issue du snapshot, sans recréer un ancien moteur SQL. S1 reste reproductible à son commit historique.

Pour refaire l'annotation aveugle : `python3 -B apps/api/scripts/search-benchmark/pool.py /prive/snapshot /prive/mesures.ndjson /prive/pool.json`. Les labels actuels doivent rester figés lors de nouvelles optimisations. Tout résultat hors pool reste non jugé.

La baseline historique importe `searchSummary` au commit S1 `8d93697`. Le mesureur courant accepte uniquement `postgres` et `elastic` ; reproduire la baseline depuis ce commit historique, sans maintenir une ancienne route dans le produit.

## Vérifications ciblées

```sh
npm run test -w @catwalks/api -- lib/search-intent.test.ts lib/search-benchmark.test.ts lib/search-evidence.test.ts
python3 -B apps/api/scripts/search-benchmark/test_evaluate.py
npm run typecheck -w @catwalks/api
```

Les unités couvrent notamment les requêtes composées, la négation, les ambiguïtés, le rang, les offres sans code et les séparateurs Unicode dans le RAW. Elles ne remplacent pas les tests d'intégration deux origines, lieu, facettes, pagination et disponibilité nécessaires avant branchement au produit.

## Challenger linguistique

`elastic-profile.json` fige analyseurs et bornes fuzzy. `index.py` recopie titre, missions et texte dans les champs de la **langue déclarée de chaque offre** (EN, FR, DE, IT, ES, NL, PT et CJK). Il conserve exactement les champs communs et les empreintes du snapshot. Les langues absentes/non supportées restent recherchables par les champs communs. Les chaînes ont subi la normalisation partagée : ce test ne compare pas une nouvelle extraction native ES à celle de PG.

Les expansions proviennent uniquement de `SearchIntent` : aucune liste de synonymes propre à ES. Les requêtes de métier élargissent linguistiquement le titre ; les missions gardent leurs phrases exactes pour éviter « financial control » → « financial controller ». Le fuzzy concerne un seul token latin résiduel de ≥6 caractères, une édition, préfixe de 2 caractères et 20 expansions maximum, dans le titre ou les missions. Pas de fuzzy sur identité résolue, marque ambiguë, chiffres ou négation. Aucun LLM, vecteur ni reranker.

`--elastic-only` reconstruit l'index ES sans modifier la base de benchmark PG existante. L'index a un nom spécifique, reste create-only et n'est déclaré prêt qu'après contrôle du nombre de documents. Le mesureur refuse une empreinte différente ou une reconstruction incomplète. PostgreSQL ne doit pas être modifié entre deux passes.

`judgments-linguistic.json` reprend tous les labels S2 et ajoute 160 groupes relus depuis le pool natif sans moteur/rang/code affiché. Les anciennes annotations ne sont jamais écrasées. Les 17 intentions réservées de S1 ne sont plus un jeu aveugle indépendant.

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

Un déclenchement lance une nouvelle comparaison PG/ES isolée sur un même snapshot. Il ne bascule jamais le moteur et ne déploie rien automatiquement. Pour un nouveau corpus, réannoter les nouveaux résultats à partir des preuves natives : ne pas recycler les labels d'un autre snapshot. En présence d'un incident de production, aucun test de charge supplémentaire : diagnostic en lecture seule et comparaison hors production. Le suivi local dépend de l'exécution de Codex ; les garde-fous et alertes Railway/Healthchecks existants restent responsables de l'exploitation continue.
