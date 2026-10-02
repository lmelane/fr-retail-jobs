-- D-516 §1 : où le 406 d'Avature se déclenche-t-il ? Pour chaque collecte JOBS de L'Oréal Professionnel et de Ralph
-- Lauren qui en a reçu un depuis le 01/09 : rang et délai du premier 406, requêtes de la collecte dans les 60 s et
-- 300 s qui le précèdent, et part des requêtes suivantes encore refusées (persistance). LECTURE SEULE.
\pset footer off
with lots as (select id, "sourceKey", "startedAt" from "CaptureBatch" where "startedAt" >= '2026-09-01' and purpose = 'JOBS'
               and "sourceKey" in ('l-oreal-professionnel', 'ralph-lauren-avature')),
     premier as (select r."batchId", min(r.sequence) seq from "RawCapture" r join lots l on l.id = r."batchId" where r.status = 406 group by 1),
     t as (select p."batchId", p.seq, r."capturedAt" t406 from premier p join "RawCapture" r on r."batchId" = p."batchId" and r.sequence = p.seq)
select l."sourceKey", left(l.id, 8) lot, to_char(l."startedAt", 'MM-DD HH24:MI') debut, t.seq rang_premier_406,
       round(extract(epoch from (t.t406 - (select min("capturedAt") from "RawCapture" where "batchId" = l.id)))::numeric) s_depuis_debut,
       (select count(*) from "RawCapture" r where r."batchId" = l.id and r."capturedAt" between t.t406 - interval '60 second' and t.t406) req_60s,
       (select count(*) from "RawCapture" r where r."batchId" = l.id and r."capturedAt" between t.t406 - interval '300 second' and t.t406) req_300s,
       (select count(*) from "RawCapture" r where r."batchId" = l.id and r.sequence > t.seq) apres,
       (select count(*) from "RawCapture" r where r."batchId" = l.id and r.sequence > t.seq and r.status = 406) apres_406,
       (select count(*) from "RawCapture" r where r."batchId" = l.id and r.sequence > t.seq and r.status = 200) apres_200
  from lots l join t on t."batchId" = l.id order by l."startedAt";
