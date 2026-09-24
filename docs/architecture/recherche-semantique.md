# Recherche Catwalks : moteur public et exploitation

## Décision et périmètre

**Décision confirmée le 24 septembre 2026 : PostgreSQL enrichi est le moteur de production V1.** Elasticsearch reste un comparateur hors runtime, sans double lecture publique ni bascule automatique. Le [benchmark S1](../../audits/2026-09-24/search-s1.md) comparait 73 833 offres figées, 115 intentions et 234 formulations. Le [prototype S2](../../audits/2026-09-24/search-s2.md) a corrigé les recherches vides connues. Ces mesures historiques ne prouvent pas un rappel exhaustif mondial.

### Arbitrage explicite PostgreSQL / Elasticsearch

Le dernier résultat S2, sur 193 formulations communes entièrement annotées, donne **89,4 % de précision pour les deux moteurs**, un classement nDCG@20 de **0,851 pour PG / 0,861 pour ES** et un rappel dans le pool de **73,5 % / 74,2 %**. Elasticsearch a également une meilleure latence locale p95 (**41,7 ms / 59,8 ms pour PG**) et une reconstruction plus rapide. Ces avantages sont réels dans ce protocole ; ce n'est pas une preuve statistique ni une mesure de charge de production.

Le code du comparateur Elasticsearch emploie un analyseur standard + lowercase/asciifolding, des requêtes de phrases et le modèle métier partagé. Il ne teste pas tous les analyseurs linguistiques, la recherche floue, le reranking ni la recherche hybride possibles dans [Elasticsearch](https://www.elastic.co/docs/solutions/search/full-text/search-relevance). Il serait donc incorrect de conclure que PostgreSQL est intrinsèquement plus pertinent, ou qu'Elasticsearch a été optimisé au maximum.

Le choix V1 porte sur le produit à exploiter maintenant : la compréhension commune explique l'essentiel du progrès observé ; la projection PG et sa file transactionnelle sont déjà intégrées avec la disponibilité native, les deux origines, les facettes et la pagination. Aucun gain produit mesuré ne justifie encore de développer et exploiter une seconde synchronisation. PostgreSQL possède lui-même la [recherche plein texte](https://www.postgresql.org/docs/current/textsearch.html) ; le SQL public est la seule implémentation de service maintenue.

Réexaminer ce choix uniquement si la vraie API ne tient plus son objectif de service sous une charge représentative, ou si un challenger démontre un gain de pertinence significatif sur des requêtes indépendantes. Le corpus RAW et le modèle de document restent réutilisables ; cela n'impose pas de maintenir deux architectures en production. La simple croissance du nombre de sources n'est pas une preuve que le moteur courant est insuffisant.

Le moteur public utilise maintenant la même compréhension, le même modèle de document et le même compilateur SQL que le benchmark PostgreSQL. Le site `/emplois` utilise la recherche comme entrée principale ; le sélecteur Métier est retiré. Un ancien filtre `metier` dans une URL reste visible et retirable. Les marchés, langues et parcours de candidature conservent leurs contrats. `/offres`, matching et onboarding restent gelés.

L’implémentation et les validations ci-dessous sont locales tant que le reçu Railway ne désigne pas cette release. Aucun déploiement du site n’est autorisé implicitement.

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
3. Appliquer les deux migrations additives `20260924120000_search_projection` et `20260924130000_search_market_index` via Prisma. Elles n’altèrent aucune publication ni capture historique.
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

Restent intentionnellement : données historiques `Company.sector` encore exposées par des lecteurs et outils de reprise ; anciens vecteurs employés par le circuit Direct Offers gelé et le retour arrière ; migrations et preuves historiques nécessaires à la traçabilité. Leur retrait physique requiert la suppression vérifiée de leurs consommateurs, pas une suppression aveugle de données.
