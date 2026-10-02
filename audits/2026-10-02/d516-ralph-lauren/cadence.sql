-- D-516 §1 : cadence par tranche de 30 s des collectes amorcées (requêtes, refus), et forme des refus (corps archivé
-- signé nginx ou AWS). LECTURE SEULE. Même invocation que collectes.sql.
\pset footer off
select left(r."batchId", 8) lot, to_char(date_trunc('minute', r."capturedAt") + (floor(extract(second from r."capturedAt") / 30) * interval '30 second'), 'MM-DD HH24:MI:SS') tranche,
       count(*) requetes, count(*) filter (where r.status = 406) r406, count(*) filter (where r.status = 403) r403,
       count(*) filter (where r.status = 202) r202, min(r.sequence) seq_min, max(r.sequence) seq_max
  from "RawCapture" r
 where r."batchId" in (select id from "CaptureBatch" where "sourceKey" = 'ralph-lauren-avature' and purpose = 'JOBS'
                        and left(id::text, 8) in ('55847bbb', '7b16d898', 'abe33bc1', 'da424ede', 'c81e14a5'))
 group by 1, 2 order by 2;
-- Les refus : statut, en-têtes, chemin, et le corps archivé en base64 (décodé par enveloppes.py, colonne « resp »).
\pset tuples_only on
select left(r."batchId", 8) || '|' || r.sequence || '|' || coalesce(r.status::text, '') || '|resp|' || coalesce(translate(encode(b.gzip, 'base64'), E'\n', ''), '')
       || '|' || to_char(r."capturedAt", 'MM-DD HH24:MI:SS.MS') || '|' || r.headers::text || '|' || left(regexp_replace(r."requestUrl", '^https://[^/]+', ''), 60)
  from "RawCapture" r left join "RawBlobBody" b on b.hash = r."blobHash"
 where r."batchId" in (select id from "CaptureBatch" where "sourceKey" = 'ralph-lauren-avature' and purpose = 'JOBS'
                        and left(id::text, 8) in ('55847bbb', '7b16d898', 'abe33bc1'))
   and coalesce(r.status, 0) <> 200 and (r.status <> 406 or r.sequence < 1006 or r.sequence > 1320)
 order by r."batchId", r.sequence;
