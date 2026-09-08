# Déploiement et décisions d'exploitation — 8 septembre 2026

Le socle corrigé est déployé sur **https://modecareers.com**. Les quatre services applicatifs Railway exécutent la révision `b7aa6dafe00c8cc286a43b62332b938de5db7a9f`. Cette livraison est vérifiée ; la certification globale de capacité, de qualité et de couverture mondiale reste ouverte.

Ce document remplace, pour l'état courant de la livraison, les mentions « non déployé » des rapports précédents. Ceux-ci restent des photographies historiques. Les données de travail fournies par le propriétaire dans `apps/aggregator/data` sont exclues des commits de cette intervention.

## Livraison et architecture retenue

- [PR 17 : ingestion, cycle de vie et déploiement](https://github.com/lmelane/fr-retail-jobs/pull/17), fusionnée dans `ae352d47668d520b60575c56ef1eb253a6499609`.
- [PR 18 : dépendances et contrôle de sécurité CI](https://github.com/lmelane/fr-retail-jobs/pull/18), fusionnée dans `b7aa6dafe00c8cc286a43b62332b938de5db7a9f`.
- [CI distante de la mise à jour de sécurité](https://github.com/lmelane/fr-retail-jobs/actions/runs/34245274990) : les deux jobs sont verts.

Le monorepo modulaire et PostgreSQL restent le cœur du système. Les processus web et de collecte restent séparés. Le choix est de mesurer les limites de cette architecture avant d'introduire des microservices, un moteur de recherche séparé ou une nouvelle infrastructure de files. Les décisions acceptées figurent dans [production-foundations.md](../../docs/architecture/production-foundations.md).

L'identité externe est désormais `(sourceKey, externalId)`. L'ingestion, la réconciliation et le retrait des sources coordonnent leurs transactions et leurs verrous. Une source secondaire ne remplace plus librement les données de meilleure autorité. Les révisions brutes des ingestions réussies sont conservées ; les fermetures préservent les identifiants et l'historique.

Une absence ne ferme une offre qu'après une collecte explicitement complète et récente. Les adaptateurs sans preuve continuent d'ingérer mais ne peuvent pas justifier cette fermeture. Les délais d'exécution se propagent aux transports ; les connexions HTTP et Chromium contrôlent les destinations DNS et bornent les lectures. Les totaux, résultats et facettes partagent une sélection SQL cohérente, avec projection de recherche indexée.

Les installations Docker utilisent `npm ci`. Le web s'exécute sans privilèges root. Les workers vérifient le schéma avant de travailler, sans lancer de migration, de faux baseline ni d'import CSV au démarrage. Un import CSV ajoute des brouillons et conserve la configuration opérationnelle existante. `/api/health` vérifie l'accès à la base et au schéma requis, avec réponse 503 en cas d'échec.

Vitest est passé à 3.2.6, PostCSS à 8.5.28 et deepmerge-ts à 8.0.0. L'audit npm passe de dix alertes à **zéro alerte connue** à la date de mesure. La CI échoue désormais sur les alertes élevées ou critiques. Cela ne constitue pas un audit exhaustif du code ou de l'infrastructure.

## Migrations, intégrité et sauvegardes

Une sauvegarde logique fraîche a été produite avant les écritures : `backups/codex-pre-production-20260908.dump`, 236 820 858 octets, accompagnée de son SHA-256. Les deux fichiers ont des permissions 600 et restent hors Git. La sauvegarde a été restaurée dans un PostgreSQL 18 isolé ; les migrations ont été répétées sur cette copie représentative avant leur application en production.

Six migrations ont été appliquées, de `20260909000000_identity_integrity` à `20260909050000_concurrent_job_search_index`. Le DDL court, le remplissage de la projection et la création concurrente de l'index ont des migrations séparées. Le système contient désormais 19 migrations appliquées. La répétition a duré 38,7 secondes et 70 lectures SQL concurrentes ont réussi. L'application en production a duré 56,3 secondes.

Les décomptes et empreintes métier contrôlés avant/après migration sont inchangés : **73 645 offres**, **71 636 actives**, **76 562 entrées source**, **8 037 événements**. L'index est valide et la projection ne présente aucun écart dans le contrôle effectué. La base mesurait environ 1,42 Go après migration ; l'index de recherche environ 144 Mio.

**Limite de la mesure de disponibilité pendant migration :** les 27 sondes HTTP de `production-migration.json` visaient un ancien domaine Railway retiré et ont reçu 404. Elles ne prouvent ni une panne de `modecareers.com`, ni son absence d'interruption. Le domaine réel a été identifié et contrôlé après migration. La preuve des lectures continues concerne la répétition isolée, pas le trafic de production.

Le quota des sauvegardes Railway empêchait une nouvelle copie avec un volume de 5 Go. Le volume a été agrandi en ligne à **10 Go**. Les sept sauvegardes préexistantes ont été conservées. Railway a ajouté une sauvegarde de redimensionnement et la nouvelle copie `Post hardening 2026-09-08`, identifiant `314c6f38-202b-4072-81e6-7f615b33cec1`, créée à 15:40:46 UTC. L'API confirme le volume à 10 000 Mo et la présence de cette copie ; la consommation déclarée des sauvegardes est alors de 2 728 Mo pour un quota de 5 000 Mo. La restauration testée est celle du dump indépendant ; une restauration de cette nouvelle sauvegarde fournisseur n'a pas été exécutée.

Le proxy TCP public PostgreSQL préexistant n'a pas été supprimé : des clients existants l'utilisent. Les accès de cette intervention ont imposé TLS. Les services applicatifs utilisent le réseau privé Railway. La fermeture du proxy et la restriction des rôles nécessitent un inventaire des consommateurs et restent dans le chantier d'accès minimal.

## Vérifications après déploiement

| Vérification | Résultat |
| --- | --- |
| Tests unitaires agrégateur | 1 351 réussis |
| Tests d'intégration PostgreSQL | 189 réussis |
| Tests web | 102 réussis, 2 tests historiques ignorés |
| Parcours navigateur desktop/mobile | 16 réussis |
| Total | **1 658 réussis**, 2 ignorés |
| Typecheck des deux applications, build web | Réussis |
| Audit npm après correction | 0 alerte connue |
| Services web, ingestion, refresh, reconcile | `SUCCESS`, même commit final |

Les tests et la CI utilisent Node 22 ; l'image Playwright du collecteur utilise Node 24.18.1. Le test réel des transports et les collectes ciblées ont été exécutés dans ce dernier runtime. L'alignement explicite des versions de test et de production reste souhaitable.

Trois collectes ciblées ont été exécutées depuis Railway sur la livraison principale : Olaplex/Greenhouse (10 offres), Vestiaire Collective/Lever (11), Uniqlo Graduates/Workday (11). Les 32 offres ont été réattestées sans erreur, avec complétude explicite et capacité à attester une absence. Aucun nouvel identifiant d'offre n'a été créé. Une seconde passe Olaplex n'a produit ni doublon d'offre ni duplication d'observation identique. Le test des transports HTTP et Chromium vers une page HTTPS publique a réussi. Ces essais portent sur `ae352d4` ; la mise à jour de dépendances suivante a passé la CI et les contrôles HTTP finaux, sans refaire les trois collectes.

À 15:40 UTC, sur la version finale : `/api/health`, `/api/jobs?page=1`, `/api/jobs?pays=FR`, `/emplois`, `/entreprises`, `/intelligence/pays/FR` et `/sitemap.xml` répondent en 200. L'API compte 71 636 offres actives au total et 9 636 en France. La sonde santé prend 184 ms et les deux listes API 532 et 214 ms dans cette mesure ponctuelle. Une recherche textuelle précédente a pris environ deux secondes. Ces mesures ne sont pas des percentiles de trafic ni un test de charge. La réponse HTML de la page entreprises dépasse un million de caractères et mérite aussi un budget de taille.

L'historique Brevo consulté en lecture seule confirme la livraison récente des digests de surveillance et d'une alerte de silence du pipeline. Aucune alerte de test n'a été envoyée. Cela ne démontre pas encore la détection d'une panne simultanée de la base, du scheduler et de l'application. Le healthcheck Railway intervient au déploiement ; il ne remplace pas une surveillance externe continue.

## Configuration opérationnelle finale

| Service | Horaire UTC | Commande |
| --- | --- | --- |
| Ingestion | Tous les jours à 22 h | `sh apps/aggregator/start.sh`, `PIPELINE_CMD=ingest-all` |
| Rafraîchissement | Tous les jours à 02 h | Commande Docker, `PIPELINE_CMD=refresh` |
| Réconciliation | Lundi à 03 h | Commande Docker, `PIPELINE_CMD=reconcile` |
| Web | Continu | Commande Docker, healthcheck `/api/health` |

Une commande temporaire `sleep 900` a permis le test depuis un worker éveillé. La remise à `null` via l'API n'avait pas effacé cette surcharge. Le contrôle du manifeste l'a détecté ; une commande explicite correcte a été enregistrée et redéployée. Le manifeste final confirme son application. Aucun test ne repose sur le maintien de cette commande temporaire. Les horaires suspendus pendant la migration ont été rétablis.

Pour un incident d'écriture : suspendre les collecteurs avant toute réparation, relever les runs et erreurs, puis vérifier les invariants. Ne pas relancer automatiquement toutes les sources ni appliquer `prisma migrate resolve` sans examiner le schéma réel. Un retour à l'ancien writer peut violer les nouvelles identités multitenants : privilégier une correction vers l'avant. Restaurer une sauvegarde est une opération de reprise distincte avec perte possible des écritures postérieures ; le RPO et le RTO doivent être mesurés et acceptés avant de promettre un SLA.

## État réel du catalogue et suite priorisée

La photographie de santé avant les collectes ciblées mesure **2 403 offres actives distinctes à risque**, dont 2 375 sans source fraîche, 79 explicitement expirées et encore actives, et 11 avec URL canonique non adossée à une entrée active. Ces catégories se recoupent ; il ne faut pas les additionner. « À risque » ne signifie pas « offre fausse ». Aucune offre n'a été fermée en masse sur ce seul indicateur.

Le catalogue contient 440 sources actives ; 447 clés ont encore des offres actives, car sept sources en pause conservent leur historique actif. Une pause ne constitue pas une preuve d'absence. Les sources en pause n'ont été ni retirées ni réactivées arbitrairement.

Les portes de validation suivantes restent ouvertes, dans cet ordre :

1. **Cycle réel et complétude.** Observer les prochains cycles planifiés et quantifier les runs complets, incomplets et inconnus. Certifier les contrats des adaptateurs, traiter d'abord les sources concentrant le plus d'offres à risque et vérifier les fermetures sur des cas annotés. Les anciennes lignes de run restent inconnues jusqu'à une nouvelle mesure ; elles ne doivent pas recevoir de preuve inventée.
2. **Exploitation et reprise.** Tester une panne contrôlée avec détection indépendante, borner les transports d'alerte, supprimer les silences d'erreur du deadman, répéter une restauration fournisseur isolée et définir RPO/RTO. Surveiller la croissance des observations, index, WAL et sauvegardes avec une rétention explicite.
3. **Capacité mesurée.** Profiler les recherches lentes et les volumes de réponse ; fixer les budgets p95/p99, connexions, mémoire, durée et coût par source. Exécuter une charge représentative et une endurance en environnement isolé. Dimensionner le pool PostgreSQL et la concurrence globale avant d'ajouter des réplicas. Une file durable pourra alors porter les reprises et tâches lentes si les mesures le justifient.
4. **Données canoniques rejouables.** Compléter la provenance par champ, les règles de résolution versionnées, les référentiels figés, les réponses rejetées en quarantaine et le replay reproductible. Construire un inventaire versionné des ambiguïtés pays/États sans règles arbitraires `ville → pays`. Le résolveur ne doit pas dépendre de l'état mutable du corpus.
5. **Qualité mondiale et produit.** Construire un référentiel externe d'employeurs et de pays pour mesurer la couverture réelle, puis un jeu annoté de faux doublons, offres fermées, géographies et contrats. Terminer les dimensions non mesurées du Health Score : contradictions de champs, complétude fiable, drift, ambiguïtés et couverture. Poursuivre l'accessibilité, les courses de pagination et l'indexation externe durable selon le plan initial.

Le [plan complet d'audit et de validation](./PLAN-VALIDATION-PRODUCTION.md) définit les chantiers détaillés. Le déploiement de ce socle ne justifie pas encore les affirmations « couverture mondiale exhaustive », « scalable à 100 % » ou « zéro erreur ».

## Pièces de preuve

- [Services et versions finales](./deployment/final-services.json), [HTTP final](./deployment/final-live-http.json), [synthèse](./deployment/validation-summary.json).
- [Répétition des migrations](./deployment/migration-rehearsal.json), [application en production et sondes invalides](./deployment/production-migration.json), [intégrité après migration](./deployment/production-after-migration.jsonl).
- [Collectes ciblées](./deployment/live-canary.json), [transports](./deployment/live-network.json), [photographie de santé](./deployment/production-health.json).
- [Sauvegardes après redimensionnement](./deployment/provider-backups-after.json), [historique des alertes](./deployment/alert-delivery-history.json), [audit des dépendances](./deployment/dependencies-after.json).
