# Recherche Catwalks : moteur public et exploitation

## Décision et périmètre

**Décision du 24 septembre 2026 : PostgreSQL enrichi est retenu et livré pour la V1.** La [validation réelle Railway](../../audits/2026-09-24/search-railway.md) couvre la recherche pendant publication, les ressources DB et la disponibilité. Le challenger Elasticsearch et son outillage ont été retirés. Les rapports ci-dessous conservent uniquement la justification historique de cette décision.

### Arbitrage PostgreSQL / Elasticsearch

Le [dernier challenger linguistique](../../audits/2026-09-24/search-linguistic.md) ajoute les analyseurs par langue déclarée et un fuzzy borné, avec le même snapshot, les mêmes intentions et synonymes. Sur 214 formulations appariées : précision **89,12 % PG / 87,84 % ES**, nDCG **0,8493 / 0,8610**, rappel dans le pool **72,41 % / 75,09 %**, p95 moteur local de la seconde passe **268,7 / 43,3 ms**. ES gagne réellement en rappel, classement et vitesse moteur ; sa précision baisse légèrement. Aucun LLM, vecteur ou second pipeline de production.

La projection PG et sa file transactionnelle sont déjà intégrées à la disponibilité native, aux deux origines, aux facettes et à la pagination. Le gain produit mixte d'ES ne justifie pas aujourd'hui une seconde infrastructure. Les benchmarks [S1](../../audits/2026-09-24/search-s1.md) et [S2](../../audits/2026-09-24/search-s2.md) conservent leurs résultats historiques ; ne pas les confondre avec le dernier profil.

Le contrôle final Railway mesure un p95 HTTP de **384,37 ms au repos / 400,09 ms pendant publication**, sur 300 recherches identiques à concurrence quatre, toutes comprises dans les écritures du worker. Le corpus réel atteint **76 096 documents**, `pending=0`. Ce GO porte sur l'enveloppe mesurée : une source normale, des requêtes représentatives bornées, aucune promesse de capacité mondiale. Le [garde versionné](../../apps/api/scripts/search-benchmark/guard-policy.json) et le suivi local de la tâche relancent un benchmark lors du franchissement des seuils documentés ; ils ne changent jamais automatiquement le moteur.

Le moteur public utilise maintenant la même compréhension, le même modèle de document et le même compilateur SQL que le benchmark PostgreSQL. Le site `/emplois` utilise la recherche comme entrée principale ; le sélecteur Métier est retiré. Un ancien filtre `metier` dans une URL reste visible et retirable. Les marchés, langues et parcours de candidature conservent leurs contrats. `/offres`, matching et onboarding restent gelés.

L’API et le worker `f10e1f2` sont livrés ; le reçu Railway et le rapport ci-dessus attestent leur état. Les validations du site restent locales/development : aucun déploiement du site n’est autorisé implicitement.

## Recherche et classement

- `search-intent.ts` décompose métiers, Maisons/groupes, secteurs et précisions sans supprimer les termes non compris. Une requête composée exige toutes ses composantes ; chaque composante peut correspondre au texte natif ou à une interprétation justifiée.
- `search-model.ts` conserve le titre original. Les rôles reconnus dans le titre priment sur une ancienne classification. « Assistant Store Director » n’est pas « Store Manager ».
- Un code métier absent n’exclut jamais une offre. Les synonymes multilingues servent aussi la recherche dans une autre langue que celle du marché.
- `search-sql.ts` lie les valeurs SQL. Les rôles du titre empêchent les correspondances lexicales qui confondraient un poste avec son adjoint. Les intitulés, identités et missions ont des poids distincts.
- Les deux origines sont interrogées dans le même SQL. Disponibilité, pays, dates d’expiration et filtres sont vérifiés sur les lignes natives ; les offres Catwalks pertinentes précèdent les offres externes. Les offres sont relues avant exposition.
- Les suggestions de métiers vérifient l’existence d’une offre publiable dans le marché actif avec le même moteur. Une Maison mentionnée dans une description n’est pas transformée en employeur.
- Limites explicites : 500 caractères / 64 mots ; dépassement = `SEARCH_QUERY_INVALID` (400), jamais troncature silencieuse. Le curseur versionné refuse une ancienne génération de classement.

