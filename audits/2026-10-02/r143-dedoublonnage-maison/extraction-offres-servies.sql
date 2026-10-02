-- R-143 §4 — les offres SERVIES (publicJobSql) avec la clé « doublon visible » de la mesure D-513
-- (audits/2026-10-02/comparaison-indeed/canonique-dedup.sql, Q6) : même Maison, intitulé normalisé, ville, source propriétaire.
-- Rejouer : ... psql "$DATABASE_URL" -X -A -t -f - < extraction-offres-servies.sql > <scratch>/servies.jsonl
SET statement_timeout = '180s';
WITH servie AS (SELECT j.* FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL
  AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now())))
SELECT json_build_object('jobId', id, 'companyId', "companyId", 'src', "canonicalSourceKey",
  't', lower(regexp_replace(translate(lower(title), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ', 'aaaaaaceeeeiiiinooooouuuuyyoa'), '[^a-z0-9]+', ' ', 'g')),
  'c', lower(coalesce(city, '')),
  'actives', (SELECT count(*) FROM "JobSource" s WHERE s."jobId" = servie.id AND s."isActive" AND (s."expiresAt" IS NULL OR s."expiresAt" > now())),
  'toutes', (SELECT count(*) FROM "JobSource" s WHERE s."jobId" = servie.id))
FROM servie;
