-- Garde du zéro annoncé (R-143) — LECTURE SEULE. Rejouer comme les autres fichiers du dossier.
\echo Z1 runs a zero annonce (declaredTotal=0) apres un passe productif, tout l historique SourceRun
SELECT "sourceKey", max("previousJobs") stock_precedent_max, count(*) runs FROM "SourceRun" WHERE "declaredTotal" = 0 AND coalesce("previousJobs",0) > 0 GROUP BY 1 ORDER BY 2 DESC;
\echo Z2 distribution du stock actif par source
WITH s AS (SELECT "sourceKey", count(*) n FROM "JobSource" WHERE "isActive" GROUP BY 1)
SELECT count(*) sources, count(*) FILTER (WHERE n>=10) ge10, count(*) FILTER (WHERE n>=20) ge20, count(*) FILTER (WHERE n>=50) ge50 FROM s;