## Projection PostgreSQL durable

`SearchDocument` est dérivé, remplaçable et séparé du RAW. Son vecteur pondéré porte texte et identités ; son pays indexé sert de préfiltre, toujours recoupé avec le pays natif.

`SearchPending` reçoit les modifications dans la transaction native via des triggers. L’API existante vide cette file par lots de 128 avec `FOR UPDATE SKIP LOCKED`. Projection et acquittement sont atomiques. Une modification concurrente ne peut pas disparaître derrière un acquittement. Une interruption laisse les éléments à reprendre.

`SearchMetadata.revision` invalide le contexte entreprises/alias/taxonomie. Les changements d’identité et de groupe réenfilent les offres concernées, y compris les relations textuelles historiques de groupe. Aucun appel externe ni service supplémentaire dans ce traitement.

La disponibilité reste native : fermeture et expiration sont immédiatement respectées sans attendre la file. Les colonnes descriptives non utilisées pour la recherche peuvent attendre la prochaine réindexation ; elles ne gouvernent jamais publication, compteurs ou facettes.

`SearchGeneration.readyAt` est posé seulement après vidage du chargement initial. L’API refuse les recherches et renvoie un healthcheck non prêt si la génération n’est pas prête ou si un élément attend depuis plus de 300 secondes. Les générations précédentes sont conservées pendant le déploiement progressif et la fenêtre de retour arrière, puis retirées explicitement.

## Qualification des secteurs

Le circuit unique reste [SectorReview](../../apps/aggregator/src/sectors/README.md), avec preview, contrôle de l’identité, manifeste immuable et application idempotente. L’ancien enum `Company.sector` n’est plus alimenté par l’ingestion.

Le mainteneur réutilise des preuves officielles relues, versionnées et datées, liées exactement à la clé, au nom et au domaine de l’entreprise. Il conserve URL, justification, empreinte des preuves et de la taxonomie, date de vérification et échéance. Il s’abstient si l’identité, la taxonomie ou la validité divergent. Il n’hérite pas des secteurs du groupe. Aucun modèle génératif n’est invoqué : `model` et `promptVersion` sont explicitement nuls.

Le premier jeu comprend six règles (Mango, Skechers, Lovisa, Bloomingdale’s, Monoprix, Nocibé). Il ne prétend pas qualifier tout le catalogue. Sur la copie locale : 1 618 entreprises examinées, cinq changements, 1 365 abstentions ; second passage sans changement. Les entreprises sans preuve restent recherchables. Le run normal entretient les règles après les sources ; un run limité à une source ne déclenche pas de changement global. `PIPELINE_PAUSED=1` interdit cette maintenance.

## Procédure de livraison de l’agrégateur

1. Valider les suites ciblées, les builds et la CI de `development`. Construire les images immuables du SHA validé ; promouvoir vers `main` selon le GO agrégateur.
2. Conserver les images actuellement attestées dans `docs/operations/railway/runtime-release.json` et la configuration effective. La DB native et son volume ne changent pas.
3. Pour une première installation, appliquer les deux migrations additives `20260924120000_search_projection` et `20260924130000_search_market_index` via Prisma. Elles n’altèrent aucune publication ni capture historique. Elles sont déjà appliquées en production ; ne pas les rejouer ni reconstruire une génération inchangée pour cette livraison.
4. Depuis le code validé, avec les secrets fournis par l’environnement :

```sh
npx tsx apps/api/scripts/search/index.mts rebuild
npx tsx apps/api/scripts/search/index.mts status
```

Le chargement initial précède la livraison de l’API : il peut dépasser les 120 secondes du healthcheck Railway. `rebuild` reprend la file, puis met à jour les statistiques SQL (`ANALYZE`). Exiger `registered=true`, `ready=true`, `pending=0` avant bascule.

