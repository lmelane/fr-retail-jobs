-- D-520, classe identité d'employeur. LECTURE SEULE de la production, hors fenêtre du RUN (avant 15:30 ou après 18:30 UTC).
-- Les décisions d'alias relues après coup (b-s-international, funky-buddha) et les sociétés en jeu. Mesuré le 02/10 à 14:59 UTC.
-- Rejeu, depuis le checkout qui porte les accès :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -XA -F'|' -v ON_ERROR_STOP=1 -f <worktree>/audits/2026-10-02/classe-identite/alias-relus.sql' > <worktree>/audits/2026-10-02/classe-identite/alias-relus.out
\pset footer off
SET statement_timeout='60s';
SELECT r.statement FROM "EmployerIdentityReview" r WHERE r.id IN (SELECT "reviewId" FROM "CompanyAlias" WHERE "sourceKey" IN ('b-s-international','funky-buddha'));
SELECT id, name, "fashionjobsUrl", "mergedIntoId", kind, "parentGroupId" FROM "Company" WHERE name ILIKE 'B%s%International%' OR name IN ('B''s','Funky Buddha','ALTEX S.A.','Puma','PUMA SE','Crocs','Crocs, Inc.','Swatch','Flik Flak','Cartier','Richemont','Tapestry, Inc.','Kate Spade','Tapestry');
