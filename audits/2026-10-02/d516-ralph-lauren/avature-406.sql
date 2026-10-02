-- D-516 §1 : les réponses 406 des autres portails Avature (L'Oréal et sa division Pro) depuis le 01/09 : même corps
-- signé nginx que Ralph Lauren ? LECTURE SEULE. Corps décodé par enveloppes.py (colonne « resp »).
\pset footer off
\pset tuples_only on
with lots as (select id, "sourceKey" from "CaptureBatch" where "startedAt" >= '2026-09-01' and purpose = 'JOBS'
               and ("sourceKey" like '%loreal%' or "sourceKey" like '%oreal%' or "sourceKey" = 'ralph-lauren-avature')),
     refus as (select l."sourceKey", r."blobHash", count(*) n, min(r."capturedAt") premier, max(r."capturedAt") dernier
                 from "RawCapture" r join lots l on l.id = r."batchId" where r.status = 406 group by 1, 2)
select f."sourceKey" || '|' || f.n || '|' || f.premier::text || '|resp|' || coalesce(translate(encode(b.gzip, 'base64'), E'\n', ''), '') || '|' || f.dernier::text
  from refus f left join "RawBlobBody" b on b.hash = f."blobHash" order by 1;