5. Livrer l’API et le worker validés. Vérifier SHA/digest/commande, health, authentification, recherche FR/US, fiche, facettes et absence de file bloquée. Les erreurs de source se traitent séparément, sans reset historique.
6. Effectuer la qualification initiale par `sectors/cli.mts qualify`, `preview`, `apply` avec le SHA complet validé ; conserver le plan privé et le bilan, puis vérifier le second passage sans écritures.
7. En cas d’échec, remettre l’image précédente ; les tables additives sont compatibles avec l’ancienne API. Ne pas retirer la génération précédente pendant cette fenêtre. Après arrêt vérifié de l’ancien runtime :

```sh
npx tsx apps/api/scripts/search/index.mts retire VERSION_PRECEDENTE --previous-runtime-stopped
```

La commande refuse la génération courante. Un changement de vocabulaire ou de projection exige une nouvelle `SEARCH_VERSION` ; aucune réécriture en place de l’index encore servi par l’ancien runtime.

Le site se livre séparément : commit/push `development` autorisés ; `main` et déploiement attendent le GO explicite.

## Validation du 24 septembre, locale

| Vérification | Résultat |
|---|---|
| Agrégateur, intégration sur base de test neuve | 587 tests / 62 fichiers PASS |
| API, y compris mutations concurrentes, expiration, pays et deux origines | 281 tests / 31 fichiers PASS |
| Site, unités | 157 tests / 23 fichiers PASS |
| E2E CA/CH/BE, changement de langue et recherche, mobile | 8 tests PASS |
| Builds API et site | PASS |
| API HTTP, 96 requêtes / 12 recherches / concurrence 4 | p50 46 ms, p95 226 ms, max 287 ms ; 0 résultat hors marché |
| Variantes FR « sales advisor » / « conseiller de vente » | mêmes identifiants et total |

Charge mesurée sur une copie locale de 40 188 lignes Job ; ce n’est pas une mesure de capacité Railway. Cette copie sert à la recherche, pas à tester une restauration complète des corps RAW. Les deux origines sont couvertes par fixtures natives en intégration ; la copie réelle ne contient aucune offre directe. Les mesures S1/S2 demeurent historiques et ne sont pas présentées comme une nouvelle évaluation aveugle de cette release.

## Retrait du code remplacé

Supprimés : reconnaissance d’un métier uniquement sur la requête entière, branches SQL remplacées, SQL d’alias inutilisé, attribution de l’ancien secteur lors de l’upsert, tables de secours sectorielles sans consommateurs, sélecteur Métier du site. Les scripts de benchmark importent le modèle public ; la baseline historique se rejoue au commit S1, sans deuxième moteur legacy dans le produit.

Inventaire des dépendances conservées :

| Élément | Consommateurs encore présents / traitement |
|---|---|
| `Company.sector` | Lecteurs d’offres, aside entreprise et outils de reprise ; l’ingestion n’en déduit plus un secteur. |
| `Job.searchText` | Contrôle de schéma du healthcheck, Prisma et tests des triggers historiques. Retrait physique après remplacement de ces consommateurs. |
| Vecteurs/texte `DirectOffer` | Écrivain `apps/aggregator/src/direct/projection.ts`, triggers et tests du parcours gelé ; conservés. |
| Paramètre URL `metier` | Anciennes contraintes visibles et retirables dans `/emplois` ; maintien explicitement décidé pour V1. |
| Adaptateur Rituals et son endpoint Elasticsearch | Source externe de l’employeur, distincte d’un moteur de recherche Catwalks ; conservé. |
| Migrations et rapports datés | Rejeu et traçabilité ; ne sont pas des chemins runtime alternatifs. |

Le lot retire aussi les cartes inutilisées de présentation des métiers et le chargeur de benchmark qui recréait les anciens vecteurs Job/DirectOffer. S1 se rejoue à son commit historique. Aucun import Elasticsearch dans le runtime public, aucune synchronisation dormante, aucun service ES Railway. Les fonctions SQL et colonnes physiques historiques ne sont pas prétendues toutes supprimées : leur retrait doit préserver les consommateurs ci-dessus et la fenêtre de retour arrière.
