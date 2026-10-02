-- D-516 §1 : corps archivé de la réponse 406 et enveloppes de requête (gzip en base64, décodés hors base par
-- enveloppes.py, qui n'imprime jamais une valeur de cookie). LECTURE SEULE.
\pset footer off
\pset tuples_only on
select left(r."batchId", 8) || '|' || r.sequence || '|' || coalesce(r.status::text, '') || '|resp|' || coalesce(translate(encode(b.gzip, 'base64'), E'\n', ''), '')
  from "RawCapture" r left join "RawBlobBody" b on b.hash = r."blobHash"
 where r."batchId" = 'c81e14a5-2156-4828-bd0d-0cc51144baae' and r.sequence = 8;
select left(r."batchId", 8) || '|' || r.sequence || '|' || coalesce(r.status::text, '') || '|req|' || coalesce(translate(encode(b.gzip, 'base64'), E'\n', ''), '')
  from "RawCapture" r left join "RawBlobBody" b on b.hash = r."requestDataHash"
 where (r."batchId" = 'c81e14a5-2156-4828-bd0d-0cc51144baae' and r.sequence in (0, 1, 5, 6, 7, 8))
    or (r."batchId" = 'da424ede-87b3-4130-9b09-3b77ec75bfd6' and r.sequence in (0, 6, 7, 8, 9, 10, 1361))
 order by 1;
