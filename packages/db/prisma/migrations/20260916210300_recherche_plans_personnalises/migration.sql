-- Lot 7 — la recherche est toujours planifiée avec ses valeurs, jamais avec un plan générique.
--
-- Le client Prisma réutilise ses instructions préparées ; PostgreSQL (`plan_cache_mode = auto`) cesse alors
-- de replanifier avec les valeurs à partir de la sixième exécution si le plan générique lui paraît aussi bon.
-- Pour la recherche, il ne l'est pas : sans connaître le terme ni le périmètre, il parcourt l'index du pays et
-- évalue le vecteur ligne à ligne. Reproduit sur le clone du stock (audits/reprise-2026-09-15/lot-7.md,
-- « plan générique ») : 24 ms → 298 ms sur « école » (FR), 610 ms → 4 796 ms sur « store manager » (US).
-- Le rôle qui joue les migrations est celui de l'API : ses sessions à venir planifient chaque exécution avec
-- ses valeurs (`force_custom_plan`) ; le témoin lib/__tests__/pertinence-lot7.test.ts le vérifie depuis
-- une session du client. Le coût mesuré de la planification de la recherche : 10 à 35 ms.
BEGIN;
ALTER ROLE CURRENT_USER SET plan_cache_mode = 'force_custom_plan';
COMMIT;
