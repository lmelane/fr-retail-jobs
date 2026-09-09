# Incident Railway du 9 septembre — constat et remédiation

Le build n'a pas échoué. Le déploiement `7b17182e-b713-4bbb-ab25-5f506201ca11` (code `030a101`) a construit et publié son image le 8 septembre à 21:14 UTC. Le collecteur a terminé les **424 sources** à 22:49:47 UTC : **423 sans erreur fatale, 1 échec, aucun timeout**. `l-oreal-professionnel` a reçu HTTP 406 à `jobOffset=240`. Le CLI renvoie intentionnellement un code 1 après les étapes finales lorsque des sources échouent ; cela explique le statut CRASHED, pas une interruption de toutes les sources. Les dernières lignes ont en outre subi la limitation Railway : **2 925 lignes perdues** après dépassement de 500 logs/s.

## Preuve avant

`railway-incident-excerpts.json` contient le message 406, la fin des 424 traitements et le message de limitation. `production-snapshot.json` est une transaction PostgreSQL REPEATABLE READ / READ ONLY du 9 septembre à 04:49 UTC.

- 74 113 offres actives ; 10 934 `isFrance`, contre 10 936 `countryCode=FR` (écart à réparer, pas maquillé).
- 4 868 pays absents, 1 411 dates absentes, 5 dates futures, 61 dates d'expiration dépassées, 1 348 offres non revues depuis 48 h. Ces deux derniers inventaires ne prouvent pas chacun une fermeture réelle chez l'employeur.
- SourceRun : 178 OK, 245 DEGRADED, 1 BROKEN. **423 succès techniques n'équivalent pas à 423 sources exhaustives** : seulement 179 attestent l'absence dans ce run.
- L'Oréal : 1 804 représentations actives conservées ; `canAttestAbsence=false`, zéro événement CLOSED lié à cette source pendant le run. L'erreur HTTP n'était conservée que dans les logs ; SourceRun ne portait qu'une note générique.

## Correctif applicatif

1. `ingest.completed` est un résumé JSON compact et borné, avec `completed`, `outcome`, compteurs, échecs et référence SourceRun. Les erreurs restent signalées par le code de sortie et le heartbeat ; aucun passage artificiel au vert.
2. La cause d'une exception de collecte est conservée dans la note SourceRun. Un log Railway perdu ne détruit plus cette information.
3. Le client HTTP permet une politique de statuts transitoires propre à l'amont. L'Oréal utilise trois tentatives maximum pour 406, avec le backoff, la porte d'hôte et l'annulation existants. Les autres hôtes gardent le comportement 406 définitif. Un refus persistant reste un échec ; il n'est pas qualifié arbitrairement d'anti-bot.
4. L'adaptateur découvre dans la page officielle l'endpoint `searchJobsAJAXPage` réellement utilisé par le bouton du site. Il exige même origine, même route locale, aucun filtre/identifiant de connexion, puis lit les fragments publics. Le badge `999+` n'est jamais traité comme un total exact.
5. Seul le marqueur HTML explicite de fin de liste permet `complete=true`. Une page répétée, méconnue, un plafond ou une pagination partiellement répétée restent tronqués/non fiables. Une exception reste bloquante pour toute attestation d'absence.

## Validation réelle et tests

`loreal-listing-validation.json` : lecture mondiale sans filtre, **1 726 identifiants uniques**, fin explicite, aucune troncature, en 161 secondes depuis ce poste. Aucun ingest ni écriture de production, pas de lecture des descriptions complètes. Ce relevé prouve l'énumération dans ces conditions ; **il ne prouve pas encore la même réussite depuis l'egress Railway**, ni la fermeture des anciennes offres absentes de la liste.

Témoins avant correctif : **7 tests échouent, 12 passent** contre main sans cette remédiation. Avec les changements et les PR Douglas/Teamtailor intégrées : **1 445 tests unitaires passent**, **200 tests d'intégration passent** sur la base locale réservée aux tests ; typecheck des deux applications propre. Pas de load test et aucun faux emploi en production.

## Livraison et limites

- Douglas PR #29 mergée : `0f3f7e028b103b1cc30acd5b6281a02d6d8e6953`.
- Teamtailor PR #30 mergée : `97635222ce94d3c0d790bcb06be31ddfa99dbd3a`.
- Image collecteur pour ces deux lots : `f96e7616-7db2-4da9-8819-e4277531a60e`, build SUCCESS. Ce build ne constitue pas un nouveau run.
- Correctif incident : commit applicatif `edeae6f`, validation/déploiement suivis dans le reçu de livraison à venir.
- Aucun run global relancé. Les 13 corrections de dates Douglas sont préparées séparément ; un build ne répare pas les anciennes lignes.

Restent ouverts : reprise durable des pages déjà lues après une erreur persistante, identifiant global d'exécution corrélant les SourceRun, diagnostic de l'origine exacte du 406 Railway, complétude des autres ATS, géographie/dates/séniorité/provenance historiques et qualification des portails FashionJobs. L'incident corrigé ne certifie pas à lui seul la préparation mondiale du produit.
