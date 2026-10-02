-- D-516 §1, enquête « jeton refusé ». LECTURE SEULE (db.py readonly). Rejouable :
--   CATWALKS_DB_ACCESS=<dossier d'accès> python3 apps/aggregator/scripts/ops/db.py readonly \
--     sh -c 'psql "$DATABASE_URL" -XA -F"|" -f audits/2026-10-02/d516-ralph-lauren/collectes.sql'
\pset footer off
-- 1. Toutes les collectes JOBS amorcées de Ralph Lauren (au moins une ligne BROWSER_RESPONSE), avec leur issue.
select b.id, b.purpose, b."startedAt", o.status, o."transportCoverage", o."extractedCount", o.failure, b."accessDecisionId" is not null as sous_decision,
       (select count(*) from "RawCapture" r where r."batchId" = b.id) captures,
       (select count(*) from "RawCapture" r where r."batchId" = b.id and r.format = 'BROWSER_RESPONSE') navigateur,
       (select min(r."capturedAt") from "RawCapture" r where r."batchId" = b.id) premiere,
       (select max(r."capturedAt") from "RawCapture" r where r."batchId" = b.id) derniere
  from "CaptureBatch" b left join "CaptureOutcome" o on o."batchId" = b.id
 where b."sourceKey" = 'ralph-lauren-avature' and b.purpose = 'JOBS'
   and exists (select 1 from "RawCapture" r where r."batchId" = b.id and r.format = 'BROWSER_RESPONSE')
 order by b."startedAt";
-- 2. Pour chacune : les requêtes autour de l'amorçage et du refus (statut non 200, navigateur, 10 premières HTTP après
--    l'amorçage, 5 dernières), avec le délai depuis la dernière réponse navigateur.
with amorcees as (
  select b.id from "CaptureBatch" b where b."sourceKey" = 'ralph-lauren-avature' and b.purpose = 'JOBS'
     and exists (select 1 from "RawCapture" r where r."batchId" = b.id and r.format = 'BROWSER_RESPONSE')),
lignes as (
  select r."batchId", r.sequence, r.format, r.status, r."capturedAt", r.method, r.failure, r."cookieNames",
         left(regexp_replace(r."requestUrl", '^https://[^/]+', ''), 110) chemin, split_part(split_part(r."requestUrl", '//', 2), '/', 1) hote,
         max(case when r.format = 'BROWSER_RESPONSE' then r."capturedAt" end) over (partition by r."batchId" order by r.sequence) dernier_amorcage,
         row_number() over (partition by r."batchId", r.format order by r.sequence) rang_format,
         count(*) over (partition by r."batchId") total,
         r.headers->>'x-amzn-waf-action' waf_action, r.headers->>'server' serveur, r.headers->>'content-type' type_contenu,
         r.headers->>'x-amzn-requestid' amzn_id, r.headers->>'x-cache' x_cache
    from "RawCapture" r where r."batchId" in (select id from amorcees))
select left("batchId", 8) lot, sequence, format, status, to_char("capturedAt", 'HH24:MI:SS.MS') heure,
       round(extract(epoch from ("capturedAt" - dernier_amorcage))::numeric, 1) s_depuis_amorcage, hote, chemin,
       waf_action, serveur, type_contenu, amzn_id is not null as amzn, x_cache, "cookieNames", failure
  from lignes
 where format = 'BROWSER_RESPONSE' or coalesce(status, 0) <> 200
    or (format = 'HTTP_RESPONSE' and rang_format <= 6) or sequence > total - 4
 order by "batchId", sequence;
