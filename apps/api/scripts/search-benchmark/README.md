# Benchmark de recherche S1

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

Prérequis : dépendances npm du dépôt, Python ≥ 3.11, PostgreSQL local, Elasticsearch **9.5.4** local. Le snapshot initial est daté du 23 septembre 2026 à 21:53:35 UTC. Réexporter aujourd'hui produirait un autre catalogue et invaliderait les jugements associés à son empreinte.

1. Utiliser le snapshot existant. Pour une **nouvelle** campagne explicitement voulue, `snapshot.py /chemin/prive/nouveau-snapshot` exporte en transaction PostgreSQL Repeatable Read / Read Only via Railway SSH. Il ne mute pas la production.
2. Créer une base vide nommée `catwalks_search_benchmark_<identifiant>` sur `127.0.0.1`. Créer un JSON privé (mode `0600`) avec `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` ; aucune valeur dans Git ni dans les commandes. Le chargeur refuse une base non vide ou un hôte distant.
3. Démarrer Elasticsearch sur `127.0.0.1:59200` (transport `59300`), nœud unique, un shard, zéro replica, heap 512 Mio. La désactivation d'authentification de cette instance n'est acceptable que sur loopback. Aucun service système ni service Railway supplémentaire n'est nécessaire.
4. Exécuter depuis la racine du dépôt en remplaçant les chemins :

```sh
python3 -B apps/api/scripts/search-benchmark/load-postgres.py /prive/snapshot /prive/access.json /chemin/psql
npx tsx apps/api/scripts/search-benchmark/prepare.ts /prive/snapshot /prive/documents.ndjson
python3 -B apps/api/scripts/search-benchmark/index.py /prive/documents.ndjson /prive/access.json /chemin/psql
python3 -B apps/api/scripts/search-benchmark/run.py /prive/access.json apps/api/scripts/search-benchmark/measure.ts /prive/documents.ndjson.metadata.json apps/api/scripts/search-benchmark/intentions.json /prive/mesures.ndjson
python3 -B apps/api/scripts/search-benchmark/evaluate.py /prive/documents.ndjson /prive/mesures.ndjson apps/api/scripts/search-benchmark/judgments-s2.json > /prive/bilan.json
python3 -B apps/api/scripts/search-benchmark/verify.py /prive/mesures.ndjson /prive/bilan.json
```

Les sorties sont créées sans écrasement. L'indexation est create-only ; une interruption laisse des ressources partielles identifiables. Pour recommencer, recréer **uniquement cette base de benchmark et cet index local**, jamais un clone de répétition partagé. Le script `run.py` fournit l'URL de connexion via l'environnement, sans l'imprimer. `measure.ts` accepte en dernier argument `postgres,elastic` ou un moteur seul.

Pour refaire l'annotation aveugle : `python3 -B apps/api/scripts/search-benchmark/pool.py /prive/snapshot /prive/mesures.ndjson /prive/pool.json`. Les labels actuels doivent rester figés lors de nouvelles optimisations. Tout résultat hors pool reste non jugé.

La baseline historique importe `searchSummary` au commit S1 `8d93697`. Le mesureur courant accepte uniquement `postgres` et `elastic` ; reproduire la baseline depuis ce commit historique, sans maintenir une ancienne route dans le produit.

## Vérifications ciblées

```sh
npm run test -w @catwalks/api -- lib/search-intent.test.ts lib/search-benchmark.test.ts lib/search-evidence.test.ts
python3 -B apps/api/scripts/search-benchmark/test_evaluate.py
npm run typecheck -w @catwalks/api
```

Les unités couvrent notamment les requêtes composées, la négation, les ambiguïtés, le rang, les offres sans code et les séparateurs Unicode dans le RAW. Elles ne remplacent pas les tests d'intégration deux origines, lieu, facettes, pagination et disponibilité nécessaires avant branchement au produit.
