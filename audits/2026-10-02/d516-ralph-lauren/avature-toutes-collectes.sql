-- D-516 §1 : TOUTES les collectes JOBS des sources Avature depuis le 01/09, refusées ou non : volume, durée, cadence
-- (requêtes/s, pic sur 300 s glissantes), refus 406/403, rang du premier 406, et la lecture précédente de la même
-- source (fin, volume, écart). Sert à éprouver l'hypothèse « double lecture ». LECTURE SEULE.
\pset footer off
with src as (select key from "Source" where kind ilike '%avature%'),
b as (
  select b.id, b."sourceKey", b."startedAt", b."accessDecisionId" is not null sous_decision, o.status,
         count(r.*) n, min(r."capturedAt") debut, max(r."capturedAt") fin,
         count(*) filter (where r.status = 406) r406, count(*) filter (where r.status = 403) r403,
         min(r.sequence) filter (where r.status = 406) premier_406
    from "CaptureBatch" b join src on src.key = b."sourceKey" left join "CaptureOutcome" o on o."batchId" = b.id
    left join "RawCapture" r on r."batchId" = b.id
   where b.purpose = 'JOBS' and b."startedAt" >= '2026-09-01'
   group by b.id, b."sourceKey", b."startedAt", b."accessDecisionId", o.status),
pic as (
  select r."batchId", max(c) pic300 from (
    select r."batchId", (select count(*) from "RawCapture" x where x."batchId" = r."batchId"
                          and x."capturedAt" between r."capturedAt" - interval '300 second' and r."capturedAt") c
      from "RawCapture" r where r."batchId" in (select id from b where n >= 200) and r.sequence % 25 = 0) r
  group by 1)
select b."sourceKey", left(b.id, 8) lot, to_char(b."startedAt", 'MM-DD HH24:MI') debut, b.sous_decision, b.status, b.n requetes,
       round(extract(epoch from (b.fin - b.debut))::numeric) duree_s,
       round(b.n / nullif(extract(epoch from (b.fin - b.debut)), 0)::numeric, 2) req_par_s, p.pic300,
       b.r406, b.r403, b.premier_406,
       lag(b.n) over w n_precedente,
       round(extract(epoch from (b.debut - lag(b.fin) over w))::numeric / 60) min_apres_precedente
  from b left join pic p on p."batchId" = b.id
window w as (partition by b."sourceKey" order by b."startedAt")
 order by b."sourceKey", b."startedAt";
