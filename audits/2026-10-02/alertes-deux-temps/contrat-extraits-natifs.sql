-- D-515 §3 — EXTRAITS (±50 caractères) des expressions natives d'emploi permanent dans les descriptions des offres servies
-- sans durée reconnue, pour juger chaque expression AVANT de l'ajouter (perspective « 正社員登用あり », négation…).
-- LECTURE SEULE. Jamais entre 15:30 et 18:30 UTC. Rejouer comme contrat-par-marche.sql.
SET statement_timeout = '240s';
WITH s AS (SELECT j.id, j."countryCode" pays, j.description d FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."employmentTerm" IS NULL
  AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now()))),
x AS (SELECT e.expr, s.pays, s.id, s.d, (regexp_match(s.d, e.re))[1] hit
  FROM s CROSS JOIN (VALUES ('ja','正社員|無期雇用'), ('ko','정규직'), ('de','[Ff]estanstellung|[Uu]nbefristete[nrs]? (?:Arbeits|Anstellung|Stelle|Vertrag|Beschäftigung)'),
    ('es','(?:[Tt]iempo|[Pp]lazo) (?:indefinido|indeterminado)'), ('pt','[Pp]razo indeterminado|[Cc]ontrato efetivo|[Ee]fetiva[cç][aã]o'),
    ('nordique','[Ff]astans[aæ]ttelse|[Ff]ast stilling|[Ff]ast anst[aä]llning|[Tt]illsvidareanst'), ('nl','[Vv]ast (?:contract|dienstverband)|[Vv]aste (?:aanstelling|baan)|[Oo]nbepaalde tijd'),
    ('it','[Tt]empo [Ii]ndeterminato'), ('en','[Oo]pen[ -]ended contract|[Ii]ndefinite (?:contract|term)')) e(expr, re)
  WHERE s.d ~ e.re),
m AS (SELECT expr, pays, substring(d from greatest(1, strpos(d, hit) - 50) for 110 + length(hit)) extrait,
  row_number() OVER (PARTITION BY expr ORDER BY md5(id)) r, count(*) OVER (PARTITION BY expr) n FROM x)
SELECT expr, n, pays, replace(replace(extrait, E'\n', ' '), E'\t', ' ') FROM m WHERE r <= 14 ORDER BY expr, r;
